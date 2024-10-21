// For more information, see https://crawlee.dev/
import { PlaywrightCrawler, Dataset } from "crawlee";
import { writeFile, mkdir, readFile, access } from "fs/promises";
import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Get the base URL from command line argument or use a default
const baseUrl = process.argv[2] || "https://www.semrush.com/";
const websiteName = new URL(baseUrl).hostname;

// Optimize Playwright settings
const launchContext = {
	launchOptions: {
		headless: true,
		args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
	},
};

// Function to get the file path for a given URL
function getFilePath(url) {
	try {
		const { pathname } = new URL(url);
		const parts = pathname.split("/").filter(Boolean);
		const fileName = parts.pop() || "index";
		const dirPath = path.join(__dirname, websiteName, ...parts);
		return path.join(dirPath, `${fileName}.json`);
	} catch (error) {
		console.error(`Error in getFilePath: ${error.message}`);
		return path.join(__dirname, websiteName, "error.json");
	}
}

// Function to check if a file exists
async function fileExists(filePath) {
	try {
		await access(filePath);
		return true;
	} catch {
		return false;
	}
}

// Helper function to safely evaluate page content
async function safeEvaluate(page, func, errorValue = null) {
	try {
		return await page.evaluate(func);
	} catch (error) {
		console.error(`Error in page.evaluate: ${error.message}`);
		return errorValue;
	}
}

// Helper function to calculate readability score (simplified Flesch-Kincaid)
function calculateReadabilityScore(text) {
	if (!text) return 0;
	const sentences = text.split(/[.!?]+/).filter(Boolean);
	const words = text.split(/\s+/).filter(Boolean);
	if (sentences.length === 0 || words.length === 0) return 0;
	const syllables = words.reduce((count, word) => count + syllableCount(word), 0);
	const score = 206.835 - 1.015 * (words.length / sentences.length) - 84.6 * (syllables / words.length);
	return parseFloat(score.toFixed(2));
}

function syllableCount(word) {
	if (!word) return 0;
	word = word.toLowerCase();
	if (word.length <= 3) return 1;
	word = word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "");
	word = word.replace(/^y/, "");
	const syllables = word.match(/[aeiouy]{1,2}/g);
	return syllables ? syllables.length : 0;
}

