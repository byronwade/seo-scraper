import asyncio
import aiohttp
import aiofiles
import os
import sys
import json
import logging
import urllib.parse
from bs4 import BeautifulSoup
import xml.etree.ElementTree as ET
import re
from urllib.robotparser import RobotFileParser
from datetime import datetime

# Suppress InsecureRequestWarning
import warnings
warnings.filterwarnings("ignore", category=UserWarning, module='aiohttp')

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

# Global configuration
class Config:
    def __init__(self):
        self.base_url = "https://byronwade.com"
        self.max_crawl_depth = 1000
        self.max_concurrency = 5  # Reduced concurrency to 5
        self.request_timeout = 30
        self.user_agent = "MyAsyncScraper/1.0"
        self.respect_robots_txt = True
        self.crawl_sitemap = True
        self.skip_sitemap_robots = True
        # Added variables for exponential backoff
        self.initial_backoff_time = 1  # in seconds
        self.max_backoff_time = 60     # in seconds
        self.max_retries = 5           # Maximum number of retries

CONFIG = Config()

# Global variables for crawler state
visited_urls = set()
lock = asyncio.Lock()
robots_parser = None

# Initialize configuration
def init_config():
    global CONFIG, robots_parser
    if len(sys.argv) > 1:
        CONFIG.base_url = sys.argv[1]
    
    if CONFIG.respect_robots_txt:
        robots_url = urllib.parse.urljoin(CONFIG.base_url, '/robots.txt')
        robots_parser = RobotFileParser()
        robots_parser.set_url(robots_url)
        try:
            robots_parser.read()
            logging.info(f"Read robots.txt from {robots_url}")
        except Exception as e:
            logging.warning(f"Could not read robots.txt from {robots_url}: {e}")
            robots_parser = None

# Utility functions
def normalize_url(url):
    parsed = urllib.parse.urlparse(url)
    # Remove fragment
    parsed = parsed._replace(fragment='')
    # Lowercase scheme and hostname
    normalized = parsed._replace(scheme=parsed.scheme.lower(), netloc=parsed.netloc.lower())
    return urllib.parse.urlunparse(normalized)

def generate_file_path(url):
    parsed_url = urllib.parse.urlparse(url)
    relative_path = parsed_url.path.strip("/")
    parts = relative_path.split("/")
    current_path = os.path.join(".", parsed_url.hostname)
    
    for part in parts[:-1]:
        current_path = os.path.join(current_path, slugify(part))
        os.makedirs(current_path, exist_ok=True)
    
    file_name = "index"
    if parts and parts[-1]:
        file_name = slugify(parts[-1])
    
    return os.path.join(current_path, f"{file_name}.json")

def slugify(text):
    text = text.lower()
    text = re.sub(r'[^\w\s-]', '', text)
    text = re.sub(r'[\s_-]+', '-', text)
    return text.strip('-')

def should_crawl(url):
    parsed_url = urllib.parse.urlparse(url)
    base_parsed = urllib.parse.urlparse(CONFIG.base_url)
    if parsed_url.netloc != base_parsed.netloc:
        return False
    if not parsed_url.path.startswith(base_parsed.path):
        return False
    if parsed_url.path.endswith(('.pdf', '.jpg', '.png', '.gif', '.jpeg', '.svg', '.ico', '.css', '.js')):
        return False
    if CONFIG.respect_robots_txt and robots_parser:
        if not robots_parser.can_fetch(CONFIG.user_agent, url):
            logging.info(f"Disallowed by robots.txt: {url}")
            return False
    return True

async def save_page_data_as_json(url, data):
    file_path = generate_file_path(url)
    os.makedirs(os.path.dirname(file_path), exist_ok=True)
    
    class HTMLEncoder(json.JSONEncoder):
        def encode(self, o):
            return super(HTMLEncoder, self).encode(o).replace('\\u003c', '<').replace('\\u003e', '>').replace('\\u0026', '&')
    
    async with aiofiles.open(file_path, 'w', encoding='utf-8') as f:
        await f.write(json.dumps(data, ensure_ascii=False, indent=2, cls=HTMLEncoder))
    
    logging.info(f"Saved: {file_path}")

# Content extraction functions
def extract_page_data(html, url):
    try:
        soup = BeautifulSoup(html, 'html.parser')
        title = extract_title(soup)
        description = extract_description(soup)
        date = extract_date(soup, html)
        content = extract_content(soup)
        slug = extract_slug(soup, url)
        
        return {
            "url": url,
            "slug": slug,
            "title": title,
            "description": description,
            "date": date,
            "content": content
            # Add more fields here if needed
        }
    except Exception as e:
        logging.error(f"Error extracting page data for {url}: {str(e)}")
        return {
            "url": url,
            "error": str(e)
        }

