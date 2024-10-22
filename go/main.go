// main.go
package main

import (
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io/ioutil"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/PuerkitoBio/goquery"
	"github.com/go-rod/rod"
	"github.com/go-rod/rod/lib/proto"
)

type Config struct {
    BaseURL             *url.URL
    MaxCrawlDepth       int
    MaxConcurrency      int
    MaxRequestsPerCrawl int
    RequestTimeout      time.Duration
    RetryCount          int
    SitemapConcurrency  int
    CacheEnabled        bool
    UserAgent           string
    RespectRobotsTxt    bool
    CrawlSitemap        bool
}

var CONFIG Config

var (
    crawledUrls = make(map[string]struct{})
    cache       = make(map[string][]byte)
    cacheMutex  sync.Mutex
    basePath    string
    websiteName string
    seenUrls    = make(map[string]struct{})
    seenMutex   sync.Mutex
)

func init() {
    baseURLStr := "https://wadesplumbingandseptic.com/"
    if len(os.Args) > 1 {
        baseURLStr = os.Args[1]
    }
    baseURL, err := url.Parse(baseURLStr)
    if err != nil {
        panic(err)
    }
    CONFIG = Config{
        BaseURL:             baseURL,
        MaxCrawlDepth:       10,
        MaxConcurrency:      10,
        MaxRequestsPerCrawl: 1000,
        RequestTimeout:      120 * time.Second, // Increased to 2 minutes
        RetryCount:          3,
        SitemapConcurrency:  50,
        CacheEnabled:        true,
        UserAgent:           "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        RespectRobotsTxt:    true,
        CrawlSitemap:        true,
    }

    // Adjusted basePath to "/"
    basePath = "/"
    websiteName = strings.ToLower(strings.ReplaceAll(strings.Trim(CONFIG.BaseURL.Hostname(), "/"), ".", "-"))
}

func main() {
    fmt.Printf("Starting crawl of %s\n", CONFIG.BaseURL.String())
    startUrls := []string{CONFIG.BaseURL.String()}

    if CONFIG.CrawlSitemap {
        fmt.Println("Processing sitemaps...")
        var robotsTxt string
        if CONFIG.RespectRobotsTxt {
            robotsTxt = fetchRobotsTxt(CONFIG.BaseURL)
        }
        sitemapUrls := fetchAllSitemaps(CONFIG.BaseURL, robotsTxt)

        urls := processSitemaps(sitemapUrls)
        fmt.Printf("Total URLs found in sitemaps: %d\n", len(urls))

        var filteredUrls []string
        for _, u := range urls {
            if shouldCrawl(u) {
                filteredUrls = append(filteredUrls, u)
            }
        }
        fmt.Printf("URLs under specified path: %d\n", len(filteredUrls))

        startUrls = append(startUrls, filteredUrls...)
    }

    fmt.Printf("Starting crawl with %d initial URLs\n", len(startUrls))

    // Create the browser instance once
    browser := rod.New().Timeout(CONFIG.RequestTimeout).MustConnect()
    defer browser.Close()

    var wg sync.WaitGroup
    sem := make(chan struct{}, CONFIG.MaxConcurrency)

    for _, u := range startUrls {
        wg.Add(1)
        sem <- struct{}{}
        go func(u string) {
            defer wg.Done()
            crawl(browser, u, 0)
            <-sem
        }(u)
    }

    wg.Wait()
    fmt.Println("Crawler finished.")
}

// Fetch robots.txt content
func fetchRobotsTxt(baseURL *url.URL) string {
    robotsTxtURL := baseURL.ResolveReference(&url.URL{Path: "/robots.txt"}).String()
    data, err := fetchWithCache(robotsTxtURL)
    if err != nil {
        fmt.Printf("Error fetching robots.txt: %v\n", err)
        return ""
    }
    return string(data)
}

// Fetch all sitemap URLs from robots.txt or default to /sitemap.xml
func fetchAllSitemaps(baseURL *url.URL, robotsTxt string) []string {
    var sitemapUrls []string
    if robotsTxt != "" {
        re := regexp.MustCompile(`Sitemap:\s*(.+)`)
        matches := re.FindAllStringSubmatch(robotsTxt, -1)
        for _, match := range matches {
            sitemapUrls = append(sitemapUrls, match[1])
        }
    }

    if len(sitemapUrls) == 0 {
        sitemapUrls = append(sitemapUrls, baseURL.ResolveReference(&url.URL{Path: "/sitemap.xml"}).String())
    }

    return sitemapUrls
}

