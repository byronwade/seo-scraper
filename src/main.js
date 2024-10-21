// For more information, see https://crawlee.dev/
import { PlaywrightCrawler, Dataset } from "crawlee";
import { writeFile, mkdir, readFile, access } from "fs/promises";
import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";
import axios from "axios";
import { promisify } from "util";
import { pipeline } from "stream";
import { parseString } from "xml2js";

const pipelineAsync = promisify(pipeline);
const parseXml = promisify(parseString);

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

async function fetchRobotsTxt(url) {
	try {
		const robotsUrl = new URL("/robots.txt", url).href;
		const response = await axios.get(robotsUrl);
		const robotsTxt = response.data;

		// Save robots.txt
		await writeFile(path.join(__dirname, websiteName, "robots.txt"), robotsTxt);

		// Simple parser for robots.txt
		const parsed = {
			userAgents: {},
			sitemaps: [],
		};
		let currentUserAgent = "*";

		robotsTxt.split("\n").forEach((line) => {
			line = line.trim().toLowerCase();
			if (line.startsWith("user-agent:")) {
				currentUserAgent = line.split(":")[1].trim();
				if (!parsed.userAgents[currentUserAgent]) {
					parsed.userAgents[currentUserAgent] = { allow: [], disallow: [] };
				}
			} else if (line.startsWith("allow:")) {
				parsed.userAgents[currentUserAgent].allow.push(line.split(":")[1].trim());
			} else if (line.startsWith("disallow:")) {
				parsed.userAgents[currentUserAgent].disallow.push(line.split(":")[1].trim());
			} else if (line.startsWith("sitemap:")) {
				parsed.sitemaps.push(line.split(":")[1].trim());
			}
		});

		return parsed;
	} catch (error) {
		console.error(`Error fetching robots.txt: ${error.message}`);
		return null;
	}
}

async function fetchSitemap(url, isIndex = false) {
	try {
		const response = await axios.get(url);
		const sitemapXml = response.data;

		// Save sitemap
		const sitemapFileName = `sitemap_${path.basename(url)}`;
		await writeFile(path.join(__dirname, websiteName, sitemapFileName), sitemapXml);

		// Parse sitemap
		const parsed = await parseXml(sitemapXml);

		if (parsed.sitemapindex) {
			// This is a sitemap index
			console.log(`Found sitemap index at ${url}`);
			const sitemapUrls = parsed.sitemapindex.sitemap.map((sitemap) => sitemap.loc[0]);
			let allUrls = [];
			for (const sitemapUrl of sitemapUrls) {
				const urls = await fetchSitemap(sitemapUrl, true);
				allUrls = allUrls.concat(urls);
			}
			return allUrls;
		} else if (parsed.urlset) {
			// This is a regular sitemap
			return parsed.urlset.url.map((u) => u.loc[0]);
		} else {
			console.error(`Unknown sitemap format at ${url}`);
			return [];
		}
	} catch (error) {
		console.error(`Error fetching sitemap at ${url}: ${error.message}`);
		return [];
	}
}

