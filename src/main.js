// For more information, see https://crawlee.dev/
import { PlaywrightCrawler, Dataset, Configuration, KeyValueStore } from "crawlee";
import { writeFile, mkdir, readFile, access } from "fs/promises";
import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";
import axios from "axios";
import { promisify } from "util";
import { pipeline } from "stream";
import { parseString } from "xml2js";
import CacheableRequest from 'cacheable-request';

// Global Configuration Variables
const CONFIG = {
    BASE_URL: new URL(process.argv[2] || "https://developers.google.com/search/"),
    MAX_CRAWL_DEPTH: 3,
    MAX_CONCURRENCY: 100,
    MAX_REQUESTS_PER_CRAWL: 1000,
    REQUEST_TIMEOUT: 30000,
    RETRY_COUNT: 3,
    SITEMAP_CONCURRENCY: 50,
    CACHE_ENABLED: true,
    USER_AGENT: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    RESPECT_ROBOTS_TXT: true,
    CRAWL_SITEMAP: true,
};

const pipelineAsync = promisify(pipeline);
const parseXml = promisify(parseString);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const websiteName = CONFIG.BASE_URL.hostname;
const basePath = CONFIG.BASE_URL.pathname;

// Create a Set to store crawled URLs
const crawledUrls = new Set();

// Create a caching layer for HTTP requests
const cacheableRequest = new CacheableRequest(
  (options, callback) => {
    axios(options)
      .then(response => {
        callback(null, response);
      })
      .catch(error => {
        callback(error);
      });
  }
);

// Create a promise-based wrapper for cacheableRequest
function fetchWithCache(url, options = {}) {
  if (!CONFIG.CACHE_ENABLED) {
    return axios(url, options);
  }
  return new Promise((resolve, reject) => {
    cacheableRequest(url, options, (error, response) => {
      if (error) {
        reject(error);
      } else {
        resolve(response);
      }
    });
  });
}

// Fetch robots.txt
async function fetchRobotsTxt(baseUrl) {
    const robotsTxtUrl = new URL('/robots.txt', baseUrl).href;
    return await fetchWithCache(robotsTxtUrl);
}

// Fetch and process sitemaps
async function fetchAllSitemaps(baseUrl, robotsTxt) {
    let sitemapUrls = [];

    if (robotsTxt) {
        const sitemapRegex = /Sitemap:\s*(.+)/gi;
        let match;
        while ((match = sitemapRegex.exec(robotsTxt)) !== null) {
            sitemapUrls.push(match[1]);
        }
    }

    if (sitemapUrls.length === 0) {
        sitemapUrls.push(new URL('/sitemap.xml', baseUrl).href);
    }

    return sitemapUrls;
}

// Fetch and cache sitemap data
async function fetchAndCacheSitemap(url) {
    const cacheKey = `sitemap:${url}`;
    const cachedData = await KeyValueStore.getValue(cacheKey);
    
    if (cachedData && CONFIG.CACHE_ENABLED) {
        console.log(`Using cached sitemap for ${url}`);
        return cachedData;
    }

    console.log(`Fetching sitemap from ${url}`);
    try {
        const response = await fetchWithCache(url);
        const sitemapXml = response.data;
        const parsed = await parseXml(sitemapXml);
        
        if (CONFIG.CACHE_ENABLED) {
            await KeyValueStore.setValue(cacheKey, parsed);
        }
        return parsed;
    } catch (error) {
        console.error(`Error fetching sitemap at ${url}: ${error.message}`);
        return null;
    }
}

// Process sitemaps concurrently
async function processSitemaps(sitemapUrls) {
  const chunkSize = CONFIG.SITEMAP_CONCURRENCY;
  const results = [];

  for (let i = 0; i < sitemapUrls.length; i += chunkSize) {
    const chunk = sitemapUrls.slice(i, i + chunkSize);
    const chunkResults = await Promise.all(chunk.map(fetchAndProcessSitemap));
    results.push(...chunkResults.flat());
  }

  return results;
}