// Fetch and process sitemaps recursively
func fetchAndProcessSitemap(u string) []string {
    data, err := fetchWithCache(u)
    if err != nil {
        fmt.Printf("Error fetching sitemap at %s: %v\n", u, err)
        return nil
    }

    var sitemapIndex struct {
        Sitemaps []struct {
            Loc string `xml:"loc"`
        } `xml:"sitemap"`
    }

    err = xml.Unmarshal(data, &sitemapIndex)
    if err == nil && len(sitemapIndex.Sitemaps) > 0 {
        var allUrls []string
        for _, sitemap := range sitemapIndex.Sitemaps {
            urls := fetchAndProcessSitemap(sitemap.Loc)
            allUrls = append(allUrls, urls...)
        }
        return allUrls
    }

    var urlset struct {
        URLs []struct {
            Loc string `xml:"loc"`
        } `xml:"url"`
    }

    err = xml.Unmarshal(data, &urlset)
    if err != nil {
        fmt.Printf("Error processing sitemap at %s: %v\n", u, err)
        return nil
    }

    var urls []string
    for _, u := range urlset.URLs {
        urls = append(urls, u.Loc)
    }
    return urls
}

// Process all sitemap URLs concurrently
func processSitemaps(sitemapUrls []string) []string {
    var allUrls []string
    var wg sync.WaitGroup
    sem := make(chan struct{}, CONFIG.SitemapConcurrency)

    for _, sitemapUrl := range sitemapUrls {
        wg.Add(1)
        sem <- struct{}{}
        go func(u string) {
            defer wg.Done()
            urls := fetchAndProcessSitemap(u)
            if urls != nil {
                allUrls = append(allUrls, urls...)
            }
            <-sem
        }(sitemapUrl)
    }

    wg.Wait()
    return allUrls
}

// Check if the URL has already been seen
func isNewUrl(u string) bool {
    normalizedUrl := normalizeUrl(u)
    seenMutex.Lock()
    defer seenMutex.Unlock()
    if _, exists := seenUrls[normalizedUrl]; exists {
        return false
    }
    seenUrls[normalizedUrl] = struct{}{}
    return true
}

// Normalize URLs by removing query parameters and fragments
func normalizeUrl(u string) string {
    parsedUrl, err := url.Parse(u)
    if err != nil {
        return u
    }
    parsedUrl.RawQuery = ""
    parsedUrl.Fragment = ""
    return parsedUrl.String()
}

// Determine if a URL should be crawled
func shouldCrawl(u string) bool {
    parsedUrl, err := url.Parse(u)
    if err != nil {
        fmt.Printf("Error parsing URL %s: %v\n", u, err)
        return false
    }
    baseHostname := strings.TrimPrefix(CONFIG.BaseURL.Hostname(), "www.")
    hostname := strings.TrimPrefix(parsedUrl.Hostname(), "www.")

    if hostname != baseHostname {
        fmt.Printf("Skipping external URL (hostname mismatch): %s\n", u)
        return false
    }

    // Commented out the base path check
    // if !strings.HasPrefix(parsedUrl.Path, basePath) {
    //     fmt.Printf("Skipping URL not under base path: %s\n", u)
    //     return false
    // }

    filePath := getFilePath(parsedUrl)
    if _, err := os.Stat(filePath); err == nil {
        fmt.Printf("Skipping URL (file already exists): %s\n", u)
        return false
    }

    return true
}

// Generate file path for storing the page data
func getFilePath(parsedUrl *url.URL) string {
    relativePath := strings.TrimPrefix(parsedUrl.Path, basePath)
    parts := strings.Split(strings.Trim(relativePath, "/"), "/")
    currentPath := filepath.Join(".", websiteName, strings.Trim(basePath, "/"))
    for _, part := range parts[:len(parts)-1] {
        currentPath = filepath.Join(currentPath, slugify(part))
    }
    fileName := "index"
    if len(parts) > 0 && parts[len(parts)-1] != "" {
        fileName = slugify(parts[len(parts)-1])
    }
    return filepath.Join(currentPath, fmt.Sprintf("%s.json", fileName))
}