async function fetchAllSitemaps(baseUrl, robotsTxt) {
	let sitemapUrls = [];

	// First, check robots.txt for sitemaps
	if (robotsTxt && robotsTxt.sitemaps && robotsTxt.sitemaps.length > 0) {
		for (const sitemapUrl of robotsTxt.sitemaps) {
			const urls = await fetchSitemap(sitemapUrl);
			sitemapUrls = sitemapUrls.concat(urls);
		}
	}

	// If no sitemaps found in robots.txt, try the default location
	if (sitemapUrls.length === 0) {
		const defaultSitemapUrl = new URL("/sitemap.xml", baseUrl).href;
		sitemapUrls = await fetchSitemap(defaultSitemapUrl);
	}

	console.log(`Total URLs found in sitemaps: ${sitemapUrls.length}`);
	return sitemapUrls;
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
				const [title, metaDescription, h1, h2s, h3s, mainContent, images, links, structuredData, publicationDate, pageType, socialMetaTags, canonicalUrl, hreflangTags, semanticStructure, contentToHtmlRatio, pageLoadTime, richSnippets, keywordUsage, mediaOptimization, mobileFriendliness, pageSpeedInsights, contentQualityMetrics, internalLinkingStructure, userExperienceSignals] = await Promise.all([
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
					safeEvaluate(page, () => {
						const navEntry = performance.getEntriesByType("navigation")[0];
						return navEntry.loadEventEnd - navEntry.startTime;
					}),
					safeEvaluate(page, () => {
						const richSnippets = [];
						document.querySelectorAll("[itemtype]").forEach((el) => {
							richSnippets.push({
								type: el.getAttribute("itemtype"),
								properties: Array.from(el.querySelectorAll("[itemprop]")).map((prop) => ({
									name: prop.getAttribute("itemprop"),
									content: prop.textContent,
								})),
							});
						});
						return richSnippets;
					}),
					safeEvaluate(page, () => {
						const text = document.body.innerText.toLowerCase();
						const words = text.match(/\b\w+\b/g) || [];
						const wordFreq = words.reduce((acc, word) => {
							acc[word] = (acc[word] || 0) + 1;
							return acc;
						}, {});
						return Object.entries(wordFreq)
							.sort((a, b) => b[1] - a[1])
							.slice(0, 10)
							.map(([word, count]) => ({ word, count, density: ((count / words.length) * 100).toFixed(2) + "%" }));
					}),
					safeEvaluate(page, () => {
						return Array.from(document.querySelectorAll("img")).map((img) => ({
							src: img.src,
							alt: img.alt,
							width: img.width,
							height: img.height,
							fileSize: img.complete ? (img.naturalWidth * img.naturalHeight * 4) / 1024 : "Unknown", // Rough estimate
							lazyLoaded: img.loading === "lazy",
						}));
					}),
					checkMobileFriendliness(page),
					getPageSpeedInsights(url),
					analyzeContentQuality(page),
					analyzeInternalLinking(page),
					analyzeUserExperience(page),
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

				data = {
					url,
					urlStructure: new URL(url),
					pageType,
					seoElements: {
						title: { content: title || "", length: (title || "").length },
						metaDescription: { content: metaDescription || "", length: metaDescription?.length || 0 },
						h1: h1 || null,
						headings: { h2s: h2s || [], h3s: h3s || [] },
						canonicalUrl: canonicalUrl || null,
						hreflangTags: hreflangTags || [],
					},
					content: mainContent
						? {
								...mainContent,
								readabilityScore: calculateReadabilityScore(mainContent.text),
						  }
						: null,
					media: { images: images || [] },
					links: links || [],
					seoData: {
						structuredData: structuredData || [],
						socialMetaTags: socialMetaTags || {},
						semanticStructure: semanticStructure || {},
						contentToHtmlRatio: contentToHtmlRatio || "",
						internalLinksCount: links?.filter((l) => l.isInternal)?.length || 0,
						externalLinksCount: links?.filter((l) => !l.isInternal)?.length || 0,
						imageCount: images?.length || 0,
						imagesWithAlt: images?.filter((img) => img.alt)?.length || 0,
						totalWordCount: mainContent?.wordCount || 0,
						pageLoadTime: pageLoadTime || 0,
						richSnippets: richSnippets || [],
						keywordUsage: keywordUsage || [],
						mediaOptimization: mediaOptimization || [],
					},
					publicationInfo: { date: publicationDate || null },
					advancedSeoMetrics: {
						mobileFriendliness: mobileFriendliness || {},
						pageSpeedInsights: pageSpeedInsights || {},
						contentQualityMetrics: contentQualityMetrics || {},
						internalLinkingStructure: internalLinkingStructure || {},
						userExperienceSignals: userExperienceSignals || {},
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
			await enqueueLinks({
				strategy: "same-hostname",
				transformRequestFunction: (req) => {
					if (!/\.(jpg|jpeg|png|gif|css|js|ico)$/i.test(req.url)) {
						log.info(`Enqueueing: ${req.url}`);
						return req;
					}
					log.debug(`Skipping non-HTML resource: ${req.url}`);
					return false;
				},
			});
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
		// Fetch and save robots.txt
		const robotsTxt = await fetchRobotsTxt(baseUrl);
		console.log("Robots.txt fetched and saved.");

		// Fetch all sitemaps
		const sitemapUrls = await fetchAllSitemaps(baseUrl, robotsTxt);
		console.log(`Sitemap(s) fetched. Found ${sitemapUrls.length} URLs.`);

		// If sitemap URLs are available, use them for crawling
		if (sitemapUrls.length > 0) {
			await crawler.run(sitemapUrls);
		} else {
			// If no sitemap URLs, start with the base URL
			await crawler.run([baseUrl]);
		}

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

// New helper functions for advanced SEO metrics

async function checkMobileFriendliness(page) {
	// You would typically use Google's Mobile-Friendly Test API here
	// This is a placeholder implementation
	return { isMobileFriendly: true, issues: [] };
}

async function getPageSpeedInsights(url) {
	// You would typically use Google's PageSpeed Insights API here
	// This is a placeholder implementation
	return { score: 85, opportunities: [] };
}

async function analyzeContentQuality(page) {
	return safeEvaluate(page, () => {
		const content = document.body.innerText;
		return {
			wordCount: content.split(/\s+/).length,
			sentenceCount: content.split(/[.!?]+/).length,
			averageSentenceLength: content.split(/\s+/).length / content.split(/[.!?]+/).length,
			uniqueWords: new Set(content.toLowerCase().match(/\b\w+\b/g)).size,
		};
	});
}

async function analyzeInternalLinking(page) {
	return safeEvaluate(page, () => {
		const internalLinks = Array.from(document.querySelectorAll('a[href^="/"], a[href^="' + window.location.origin + '"]'));
		return {
			count: internalLinks.length,
			distribution: internalLinks.reduce((acc, link) => {
				const href = link.getAttribute("href");
				acc[href] = (acc[href] || 0) + 1;
				return acc;
			}, {}),
		};
	});
}

async function analyzeUserExperience(page) {
	return safeEvaluate(page, () => {
		const cls = performance.getEntriesByType("layout-shift").reduce((sum, ls) => sum + ls.value, 0);
		const fid = performance.getEntriesByType("first-input")[0]?.processingStart - performance.getEntriesByType("first-input")[0]?.startTime;
		const lcp = performance.getEntriesByType("largest-contentful-paint").pop()?.renderTime || performance.getEntriesByType("largest-contentful-paint").pop()?.loadTime;

		return { cls, fid, lcp };
	});
}