def extract_title(soup):
    if soup.title and soup.title.string:
        return soup.title.string.strip()
    return ""

def extract_description(soup):
    meta = soup.find('meta', attrs={'name': 'description'})
    if meta and 'content' in meta.attrs:
        return meta['content'].strip()
    return ""

def extract_date(soup, html):
    # Try to find date in meta tags
    date_meta_tags = [
        {'name': 'meta', 'attrs': {'property': 'article:published_time'}},
        {'name': 'meta', 'attrs': {'property': 'og:published_time'}},
        {'name': 'meta', 'attrs': {'name': 'pubdate'}},
        {'name': 'meta', 'attrs': {'name': 'publishdate'}},
        {'name': 'meta', 'attrs': {'name': 'timestamp'}},
        {'name': 'meta', 'attrs': {'name': 'date'}},
        {'name': 'meta', 'attrs': {'itemprop': 'datePublished'}},
        {'name': 'time', 'attrs': {'class': re.compile('pub.*date|date.*pub')}},
        {'name': 'span', 'attrs': {'class': re.compile('pub.*date|date.*pub')}},
        {'name': 'div', 'attrs': {'class': re.compile('pub.*date|date.*pub')}},
    ]
    for tag_info in date_meta_tags:
        elements = soup.find_all(tag_info['name'], attrs=tag_info.get('attrs', {}))
        for elem in elements:
            date_str = ''
            if 'content' in elem.attrs:
                date_str = elem['content']
            elif 'datetime' in elem.attrs:
                date_str = elem['datetime']
            else:
                date_str = elem.get_text(strip=True)
            if date_str:
                parsed_date = parse_date(date_str)
                if parsed_date:
                    return parsed_date
    # Fallback: Try to find dates in the text using regex
    date_patterns = [
        r'\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|'
        r'Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|'
        r'Dec(?:ember)?)\s+\d{1,2},\s+\d{4}\b',
        r'\b\d{1,2}\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|'
        r'Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|'
        r'Dec(?:ember)?)\s+\d{4}\b',
        r'\b\d{4}-\d{2}-\d{2}\b',
        r'\b\d{2}/\d{2}/\d{4}\b',
        r'\b\d{1,2}\.\d{1,2}\.\d{4}\b',
    ]
    text = soup.get_text(separator=' ', strip=True)
    for pattern in date_patterns:
        match = re.search(pattern, text)
        if match:
            date_str = match.group(0)
            parsed_date = parse_date(date_str)
            if parsed_date:
                return parsed_date
    return ""

def parse_date(date_str):
    date_formats = [
        '%B %d, %Y',  # January 1, 2020
        '%b %d, %Y',  # Jan 1, 2020
        '%d %B %Y',   # 1 January 2020
        '%Y-%m-%d',   # 2020-01-01
        '%d/%m/%Y',   # 01/01/2020
        '%m/%d/%Y',   # 01/01/2020
        '%d.%m.%Y',   # 01.01.2020
    ]
    for fmt in date_formats:
        try:
            dt = datetime.strptime(date_str, fmt)
            return dt.strftime('%Y-%m-%d')
        except ValueError:
            continue
    return ""

def extract_content(soup):
    # Remove unwanted tags
    for tag in soup(['script', 'style', 'header', 'footer', 'nav', 'aside', 'form', 'noscript']):
        tag.extract()
    text = soup.get_text(separator=' ', strip=True)
    # Clean up whitespace
    text = re.sub(r'\s+', ' ', text)
    return text

def extract_slug(soup, url):
    # Try to find slug in meta tags or link tags
    meta = soup.find('meta', attrs={'name': 'slug'})
    if meta and 'content' in meta.attrs:
        return meta['content'].strip()
    # Fallback: Generate slug from URL
    parsed_url = urllib.parse.urlparse(url)
    path = parsed_url.path.strip('/')
    if path:
        slug = slugify(path.split('/')[-1])
        return slug
    else:
        return 'home'