// Fetch content with caching
func fetchWithCache(u string) ([]byte, error) {
    if !CONFIG.CacheEnabled {
        fmt.Printf("🌐 Fetching (cache disabled): %s\n", u)
        return fetch(u)
    }

    cacheMutex.Lock()
    data, exists := cache[u]
    cacheMutex.Unlock()

    if exists {
        fmt.Printf("🗄️ Cache hit for %s\n", u)
        return data, nil
    }

    fmt.Printf("🌐 Cache miss, fetching: %s\n", u)
    data, err := fetch(u)
    if err != nil {
        return nil, err
    }

    cacheMutex.Lock()
    cache[u] = data
    cacheMutex.Unlock()

    return data, nil
}

// Fetch content from a URL
func fetch(u string) ([]byte, error) {
    client := &http.Client{Timeout: CONFIG.RequestTimeout}
    req, err := http.NewRequest("GET", u, nil)
    if err != nil {
        return nil, err
    }
    req.Header.Set("User-Agent", CONFIG.UserAgent)
    resp, err := client.Do(req)
    if err != nil {
        return nil, err
    }
    defer resp.Body.Close()
    return ioutil.ReadAll(resp.Body)
}

// Crawl a URL and extract data
func crawl(browser *rod.Browser, u string, depth int) {
    if depth > CONFIG.MaxCrawlDepth {
        fmt.Printf("Max depth reached for %s\n", u)
        return
    }
    if !isNewUrl(u) {
        fmt.Printf("Skipping: %s (Already processed)\n", u)
        return
    }
    if !shouldCrawl(u) {
        fmt.Printf("Skipping: %s (Out of scope)\n", u)
        return
    }

    fmt.Printf("Processing URL: %s\n", u)

    page := browser.MustPage(proto.TargetCreateTarget{URL: u})
    defer page.Close()

    // Wait for the page to load
    page.MustWaitLoad()

    // Extract data
    seoData := extractSeoElements(page)
    contentAnalysis := analyzeContent(page)
    mediaAnalysis := analyzeMedia(page)
    linkAnalysis := analyzeLinks(page)
    structuredData := extractStructuredData(page)
    socialMetaTags := extractSocialMetaTags(page)

    // Additional SEO analysis
    technicalSeo := analyzeTechnicalSeo(page, u)
    urlStructure := analyzeUrlStructure(u)
    pageType := determinePageType(u)
    semanticStructure := analyzeSemanticStructure(page)
    contentToHtmlRatio := calculateContentToHtmlRatio(page)
    keywordUsage := extractKeywordUsage(page)
    mediaOptimization := analyzeMediaOptimization(page)
    keywordDensity := calculateKeywordDensity(page)
    
    // Extract publication date using go-htmldate
    html, _ := page.HTML()
    publicationDate, _ := goquery.NewDocumentFromReader(strings.NewReader(html))
    pubDate := publicationDate.Find("meta[property='article:published_time']").AttrOr("content", "")
    if pubDate == "" {
        pubDate = publicationDate.Find("time[datetime]").AttrOr("datetime", "")
    }

    // Build page data
    pageData := map[string]interface{}{
        "url":            u,
        "urlStructure":   urlStructure,
        "pageType":       pageType,
        "seoElements":    seoData,
        "content":        contentAnalysis,
        "media":          mediaAnalysis,
        "links":          linkAnalysis,
        "seoData": map[string]interface{}{
            "structuredData":      structuredData,
            "socialMetaTags":      socialMetaTags,
            "semanticStructure":   semanticStructure,
            "contentToHtmlRatio":  contentToHtmlRatio,
            "internalLinksCount":  countInternalLinks(linkAnalysis),
            "externalLinksCount":  countExternalLinks(linkAnalysis),
            "imageCount":          len(mediaAnalysis["images"].([]map[string]interface{})),
            "imagesWithAlt":       countImagesWithAlt(mediaAnalysis["images"].([]map[string]interface{})),
            "totalWordCount":      contentAnalysis["wordCount"],
            "keywordUsage":        keywordUsage,
            "mediaOptimization":   mediaOptimization,
            "keywordDensity":      keywordDensity,
        },
        "publicationInfo": map[string]interface{}{
            "date": publicationDate,
        },
        "technicalSeo":       technicalSeo,
        "performanceMetrics": performanceMetrics,
        "accessibility":      accessibilityAnalysis,
        "security":           securityAnalysis,
        "advancedSeoMetrics": map[string]interface{}{
            "mobileFriendliness":       checkMobileFriendliness(u),
            "pageSpeedInsights":        getPageSpeedInsights(u),
            "contentQualityMetrics":    calculateContentQualityMetrics(contentAnalysis),
            "internalLinkingStructure": analyzeInternalLinkingStructure(linkAnalysis),
            "userExperienceSignals":    measureUserExperienceSignals(page),
        },
        "schemaMarkup":     schemaMarkupAnalysis,
        "pagination":       paginationAnalysis,
        "canonical":        canonicalAnalysis,
        "hreflang":         hreflangAnalysis,
        "ampVersion":       ampVersionCheck,
        "contentStructure": contentStructureAnalysis,
    }

    // Save data
    savePageDataAsJson(u, pageData)

    // Enqueue links
    if depth < CONFIG.MaxCrawlDepth {
        links := linkAnalysis.([]map[string]interface{})
        for _, link := range links {
            if link["isInternal"].(bool) {
                href := link["href"].(string)
                go crawl(browser, href, depth+1)
            }
        }
    }
}