async function fetchAndProcessSitemap(url) {
  const sitemapXml = await fetchWithCache(url);
  if (!sitemapXml) return [];

  try {
    const sitemap = await parseXml(sitemapXml);
    if (sitemap.sitemapindex) {
      const subSitemapUrls = sitemap.sitemapindex.sitemap.map(s => s.loc[0]);
      return (await Promise.all(subSitemapUrls.map(fetchAndProcessSitemap))).flat();
    } else if (sitemap.urlset) {
      return sitemap.urlset.url.map(u => u.loc[0]);
    }
  } catch (error) {
    console.error(`Error processing sitemap at ${url}: ${error.message}`);
  }

  return [];
}

const seenUrls = new Set();

function isNewUrl(url) {
  const normalizedUrl = normalizeUrl(url);
  if (seenUrls.has(normalizedUrl)) {
    return false;
  }
  seenUrls.add(normalizedUrl);
  return true;
}

function normalizeUrl(url) {
  const parsedUrl = new URL(url);
  parsedUrl.searchParams.delete('hl');
  return parsedUrl.toString();
}

function shouldCrawl(url) {
  const parsedUrl = new URL(url);
  return parsedUrl.hostname === CONFIG.BASE_URL.hostname &&
         parsedUrl.pathname.startsWith(CONFIG.BASE_URL.pathname) &&
         !parsedUrl.pathname.match(/\.(jpg|jpeg|png|gif|css|js|ico)$/i);
}

// PlaywrightCrawler configuration
const crawler = new PlaywrightCrawler({
    launchContext: {
        launchOptions: {
            headless: true,
        },
    },
    maxConcurrency: CONFIG.MAX_CONCURRENCY,
    maxRequestsPerCrawl: CONFIG.MAX_REQUESTS_PER_CRAWL,
    maxRequestRetries: CONFIG.RETRY_COUNT,
    requestHandlerTimeoutSecs: CONFIG.REQUEST_TIMEOUT / 1000,
    useSessionPool: true,
    persistCookiesPerSession: true,
    // Use the requestHandler to process each of the crawled pages.
    async requestHandler({ request, page, enqueueLinks, log }) {
        const url = request.loadedUrl;
        
        if (!isNewUrl(url) || !shouldCrawl(url)) {
            return;
        }
        
        log.info(`Processing ${url}`);

        // Extract page title
        const title = await page.title();
        log.info(`Title: ${title}`);

        // Extract all links on the page
        const links = await page.evaluate(() => {
            return Array.from(document.links).map(link => link.href);
        });
        log.info(`Found ${links.length} links on the page`);

        // Enqueue links for further crawling
        if (request.userData.depth < CONFIG.MAX_CRAWL_DEPTH) {
            await enqueueLinks({
                urls: links,
                transformRequestFunction: (req) => {
                    req.userData.depth = request.userData.depth + 1;
                    return isNewUrl(req.url) && shouldCrawl(req.url) ? req : false;
                },
            });
        }

        // Save the data
        await Dataset.pushData({
            url: url,
            title: title,
            linksCount: links.length,
        });
    },
});

// Main execution
(async () => {
    try {
        let startUrls = [CONFIG.BASE_URL.href];

        if (CONFIG.CRAWL_SITEMAP) {
            const robotsTxt = CONFIG.RESPECT_ROBOTS_TXT ? await fetchRobotsTxt(CONFIG.BASE_URL) : null;
            const sitemapUrls = await fetchAllSitemaps(CONFIG.BASE_URL, robotsTxt);
            
            console.log("Processing sitemaps...");
            const urls = await Promise.all(sitemapUrls.map(fetchAndProcessSitemap));
            const flatUrls = urls.flat();
            
            console.log(`Total URLs found in sitemaps: ${flatUrls.length}`);

            const filteredUrls = flatUrls.filter(url => shouldCrawl(url));
            console.log(`URLs under specified path: ${filteredUrls.length}`);

            startUrls = [...new Set([...startUrls, ...filteredUrls])];
        }

        await crawler.addRequests(startUrls.map(url => ({ 
            url, 
            userData: { depth: 0 } 
        })));

        await crawler.run();

        console.log("Crawler finished.");
    } catch (error) {
        console.error(`An error occurred: ${error.message}`);
    }
})();
