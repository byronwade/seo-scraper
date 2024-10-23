const { CheerioCrawler, RequestQueue, log } = require('crawlee');
const { URL } = require('url');
const path = require('path');
const fs = require('fs').promises;
const slugify = require('slugify');

// Global Configuration
const CONFIG = {
    baseUrl: process.argv[2] || 'https://www.semrush.com/blog/',
    maxConcurrency: 1,
    maxRequestsPerCrawl: 1000000,
    requestTimeout: 30000,
    retryCount: 5,
    userAgents: [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Safari/605.1.15',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:89.0) Gecko/20100101 Firefox/89.0'
    ],
    minDelayBetweenRequests: 0,
    maxDelayBetweenRequests: 0,
};

let processedPages = 0;
const processedUrls = new Set();

// Utility Functions
function normalizeUrl(url) {
    const parsedUrl = new URL(url);
    parsedUrl.hash = '';
    parsedUrl.search = '';
    let path = parsedUrl.pathname;
    if (path.endsWith('/')) path = path.slice(0, -1);
    if (!path) path = '/';
    return `${parsedUrl.origin}${path}`.toLowerCase();
}

async function generateFilePath(url) {
    const parsedUrl = new URL(url);
    let urlPath = parsedUrl.pathname;
    
    if (urlPath.endsWith('/')) {
        urlPath = urlPath.slice(0, -1);
    }
    
    if (!urlPath || urlPath === '/') {
        urlPath = '/index';
    }

    const dirPath = path.join(parsedUrl.hostname, path.dirname(urlPath));
    const fileName = path.basename(urlPath) + '.json';
    const filePath = path.join(dirPath, fileName);

    await fs.mkdir(dirPath, { recursive: true });
    return filePath;
}

async function savePageDataAsJson(url, data) {
    const filePath = await generateFilePath(url);
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
    processedPages++;
    log.info(`Saved: ${filePath} (Total: ${processedPages})`);
}

function extractCleanText($, selector) {
    return $(selector)
        .clone()
        .find('script, style').remove().end()
        .text()
        .trim()
        .replace(/\s+/g, ' ');
}

function extractPageData($, url) {
    const title = $('title').text().trim();
    
    const descriptionSelectors = [
        'meta[name="description"]',
        'meta[property="og:description"]',
        'meta[name="twitter:description"]',
        'meta[itemprop="description"]'
    ];
    let description = '';
    for (const selector of descriptionSelectors) {
        description = $(selector).attr('content');
        if (description) break;
    }
    if (!description) {
        description = $('p').first().text().trim().substring(0, 160);
    }
    
    const contentSelectors = ['article', '.post-content', '.entry-content', '#main-content', '.blog-post', 'main', 'body'];
    let content = '';
    for (const selector of contentSelectors) {
        content = extractCleanText($, selector);
        if (content) break;
    }

    const headers = [];
    $('h1, h2, h3, h4, h5, h6').each((i, elem) => {
        const level = elem.name.toUpperCase();
        const text = $(elem).text().trim();
        headers.push({ level, text });
    });

    const author = $('meta[name="author"]').attr('content') || 
                   $('a[rel="author"]').text().trim() || '';

    const slug = extractSlug(url);

    return {
        url,
        slug,
        title,
        description,
        content,
        headers,
        author,
    };
}

function extractSlug(url) {
    const parsedUrl = new URL(url);
    let pathName = parsedUrl.pathname;
    
    if (pathName.endsWith('/')) {
        pathName = pathName.slice(0, -1);
    }

    const parts = pathName.split('/');
    const lastPart = parts[parts.length - 1];

    const slugBase = lastPart || parts[parts.length - 2] || '';

    return slugify(slugBase, {
        lower: true,
        strict: true,
        remove: /[*+~.()'"!:@]/g
    });
}

function getRandomUserAgent() {
    return CONFIG.userAgents[Math.floor(Math.random() * CONFIG.userAgents.length)];
}

function getRandomDelay() {
    return Math.floor(Math.random() * (CONFIG.maxDelayBetweenRequests - CONFIG.minDelayBetweenRequests + 1) + CONFIG.minDelayBetweenRequests);
}

// Main Crawler Function
async function main() {
    const requestQueue = await RequestQueue.open();
    
    const normalizedBaseUrl = normalizeUrl(CONFIG.baseUrl);
    await requestQueue.addRequest({ url: normalizedBaseUrl });
    processedUrls.add(normalizedBaseUrl);

    const crawler = new CheerioCrawler({
        requestQueue,
        maxConcurrency: CONFIG.maxConcurrency,
        maxRequestsPerCrawl: CONFIG.maxRequestsPerCrawl,
        requestHandler: async ({ request, $, enqueueLinks }) => {
            const { url } = request;
            log.info(`Processing: ${url}`);

            const pageData = extractPageData($, url);
            await savePageDataAsJson(url, pageData);

            await enqueueLinks({
                strategy: 'same-domain',
                transformRequestFunction: (req) => {
                    const normalizedUrl = normalizeUrl(req.url);
                    if (!processedUrls.has(normalizedUrl) && normalizedUrl.startsWith(CONFIG.baseUrl)) {
                        processedUrls.add(normalizedUrl);
                        log.debug(`Enqueued: ${normalizedUrl}`);
                        return {
                            ...req,
                            userData: { ...req.userData, enqueueTime: Date.now() }
                        };
                    }
                    return false;
                },
            });

            const delay = getRandomDelay();
            log.debug(`Waiting for ${delay}ms before next request`);
            await new Promise(resolve => setTimeout(resolve, delay));
        },
        failedRequestHandler: async ({ request, error }) => {
            log.error(`Request ${request.url} failed: ${error.message}`);
        },
        preNavigationHooks: [
            async ({ request }) => {
                const timeSinceEnqueue = Date.now() - (request.userData.enqueueTime || 0);
                const minWaitTime = CONFIG.minDelayBetweenRequests;
                if (timeSinceEnqueue < minWaitTime) {
                    const waitTime = minWaitTime - timeSinceEnqueue;
                    log.debug(`Waiting additional ${waitTime}ms before request`);
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                }
            },
        ],
        navigationTimeoutSecs: 60,
        requestHandlerTimeoutSecs: 90,
    });

    log.info('Starting the crawl');
    await crawler.run();
    log.info(`Crawl finished. Total pages processed: ${processedPages}`);
    log.info(`Total unique URLs discovered: ${processedUrls.size}`);
}

main().catch((error) => log.error(error));