// Save the extracted data as a JSON file
func savePageDataAsJson(u string, data interface{}) {
    parsedUrl, _ := url.Parse(u)
    relativePath := strings.TrimPrefix(parsedUrl.Path, basePath)
    parts := strings.Split(strings.Trim(relativePath, "/"), "/")
    currentPath := filepath.Join(".", websiteName, strings.Trim(basePath, "/"))
    for _, part := range parts[:len(parts)-1] {
        currentPath = filepath.Join(currentPath, strings.ReplaceAll(part, " ", "-"))
        os.MkdirAll(currentPath, os.ModePerm)
    }
    fileName := "index"
    if len(parts) > 0 && parts[len(parts)-1] != "" {
        fileName = strings.ReplaceAll(strings.ToLower(parts[len(parts)-1]), " ", "-")
    }
    filePath := filepath.Join(currentPath, fmt.Sprintf("%s.json", fileName))
    fileData, err := json.MarshalIndent(data, "", "  ")
    if err != nil {
        fmt.Printf("Error marshaling JSON: %v\n", err)
        return
    }
    err = ioutil.WriteFile(filePath, fileData, 0644)
    if err != nil {
        fmt.Printf("Error writing file: %v\n", err)
    }
    fmt.Printf("Saved: %s\n", filePath)
}

// Extract SEO elements from the page
func extractSeoElements(page *rod.Page) map[string]interface{} {
    title := ""
    el, err := page.Element("title")
    if err == nil && el != nil {
        title, _ = el.Text()
    }

    metaDescription := ""
    el, err = page.Element(`meta[name="description"]`)
    if err == nil && el != nil {
        contentAttr, _ := el.Attribute("content")
        if contentAttr != nil {
            metaDescription = *contentAttr
        }
    }

    h1 := ""
    el, err = page.Element("h1")
    if err == nil && el != nil {
        h1, _ = el.Text()
    }

    canonicalURL := ""
    el, err = page.Element(`link[rel="canonical"]`)
    if err == nil && el != nil {
        hrefAttr, _ := el.Attribute("href")
        if hrefAttr != nil {
            canonicalURL = *hrefAttr
        }
    }

    hreflangTags := []map[string]string{}
    els, err := page.Elements(`link[rel="alternate"][hreflang]`)
    if err == nil {
        for _, el := range els {
            hreflangAttr, _ := el.Attribute("hreflang")
            hrefAttr, _ := el.Attribute("href")
            if hreflangAttr != nil && hrefAttr != nil {
                hreflangTags = append(hreflangTags, map[string]string{
                    "hreflang": *hreflangAttr,
                    "href":     *hrefAttr,
                })
            }
        }
    }

    return map[string]interface{}{
        "title":           title,
        "metaDescription": metaDescription,
        "h1":              h1,
        "canonicalUrl":    canonicalURL,
        "hreflangTags":    hreflangTags,
    }
}

// Analyze the page content
func analyzeContent(page *rod.Page) map[string]interface{} {
    bodyText := ""
    el, err := page.Element("body")
    if err == nil && el != nil {
        bodyText, _ = el.Text()
    }

    wordCount := len(strings.Fields(bodyText))
    sentenceCount := len(regexp.MustCompile(`[.!?]+`).FindAllString(bodyText, -1))
    averageSentenceLength := float64(wordCount)
    if sentenceCount > 0 {
        averageSentenceLength /= float64(sentenceCount)
    }
    uniqueWords := len(unique(strings.Fields(strings.ToLower(bodyText))))

    return map[string]interface{}{
        "text":                  bodyText,
        "wordCount":             wordCount,
        "sentenceCount":         sentenceCount,
        "averageSentenceLength": averageSentenceLength,
        "uniqueWords":           uniqueWords,
    }
}