// PlaywrightCrawler crawls the web using a headless
// browser controlled by the Playwright library.
const crawler = new PlaywrightCrawler({
	launchContext,
	// Use the requestHandler to process each of the crawled pages.
	async requestHandler({ request, page, enqueueLinks, log }) {
		try {
			const url = request.loadedUrl;
			log.info(`Processing: ${url}`);

			const filePath = getFilePath(url);

			let data;
			let shouldScrape = true;

			// Check if the file already exists
			if (await fileExists(filePath)) {
				try {
					log.info(`File exists for ${url} - checking for changes`);
					const fileContent = await readFile(filePath, "utf8");
					data = JSON.parse(fileContent);

					// Compare current page title with stored title to check for changes
					const currentTitle = await page.title();
					if (currentTitle === data.seoElements.title.content) {
						log.info(`No changes detected for ${url} - using cached data`);
						shouldScrape = false;
					} else {
						log.info(`Changes detected for ${url} - re-scraping`);
					}
				} catch (error) {
					log.error(`Error reading or parsing existing file: ${error.message}`);
					shouldScrape = true;
				}
			}

			if (shouldScrape) {
				// Scroll the page to trigger any lazy-loaded content
				await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
				await page.waitForTimeout(2000);

				// Use Promise.all to run evaluations concurrently
				const [title, metaDescription, h1, h2s, h3s, mainContent, images, links, structuredData, publicationDate, pageType, socialMetaTags, canonicalUrl, hreflangTags, semanticStructure, contentToHtmlRatio] = await Promise.all([
					page.title(),
					safeEvaluate(page, () => document.querySelector('meta[name="description"]')?.content),
					safeEvaluate(page, () => {
						const h1El = document.querySelector("h1");
						return h1El ? { text: h1El.textContent.trim(), html: h1El.outerHTML } : null;
					}),
					safeEvaluate(page, () => Array.from(document.querySelectorAll("h2")).map((el) => ({ text: el.textContent.trim(), html: el.outerHTML }))),
					safeEvaluate(page, () => Array.from(document.querySelectorAll("h3")).map((el) => ({ text: el.textContent.trim(), html: el.outerHTML }))),
					safeEvaluate(page, () => {
						const main = document.querySelector("main") || document.querySelector("article") || document.body;
						return {
							html: main.innerHTML,
							text: main.innerText,
							wordCount: main.innerText.trim().split(/\s+/).length,
						};
					}),
					safeEvaluate(page, () => Array.from(document.querySelectorAll("img")).map((el) => ({ src: el.src, alt: el.alt, title: el.title, html: el.outerHTML }))),
					safeEvaluate(page, () => Array.from(document.querySelectorAll("a")).map((el) => ({ href: el.href, text: el.textContent.trim(), html: el.outerHTML, isInternal: el.href.startsWith(window.location.origin) }))),
					safeEvaluate(page, () => {
						const scripts = document.querySelectorAll('script[type="application/ld+json"]');
						return Array.from(scripts)
							.map((script) => {
								try {
									return JSON.parse(script.textContent);
								} catch (e) {
									return null;
								}
							})
							.filter((data) => data !== null);
					}),
					safeEvaluate(page, () => {
						const dateElement = document.querySelector("time") || document.querySelector(".date") || document.querySelector('[itemprop="datePublished"]');
						return dateElement ? dateElement.getAttribute("datetime") || dateElement.textContent : null;
					}),
					safeEvaluate(page, () => {
						if (window.location.pathname === "/" || window.location.pathname === "/index.html") return "homepage";
						if (document.querySelector("article")) return "blog_post";
						if (document.querySelector("form")) return "contact_page";
						return "general_content";
					}),
					safeEvaluate(page, () => {
						const ogTags = {};
						const twitterTags = {};
						document.querySelectorAll('meta[property^="og:"]').forEach((el) => {
							ogTags[el.getAttribute("property")] = el.getAttribute("content");
						});
						document.querySelectorAll('meta[name^="twitter:"]').forEach((el) => {
							twitterTags[el.getAttribute("name")] = el.getAttribute("content");
						});
						return { ogTags, twitterTags };
					}),
					safeEvaluate(page, () => document.querySelector('link[rel="canonical"]')?.href),
					safeEvaluate(page, () =>
						Array.from(document.querySelectorAll('link[rel="alternate"][hreflang]')).map((el) => ({
							hreflang: el.getAttribute("hreflang"),
							href: el.getAttribute("href"),
						}))
					),
					safeEvaluate(page, () => {
						const semanticElements = ["header", "nav", "main", "article", "section", "aside", "footer"];
						return semanticElements.reduce((acc, el) => {
							acc[el] = document.querySelector(el) !== null;
							return acc;
						}, {});
					}),
					safeEvaluate(page, () => {
						const html = document.documentElement.outerHTML;
						const text = document.body.innerText;
						return ((text.length / html.length) * 100).toFixed(2) + "%";
					}),
				]);

				// Perform URL structure analysis
				const urlAnalysis = new URL(url);
				const urlStructure = {
					protocol: urlAnalysis.protocol,
					hostname: urlAnalysis.hostname,
					pathname: urlAnalysis.pathname,
					search: urlAnalysis.search,
					hash: urlAnalysis.hash,
				};

				// Calculate readability score (example using Flesch-Kincaid)
				const readabilityScore = calculateReadabilityScore(mainContent?.text);

				data = {
					url,
					urlStructure,
					pageType,
					seoElements: {
						title: {
							content: title,
							length: title?.length ?? 0,
							label: "title_tag",
						},
						metaDescription: {
							content: metaDescription,
							length: metaDescription?.length ?? 0,
							label: "meta_description",
						},
						h1: h1 ? { ...h1, label: "main_heading" } : null,
						headings: {
							h2s: h2s?.map((h2) => ({ ...h2, label: "subheading_level_2" })) ?? [],
							h3s: h3s?.map((h3) => ({ ...h3, label: "subheading_level_3" })) ?? [],
						},
						canonicalUrl: {
							url: canonicalUrl,
							label: "canonical_url",
						},
						hreflangTags: {
							tags: hreflangTags ?? [],
							label: "hreflang_tags",
						},
					},
					content: mainContent
						? {
								...mainContent,
								readabilityScore,
								label: "main_content",
						  }
						: null,
					media: {
						images:
							images?.map((img) => ({
								...img,
								label: "image_data",
							})) ?? [],
					},
					links:
						links?.map((link) => ({
							...link,
							label: link.isInternal ? "internal_link" : "external_link",
						})) ?? [],
					seoData: {
						structuredData:
							structuredData?.map((sd) => ({
								content: sd,
								label: "json_ld_data",
							})) ?? [],
						socialMetaTags: {
							...socialMetaTags,
							label: "social_meta_tags",
						},
						semanticStructure: {
							...semanticStructure,
							label: "semantic_html5_usage",
						},
						contentToHtmlRatio: {
							ratio: contentToHtmlRatio,
							label: "content_to_html_ratio",
						},
						internalLinksCount: links?.filter((link) => link.isInternal).length ?? 0,
						externalLinksCount: links?.filter((link) => !link.isInternal).length ?? 0,
						imageCount: images?.length ?? 0,
						imagesWithAlt: images?.filter((img) => img.alt).length ?? 0,
						totalWordCount: mainContent?.wordCount ?? 0,
						label: "seo_metrics",
					},
					publicationInfo: {
						date: publicationDate,
						label: "publication_date",
					},
				};

				if (mainContent?.text) {
					const words = mainContent.text.toLowerCase().match(/\b\w+\b/g) || [];
					const wordFrequency = words.reduce((acc, word) => {
						acc[word] = (acc[word] || 0) + 1;
						return acc;
					}, {});
					const sortedWords = Object.entries(wordFrequency)
						.sort((a, b) => b[1] - a[1])
						.slice(0, 5)
						.map(([word, count]) => ({
							word,
							count,
							density: ((count / words.length) * 100).toFixed(2) + "%",
						}));

					data.seoData.keywordDensity = {
						topKeywords: sortedWords,
						label: "keyword_density",
					};
				}

				// Save the data for each page
				await Dataset.pushData(data);

				// Save the data as JSON
				await saveAsJSON(data);
			}

			// Enqueue all links from the page
			const enqueueResult = await enqueueLinks({
				strategy: "same-hostname", // This ensures we only crawl pages on the same domain
				transformRequestFunction: (req) => {
					// Exclude non-HTML resources
					if (!/\.(jpg|jpeg|png|gif|css|js|ico)$/i.test(req.url)) {
						log.info(`Enqueueing: ${req.url}`);
						return req;
					}
					log.debug(`Skipping non-HTML resource: ${req.url}`);
					return false;
				},
			});

			log.info(`Enqueued ${enqueueResult.processedRequests.length} links from ${url}`);
			log.debug(`Enqueued links: ${enqueueResult.processedRequests.map((r) => r.url).join(", ")}`);
		} catch (error) {
			log.error(`Unhandled error in requestHandler: ${error.message}`);
		}
	},
	maxConcurrency: 5, // Adjust based on your system's capabilities
	maxRequestsPerCrawl: 1000, // Increased from 100
	maxRequestRetries: 3,
	requestHandlerTimeoutSecs: 60,
	navigationTimeoutSecs: 30,
});