# Asynchronous crawler functions
async def crawl():
    init_config()
    logging.info(f"Starting crawl of {CONFIG.base_url}")
    
    root_dir = os.path.join(".", urllib.parse.urlparse(CONFIG.base_url).hostname)
    os.makedirs(root_dir, exist_ok=True)
    
    start_urls = []
    
    if CONFIG.crawl_sitemap:
        sitemap_url = urllib.parse.urljoin(CONFIG.base_url, '/sitemap.xml')
        sitemap_urls = [sitemap_url]
        urls_from_sitemaps = await process_sitemaps_recursively(sitemap_urls)
        if urls_from_sitemaps:
            for sitemap_url in urls_from_sitemaps:
                if should_crawl(sitemap_url):
                    start_urls.append((sitemap_url, 0))
        else:
            logging.warning("No URLs found in sitemap. Starting from base URL.")
            start_urls.append((CONFIG.base_url, 0))
    else:
        # Start with the base URL
        start_urls.append((CONFIG.base_url, 0))
    
    if not start_urls:
        logging.error("No URLs to crawl. Exiting.")
        return
    
    semaphore = asyncio.Semaphore(CONFIG.max_concurrency)
    tasks = []
    session_timeout = aiohttp.ClientTimeout(total=CONFIG.request_timeout)
    async with aiohttp.ClientSession(timeout=session_timeout, headers={'User-Agent': CONFIG.user_agent}) as session:
        for url, depth in start_urls:
            task = asyncio.ensure_future(process_url(session, url, depth, semaphore))
            tasks.append(task)
        await asyncio.gather(*tasks)
    
    logging.info("Crawler finished.")
    logging.info(f"Total URLs crawled: {len(visited_urls)}")

async def process_url(session, url, depth, semaphore):
    url = normalize_url(url)
    async with lock:
        if url in visited_urls:
            return
        visited_urls.add(url)
    
    logging.info(f"Crawling: {url} (depth: {depth})")
    
    if depth > CONFIG.max_crawl_depth:
        return
    
    try:
        async with semaphore:
            retries = 0
            backoff_time = CONFIG.initial_backoff_time
            while retries <= CONFIG.max_retries:
                async with session.get(url, ssl=False) as response:
                    if response.status == 429:
                        logging.warning(f"Received 429 Too Many Requests for {url}, backing off for {backoff_time} seconds.")
                        await asyncio.sleep(backoff_time)
                        backoff_time = min(backoff_time * 2, CONFIG.max_backoff_time)
                        retries += 1
                        continue  # Retry the request
                    elif response.status != 200:
                        logging.error(f"Error fetching {url}: {response.status}")
                        return
                    else:
                        html = await response.text()
                        page_data = extract_page_data(html, url)
                        if 'error' in page_data:
                            logging.warning(f"Couldn't extract full data for {url}: {page_data['error']}")
                        
                        await save_page_data_as_json(url, page_data)
                        
                        soup = BeautifulSoup(html, 'html.parser')
                        links = soup.find_all('a', href=True)
                        
                        tasks = []
                        for link in links:
                            next_url = urllib.parse.urljoin(url, link['href'])
                            next_url = normalize_url(next_url)
                            if should_crawl(next_url):
                                task = asyncio.ensure_future(process_url(session, next_url, depth + 1, semaphore))
                                tasks.append(task)
                        if tasks:
                            await asyncio.gather(*tasks)
                        break  # Exit the retry loop
            else:
                logging.error(f"Max retries exceeded for {url}")
                return
    except Exception as e:
        logging.error(f"Error processing {url}: {e}")

# Sitemap processing functions
async def process_sitemaps_recursively(sitemap_urls):
    processed_urls = []
    tasks = []
    for sitemap_url in sitemap_urls:
        tasks.append(process_sitemap(sitemap_url))
    results = await asyncio.gather(*tasks)
    for result in results:
        if result:
            processed_urls.extend(result)
    return processed_urls

async def process_sitemap(sitemap_url):
    logging.info(f"Processing sitemap: {sitemap_url}")
    try:
        async with aiohttp.ClientSession(headers={'User-Agent': CONFIG.user_agent}) as session:
            async with session.get(sitemap_url, ssl=False) as response:
                if response.status != 200:
                    logging.error(f"Error fetching sitemap {sitemap_url}: {response.status}")
                    return []
                content = await response.text()
                root = ET.fromstring(content)
    
                namespace = {'ns': 'http://www.sitemaps.org/schemas/sitemap/0.9'}
    
                if root.tag.endswith('sitemapindex'):
                    sitemap_urls = [elem.text for elem in root.findall('ns:sitemap/ns:loc', namespace)]
                    return await process_sitemaps_recursively(sitemap_urls)
                elif root.tag.endswith('urlset'):
                    return [elem.text for elem in root.findall('ns:url/ns:loc', namespace) if should_crawl(elem.text)]
    except Exception as e:
        logging.error(f"Error processing sitemap {sitemap_url}: {e}")
    return []

# Run the crawler
if __name__ == "__main__":
    asyncio.run(crawl())