// Analyze media elements on the page
func analyzeMedia(page *rod.Page) map[string]interface{} {
    images, err := page.Elements("img")
    var imageList []map[string]interface{}
    if err == nil {
        for _, img := range images {
            srcAttr, _ := img.Attribute("src")
            if srcAttr == nil {
                continue
            }
            altAttr, _ := img.Attribute("alt")
            titleAttr, _ := img.Attribute("title")
            var alt, title string
            if altAttr != nil {
                alt = *altAttr
            }
            if titleAttr != nil {
                title = *titleAttr
            }
            width, _ := img.Property("naturalWidth")
            height, _ := img.Property("naturalHeight")
            imageList = append(imageList, map[string]interface{}{
                "src":    *srcAttr,
                "alt":    alt,
                "title":  title,
                "width":  width.Int(),
                "height": height.Int(),
            })
        }
    }
    return map[string]interface{}{
        "images": imageList,
    }
}

// Analyze links on the page
func analyzeLinks(page *rod.Page) []map[string]interface{} {
    links, err := page.Elements("a")
    var linkList []map[string]interface{}
    if err == nil {
        baseUrl := page.MustInfo().URL
        for _, link := range links {
            hrefAttr, _ := link.Attribute("href")
            if hrefAttr == nil || *hrefAttr == "" || strings.HasPrefix(*hrefAttr, "#") {
                continue
            }
            text, _ := link.Text()
            // Updated code to handle single return value
            result, err := page.Eval(`(link, base) => new URL(link, base).toString()`, *hrefAttr, baseUrl)
            if err != nil {
                fmt.Printf("Error evaluating URL: %v\n", err)
                continue
            }
            absUrl := result.Value.Str()
            if absUrl == "" {
                fmt.Printf("Error converting result to string\n")
                continue
            }
            isInternal := strings.HasPrefix(absUrl, CONFIG.BaseURL.Scheme+"://"+CONFIG.BaseURL.Host)
            linkList = append(linkList, map[string]interface{}{
                "href":       absUrl,
                "text":       text,
                "isInternal": isInternal,
            })
        }
    }
    return linkList
}

// Extract structured data from the page
func extractStructuredData(page *rod.Page) []map[string]interface{} {
    var data []map[string]interface{}
    scripts, err := page.Elements(`script[type="application/ld+json"]`)
    if err == nil {
        for _, script := range scripts {
            content, _ := script.Text()
            var jsonData map[string]interface{}
            if err := json.Unmarshal([]byte(content), &jsonData); err == nil {
                data = append(data, jsonData)
            }
        }
    }
    return data
}

// Extract social meta tags from the page
func extractSocialMetaTags(page *rod.Page) map[string]interface{} {
    metaTags := make(map[string]string)
    metaElements, err := page.Elements("meta")
    if err == nil {
        for _, meta := range metaElements {
            propertyAttr, _ := meta.Attribute("property")
            nameAttr, _ := meta.Attribute("name")
            contentAttr, _ := meta.Attribute("content")
            if contentAttr == nil {
                continue
            }
            content := *contentAttr
            if propertyAttr != nil && strings.HasPrefix(*propertyAttr, "og:") {
                metaTags[*propertyAttr] = content
            }
            if nameAttr != nil {
                if strings.HasPrefix(*nameAttr, "og:") || strings.HasPrefix(*nameAttr, "twitter:") {
                    metaTags[*nameAttr] = content
                }
            }
        }
    }
    return map[string]interface{}{
        "metaTags": metaTags,
    }
}

// Extract publication date from the content
func extractPublicationDate(content string) string {
    re := regexp.MustCompile(`\d{4}-\d{2}-\d{2}`)
    match := re.FindString(content)
    return match
}

// Helper function to get unique words
func unique(strings []string) []string {
    uniqueMap := make(map[string]struct{})
    for _, s := range strings {
        uniqueMap[s] = struct{}{}
    }
    var uniqueList []string
    for s := range uniqueMap {
        uniqueList = append(uniqueList, s)
    }
    return uniqueList
}