// Function to save data as JSON
async function saveAsJSON(item) {
	try {
		const filePath = getFilePath(item.url);
		const dirPath = path.dirname(filePath);

		await mkdir(dirPath, { recursive: true });
		await writeFile(filePath, JSON.stringify(item, null, 2));
	} catch (error) {
		console.error(`Error saving JSON file: ${error.message}`);
	}
}

// Function to generate PDF
async function generatePDF(data) {
	const browser = await chromium.launch();
	const page = await browser.newPage();

	try {
		let htmlContent = "<html><body>";
		for (const item of data) {
			htmlContent += `<h1>${item.seoElements.title.content || "No Title"}</h1>`;
			htmlContent += `<p>URL: ${item.url}</p>`;
			htmlContent += `<p>${item.content?.text || "No Content"}</p>`;
			htmlContent += "<hr>";
		}
		htmlContent += "</body></html>";

		await page.setContent(htmlContent);
		await page.pdf({ path: "output.pdf", format: "A4" });
		console.log("PDF generated successfully!");
	} catch (error) {
		console.error(`Error generating PDF: ${error.message}`);
	} finally {
		await browser.close();
	}
}

// Run the crawler and then generate the PDF
async function main() {
	try {
		await crawler.run([baseUrl]);

		const dataset = await Dataset.open();
		const data = await dataset.getData();

		console.log(`Crawled ${data.items.length} pages`);

		const outputFormat = process.argv[3] || "json";

		if (outputFormat === "pdf") {
			await generatePDF(data.items);
		} else {
			console.log("JSON files have been generated during the crawl.");
		}
	} catch (error) {
		console.error(`Error in main function: ${error.message}`);
	}
}

main().catch(console.error);
