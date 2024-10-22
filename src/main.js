// For more information, see https://crawlee.dev/
import { CheerioCrawler, log, FileDownload } from "crawlee";
import { writeFile, mkdir, access } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import he from "he";

// Global Configuration Variables
const CONFIG = {
	BASE_URL: new URL(process.argv[2] || "https://developers.google.com/search/"),
	MAX_CRAWL_DEPTH: 1000,
	MAX_CONCURRENCY: 50,
	MAX_REQUESTS_PER_CRAWL: 1000,
	MAX_REQUESTS_PER_MINUTE: 120,
	REQUEST_TIMEOUT: 30000,
	RETRY_COUNT: 3,
	SITEMAP_CONCURRENCY: 50,
	USER_AGENT: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
	RESPECT_ROBOTS_TXT: false,
	CRAWL_SITEMAP: false,
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, CONFIG.BASE_URL.hostname);

log.setLevel(log.LEVELS.DEBUG);

async function savePageDataAsJSON(url, data) {
	const filePath = generateFilePath(url);
	await mkdir(path.dirname(filePath), { recursive: true });
	const jsonData = JSON.stringify(data, null, 2);
	await writeFile(filePath, jsonData);
	console.log(`Saved: ${filePath}`);
}

function generateFilePath(url) {
	const parsedURL = new URL(url);
	const relativePath = parsedURL.pathname;
	const parts = relativePath.split("/").filter(Boolean);
	let currentPath = rootDir;

	for (const part of parts) {
		currentPath = path.join(currentPath, slugify(part));
	}

	const fileName = parts.length > 0 ? slugify(parts[parts.length - 1]) : "index";
	return path.join(currentPath, `${fileName}.json`);
}

function slugify(text) {
	return text
		.toString()
		.toLowerCase()
		.replace(/\s+/g, "-")
		.replace(/[^\w\-]+/g, "")
		.replace(/\-\-+/g, "-")
		.replace(/^-+/, "")
		.replace(/-+$/, "");
}

const crawler = new CheerioCrawler({
	maxConcurrency: CONFIG.MAX_CONCURRENCY,
	maxRequestsPerCrawl: CONFIG.MAX_REQUESTS_PER_CRAWL,
	maxRequestsPerMinute: CONFIG.MAX_REQUESTS_PER_MINUTE,
	async requestHandler({ $, request, enqueueLinks, log, pushData }) {
		const url = request.loadedUrl;
		log.info(`Processing ${url}`);

		const title = $("title").text().trim();

		// Remove script, style, and other non-content tags
		$("script, style, noscript, iframe").remove();

		// Get the HTML content without scripts and styling
		const htmlContent = $("body").html();

		// Extract text from body, removing extra whitespace
		let plainText = $("body").text().replace(/\s+/g, " ").replace(/\n+/g, "\n").trim();

		// Remove any remaining HTML tags
		plainText = plainText.replace(/<[^>]*>/g, "");

		// Decode HTML entities
		plainText = he.decode(plainText);

		const pageData = {
			url,
			title,
			plainText,
			htmlContent,
		};

		await pushData(pageData);

		if (request.userData.depth < CONFIG.MAX_CRAWL_DEPTH) {
			await enqueueLinks({
				strategy: "same-hostname",
				transformRequestFunction: (req) => {
					req.userData.depth = (request.userData.depth || 0) + 1;
					return req;
				},
			});
		}
	},
	failedRequestHandler({ request, error }) {
		log.error(`Request ${request.url} failed: ${error.message}`);
		if (request.retryCount < CONFIG.RETRY_COUNT) {
			log.info(`Retrying request for ${request.url} (attempt ${request.retryCount + 1}/${CONFIG.RETRY_COUNT})`);
			return request;
		}
		log.warn(`Max retries reached for ${request.url}. Skipping.`);
		return false;
	},
});

console.log("Script started");
console.log("Base URL:", CONFIG.BASE_URL.href);

(async () => {
	try {
		await crawler.addRequests([{ url: CONFIG.BASE_URL.href, userData: { depth: 0 } }]);
		await crawler.run();

		console.log("Crawler finished.");
	} catch (error) {
		console.error(`An error occurred: ${error.message}`);
	}
})();