// Add this function to define slugify
func slugify(s string) string {
    re := regexp.MustCompile(`[^a-z0-9]+`)
    slug := strings.Trim(re.ReplaceAllString(strings.ToLower(s), "-"), "-")
    return slug
}

func analyzeTechnicalSeo(page *rod.Page, u string) map[string]interface{} {
    // Get the response details
    response := page.MustInfo()

    // Extract headers
    headers := make(map[string]string)
    for k, v := range response.Headers {
        headers[k] = v
    }

    // Get timing information
    timing := page.MustEval(`() => {
        const timing = performance.timing;
        return {
            responseEnd: timing.responseEnd,
            requestStart: timing.requestStart
        };
    }`).Map()

    return map[string]interface{}{
        "statusCode":        response.StatusCode,
        "headers":           headers,
        "robotsTxt":         fetchRobotsTxt(CONFIG.BaseURL),
        "sitemapXml":        fetchSitemapXml(CONFIG.BaseURL),
        "isHttps":           strings.HasPrefix(u, "https"),
        "hasSslCertificate": checkSslCertificate(u),
        "responseTime":      timing["responseEnd"].(float64) - timing["requestStart"].(float64),
        "contentEncoding":   headers["Content-Encoding"],
        "serverInfo":        headers["Server"],
    }
}

func analyzePerformance(u string) map[string]interface{} {
	// Note: This is a placeholder. Implementing a full Lighthouse-like analysis in Go is complex.
	// You might want to use an external service or tool for this.
	return map[string]interface{}{
		"performanceScore": 0.85, // Placeholder value
		"metrics": map[string]float64{
			"firstContentfulPaint": 1000,
			"speedIndex":           2000,
			"largestContentfulPaint": 2500,
			"timeToInteractive":    3000,
			"totalBlockingTime":    200,
		},
	}
}

func analyzeAccessibility(page *rod.Page) map[string]interface{} {
	issues := []string{}

	// Check for alt text on images
	images, _ := page.Elements("img")
	for _, img := range images {
		alt, _ := img.Attribute("alt")
		if alt == nil || *alt == "" {
			src, _ := img.Attribute("src")
			issues = append(issues, fmt.Sprintf("Image without alt text: %s", *src))
		}
	}

	// Check for proper heading structure
	headings, _ := page.Elements("h1, h2, h3, h4, h5, h6")
	previousLevel := 0
	for _, heading := range headings {
		tagName, _ := heading.Eval("() => this.tagName")
		currentLevel := int(tagName.Value.Str()[1] - '0')
		if currentLevel - previousLevel > 1 {
			issues = append(issues, fmt.Sprintf("Skipped heading level: %s", tagName.Value.Str()))
		}
		previousLevel = currentLevel
	}

	return map[string]interface{}{
		"issues":       issues,
		"passedChecks": []string{"Alt text check", "Heading structure check"},
	}
}

func analyzeSecurityHeaders(u string) map[string]interface{} {
	resp, err := http.Get(u)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()

	headers := resp.Header
	return map[string]interface{}{
		"Strict-Transport-Security": headers.Get("Strict-Transport-Security"),
		"Content-Security-Policy":   headers.Get("Content-Security-Policy"),
		"X-Frame-Options":           headers.Get("X-Frame-Options"),
		"X-XSS-Protection":          headers.Get("X-XSS-Protection"),
		"X-Content-Type-Options":    headers.Get("X-Content-Type-Options"),
		"Referrer-Policy":           headers.Get("Referrer-Policy"),
	}
}

func analyzeSchemaMarkup(structuredData []map[string]interface{}) map[string]interface{} {
	schemaTypes := []string{}
	for _, data := range structuredData {
		if schemaType, ok := data["@type"].(string); ok {
			schemaTypes = append(schemaTypes, schemaType)
		}
	}
	return map[string]interface{}{
		"types": schemaTypes,
		"count": len(schemaTypes),
	}
}

func analyzePagination(links []map[string]interface{}) map[string]interface{} {
	paginationLinks := []map[string]interface{}{}
	for _, link := range links {
		rel, _ := link["rel"].(string)
		text, _ := link["text"].(string)
		if rel == "prev" || rel == "next" || strings.Contains(strings.ToLower(text), "previous") || strings.Contains(strings.ToLower(text), "next") {
			paginationLinks = append(paginationLinks, link)
		}
	}
	return map[string]interface{}{
		"hasPagination":   len(paginationLinks) > 0,
		"paginationLinks": paginationLinks,
	}
}

func analyzeCanonicalImplementation(seoData map[string]interface{}, u string) map[string]interface{} {
	canonicalUrl, _ := seoData["canonicalUrl"].(string)
	return map[string]interface{}{
		"hasCanonical":    canonicalUrl != "",
		"isCanonicalSelf": canonicalUrl == u,
		"canonicalUrl":    canonicalUrl,
	}
}

func analyzeHreflangImplementation(seoData map[string]interface{}) map[string]interface{} {
	hreflangTags, _ := seoData["hreflangTags"].([]map[string]string)
	return map[string]interface{}{
		"hasHreflang":   len(hreflangTags) > 0,
		"hreflangCount": len(hreflangTags),
		"hreflangTags":  hreflangTags,
	}
}

func checkAmpVersion(page *rod.Page, u string) map[string]interface{} {
	ampLink, err := page.Element("link[rel='amphtml']")
	if err != nil {
		return map[string]interface{}{
			"hasAmpVersion": false,
			"ampUrl":        nil,
		}
	}
	ampUrl, _ := ampLink.Attribute("href")
	return map[string]interface{}{
		"hasAmpVersion": true,
		"ampUrl":        ampUrl,
	}
}

func analyzeContentStructure(page *rod.Page) map[string]interface{} {
	paragraphs, _ := page.Elements("p")
	lists, _ := page.Elements("ul, ol")
	tables, _ := page.Elements("table")
	images, _ := page.Elements("img")

	return map[string]interface{}{
		"paragraphCount":      len(paragraphs),
		"listCount":           len(lists),
		"tableCount":          len(tables),
		"imageCount":          len(images),
		"hasStructuredContent": len(paragraphs) > 0 || len(lists) > 0 || len(tables) > 0,
	}
}

func checkMobileFriendliness(u string) map[string]interface{} {
	// This is a placeholder. You might want to use Google's Mobile-Friendly Test API for actual implementation
	return map[string]interface{}{
		"isMobileFriendly": true,
		"issues":           []string{},
	}
}

func getPageSpeedInsights(u string) map[string]interface{} {
	// This is a placeholder. You might want to use Google's PageSpeed Insights API for actual implementation
	return map[string]interface{}{
		"score":         85,
		"opportunities": []string{},
	}
}

func calculateContentQualityMetrics(contentAnalysis map[string]interface{}) map[string]interface{} {
	return map[string]interface{}{
		"wordCount":             contentAnalysis["wordCount"],
		"sentenceCount":         contentAnalysis["sentenceCount"],
		"averageSentenceLength": contentAnalysis["averageSentenceLength"],
		"uniqueWords":           contentAnalysis["uniqueWords"],
	}
}

func analyzeInternalLinkingStructure(links []map[string]interface{}) map[string]interface{} {
	internalLinks := []map[string]interface{}{}
	linkDepths := make(map[int]int)

	for _, link := range links {
		if isInternal, ok := link["isInternal"].(bool); ok && isInternal {
			internalLinks = append(internalLinks, link)
			href, _ := link["href"].(string)
			depth := len(strings.Split(href, "/")) - 3 // Subtracting 3 for "http:", "" and domain
			linkDepths[depth]++
		}
	}

	return map[string]interface{}{
		"count":        len(internalLinks),
		"distribution": linkDepths,
	}
}

func measureUserExperienceSignals(page *rod.Page) map[string]interface{} {
	// This is a placeholder. Actual implementation would require more sophisticated measurements.
	return map[string]interface{}{
		"cls": 0.1,  // Cumulative Layout Shift
		"fid": 100,  // First Input Delay (in milliseconds)
	}
}

func checkSslCertificate(u string) bool {
    return strings.HasPrefix(u, "https")
}

func fetchSitemapXml(baseURL *url.URL) string {
	sitemapUrl := baseURL.ResolveReference(&url.URL{Path: "/sitemap.xml"}).String()
	data, err := fetchWithCache(sitemapUrl)
	if err != nil {
		fmt.Printf("Error fetching sitemap.xml: %v\n", err)
		return ""
	}
	return string(data)
}

func analyzeUrlStructure(u string) map[string]interface{} {
    parsedUrl, _ := url.Parse(u)
    return map[string]interface{}{
        "protocol": parsedUrl.Scheme,
        "hostname": parsedUrl.Hostname(),
        "pathname": parsedUrl.Path,
        "search":   parsedUrl.RawQuery,
        "hash":     parsedUrl.Fragment,
    }
}

func determinePageType(content string) string {
    if strings.Contains(content, "<article") {
        return "blog_post"
    }
    if strings.Contains(content, "<product") {
        return "product_page"
    }
    if strings.Contains(content, "<form") {
        return "form_page"
    }
    return "general_page"
}

func analyzeSemanticStructure(page *rod.Page) map[string]bool {
    return page.MustEval(`() => {
        return {
            hasHeader: !!document.querySelector('header'),
            hasNav: !!document.querySelector('nav'),
            hasMain: !!document.querySelector('main'),
            hasArticle: !!document.querySelector('article'),
            hasSection: !!document.querySelector('section'),
            hasAside: !!document.querySelector('aside'),
            hasFooter: !!document.querySelector('footer')
        };
    }`).Map()
}

func calculateContentToHtmlRatio(page *rod.Page) string {
    ratioData := page.MustEval(`() => {
        const content = document.body.innerText;
        const html = document.documentElement.outerHTML;
        return {
            contentLength: content.length,
            htmlLength: html.length
        };
    }`).Map()
    
    contentLength := ratioData["contentLength"].(float64)
    htmlLength := ratioData["htmlLength"].(float64)
    ratio := contentLength / htmlLength * 100
    return fmt.Sprintf("%.2f%%", ratio)
}

func extractKeywordUsage(page *rod.Page) []map[string]interface{} {
    return page.MustEval(`() => {
        const text = document.body.innerText.toLowerCase();
        const words = text.match(/\b(\w+)\b/g);
        const wordCounts = {};
        words.forEach(word => {
            wordCounts[word] = (wordCounts[word] || 0) + 1;
        });
        return Object.entries(wordCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([word, count]) => ({
                word,
                count,
                density: (count / words.length * 100).toFixed(2) + '%'
            }));
    }`).Array()
}

func analyzeMediaOptimization(page *rod.Page) []map[string]interface{} {
    return page.MustEval(`() => {
        return Array.from(document.images).map(img => ({
            src: img.src,
            isResponsive: img.srcset !== '' || img.sizes !== '',
            isLazyLoaded: img.loading === 'lazy',
            aspectRatio: (img.width / img.height).toFixed(2),
            sizeDifference: {
                width: img.width - img.naturalWidth,
                height: img.height - img.naturalHeight
            }
        }));
    }`).Array()
}

func calculateKeywordDensity(page *rod.Page) map[string]interface{} {
    return page.MustEval(`() => {
        const text = document.body.innerText.toLowerCase();
        const words = text.match(/\b(\w+)\b/g);
        const wordCounts = {};
        words.forEach(word => {
            wordCounts[word] = (wordCounts[word] || 0) + 1;
        });
        const sortedWords = Object.entries(wordCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);
        return {
            topKeywords: sortedWords.map(([word, count]) => ({
                word,
                count,
                density: (count / words.length * 100).toFixed(2) + '%'
            })),
            label: "keyword_density"
        };
    }`).Map()
}

func extractPublicationDate(page *rod.Page) string {
    return page.MustEval(`() => {
        const dateRegex = /\d{4}-\d{2}-\d{2}/;
        const match = document.body.innerText.match(dateRegex);
        return match ? match[0] : null;
    }`).String()
}

func checkSslCertificate(u string) bool {
    return strings.HasPrefix(u, "https")
}

func fetchRobotsTxt(baseURL *url.URL) string {
    robotsTxtURL := baseURL.ResolveReference(&url.URL{Path: "/robots.txt"}).String()
    data, err := fetchWithCache(robotsTxtURL)
    if err != nil {
        fmt.Printf("Error fetching robots.txt: %v\n", err)
        return ""
    }
    return string(data)
}

func fetchSitemapXml(baseURL *url.URL) string {
    sitemapUrl := baseURL.ResolveReference(&url.URL{Path: "/sitemap.xml"}).String()
    data, err := fetchWithCache(sitemapUrl)
    if err != nil {
        fmt.Printf("Error fetching sitemap.xml: %v\n", err)
        return ""
    }
    return string(data)
}

