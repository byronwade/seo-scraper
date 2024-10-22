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
	"github.com/gocolly/colly/v2"
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
	SkipSitemapRobots   bool // New option to skip sitemaps and robots.txt
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

type Sitemap struct {
	XMLName xml.Name `xml:"urlset"`
	URLs    []string `xml:"url>loc"`
}

type SitemapIndex struct {
	XMLName  xml.Name `xml:"sitemapindex"`
	Sitemaps []string `xml:"sitemap>loc"`
}

func init() {
	baseURLStr := "https://developers.google.com/"
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
		RequestTimeout:      120 * time.Second,
		RetryCount:          3,
		SitemapConcurrency:  5,
		CacheEnabled:        true,
		UserAgent:           "MyScraper/1.0",
		RespectRobotsTxt:    true,
		CrawlSitemap:        true,
		SkipSitemapRobots:   true,
	}

	basePath = "/"
	websiteName = strings.ToLower(strings.ReplaceAll(strings.Trim(CONFIG.BaseURL.Hostname(), "/"), ".", "-"))
}

func main() {
	fmt.Printf("Starting crawl of %s\n", CONFIG.BaseURL.String())

	rootDir := filepath.Join(".", CONFIG.BaseURL.Hostname())
	os.MkdirAll(rootDir, os.ModePerm)

	c := colly.NewCollector(
		colly.MaxDepth(CONFIG.MaxCrawlDepth),
		colly.Async(true),
		colly.UserAgent(CONFIG.UserAgent),
		colly.AllowedDomains(CONFIG.BaseURL.Hostname()),
	)

	c.Limit(&colly.LimitRule{
		DomainGlob:  "*",
		Parallelism: CONFIG.MaxConcurrency,
		RandomDelay: 5 * time.Second,
	})

	c.SetRequestTimeout(CONFIG.RequestTimeout)

	if CONFIG.RespectRobotsTxt {
		c.IgnoreRobotsTxt = false
	} else {
		c.IgnoreRobotsTxt = true
	}

	var processedURLs []string

	if !CONFIG.SkipSitemapRobots {
		// Download robots.txt
		robotsTxtURL := CONFIG.BaseURL.ResolveReference(&url.URL{Path: "/robots.txt"}).String()
		robotsTxtPath := filepath.Join(rootDir, "robots.txt")
		robotsTxtContent := downloadFile(robotsTxtURL, robotsTxtPath)

		// Process sitemaps
		sitemapURLs := extractSitemapURLs(robotsTxtContent)
		processedURLs = processSitemapsRecursively(sitemapURLs, rootDir)
	}

	// Set up crawler callbacks
	c.OnHTML("a[href]", func(e *colly.HTMLElement) {
		link := e.Request.AbsoluteURL(e.Attr("href"))
		if shouldCrawl(link) {
			e.Request.Visit(link)
		}
	})

	c.OnResponse(func(r *colly.Response) {
		fmt.Printf("Visited: %s\n", r.Request.URL)
		pageData := extractPageData(r)
		savePageDataAsJson(r.Request.URL.String(), pageData, rootDir)
	})

	c.OnError(func(r *colly.Response, err error) {
		fmt.Printf("Error on %s: %s\n", r.Request.URL, err)
	})

	// Start crawling
	if len(processedURLs) > 0 {
		fmt.Printf("Starting to crawl %d URLs from sitemaps\n", len(processedURLs))
		for _, u := range processedURLs {
			c.Visit(u)
		}
	} else {
		fmt.Println("Starting crawl from base URL")
		c.Visit(CONFIG.BaseURL.String())
	}

	c.Wait()
	fmt.Println("Crawler finished.")
}

func processSitemapsRecursively(sitemapURLs []string, rootDir string) []string {
	var processedURLs []string
	var mutex sync.Mutex
	var wg sync.WaitGroup
	semaphore := make(chan struct{}, CONFIG.SitemapConcurrency)

	var processSitemap func(string)
	processSitemap = func(sitemapURL string) {
		defer wg.Done()
		defer func() { <-semaphore }()

		content := downloadFile(sitemapURL, "")
		var sitemapIndex SitemapIndex
		if err := xml.Unmarshal([]byte(content), &sitemapIndex); err == nil && len(sitemapIndex.Sitemaps) > 0 {
			for _, s := range sitemapIndex.Sitemaps {
				wg.Add(1)
				semaphore <- struct{}{}
				go processSitemap(s)
			}
		} else {
			var sitemap Sitemap
			if err := xml.Unmarshal([]byte(content), &sitemap); err == nil {
				mutex.Lock()
				for _, u := range sitemap.URLs {
					if shouldCrawl(u) {
						processedURLs = append(processedURLs, u)
					}
				}
				mutex.Unlock()
			} else {
				fmt.Printf("Error parsing sitemap %s: %v\n", sitemapURL, err)
			}
		}

		// Save the sitemap file
		fileName := filepath.Base(sitemapURL)
		if fileName == "" || fileName == "/" {
			fileName = "sitemap.xml"
		}
		filePath := filepath.Join(rootDir, fileName)
		if err := ioutil.WriteFile(filePath, []byte(content), 0644); err != nil {
			fmt.Printf("Error saving sitemap file %s: %v\n", filePath, err)
		} else {
			fmt.Printf("Saved sitemap: %s\n", filePath)
		}
	}

	for _, sitemapURL := range sitemapURLs {
		wg.Add(1)
		semaphore <- struct{}{}
		go processSitemap(sitemapURL)
	}

	wg.Wait()
	return processedURLs
}

func downloadFile(url, filePath string) string {
	resp, err := http.Get(url)
	if err != nil {
		fmt.Printf("Error downloading %s: %v\n", url, err)
		return ""
	}
	defer resp.Body.Close()

	content, err := ioutil.ReadAll(resp.Body)
	if err != nil {
		fmt.Printf("Error reading content from %s: %v\n", url, err)
		return ""
	}

	if filePath != "" {
		err = ioutil.WriteFile(filePath, content, 0644)
		if err != nil {
			fmt.Printf("Error writing to file %s: %v\n", filePath, err)
		} else {
			fmt.Printf("Downloaded: %s\n", filePath)
		}
	}

	return string(content)
}

func shouldCrawl(u string) bool {
	parsedURL, err := url.Parse(u)
	if err != nil {
		fmt.Printf("Error parsing URL %s: %v\n", u, err)
		return false
	}

	return parsedURL.Hostname() == CONFIG.BaseURL.Hostname() &&
		strings.HasPrefix(parsedURL.Path, CONFIG.BaseURL.Path)
}

func extractSitemapURLs(robotsTxtContent string) []string {
	var sitemapURLs []string
	lines := strings.Split(robotsTxtContent, "\n")
	for _, line := range lines {
		if strings.HasPrefix(strings.ToLower(line), "sitemap:") {
			sitemapURL := strings.TrimSpace(strings.TrimPrefix(line, "Sitemap:"))
			sitemapURLs = append(sitemapURLs, sitemapURL)
		}
	}

	if len(sitemapURLs) == 0 {
		sitemapURLs = append(sitemapURLs, CONFIG.BaseURL.ResolveReference(&url.URL{Path: "/sitemap.xml"}).String())
	}

	return sitemapURLs
}

func extractPageData(r *colly.Response) map[string]interface{} {
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(string(r.Body)))
	if err != nil {
		fmt.Printf("Error parsing HTML: %v\n", err)
		return nil
	}

	pageData := map[string]interface{}{
		"url":         r.Request.URL.String(),
		"seoElements": extractSeoElements(doc),
		"content":     analyzeContent(doc),
		"media":       analyzeMedia(doc),
		"links":       analyzeLinks(doc, r.Request.URL),
		"seoData": map[string]interface{}{
			"structuredData":     extractStructuredData(doc),
			"socialMetaTags":     extractSocialMetaTags(doc),
			"semanticStructure":  analyzeSemanticStructure(doc),
			"contentToHtmlRatio": calculateContentToHtmlRatio(doc),
			"keywordUsage":       extractKeywordUsage(doc),
			"keywordDensity":     calculateKeywordDensity(doc),
		},
		"technicalSeo": analyzeTechnicalSeo(r),
	}

	return pageData
}

func extractSeoElements(doc *goquery.Document) map[string]interface{} {
	title := doc.Find("title").Text()
	metaDescription, _ := doc.Find("meta[name='description']").Attr("content")
	h1 := doc.Find("h1").First().Text()
	canonicalURL, _ := doc.Find("link[rel='canonical']").Attr("href")

	return map[string]interface{}{
		"title":           title,
		"metaDescription": metaDescription,
		"h1":              h1,
		"canonicalUrl":    canonicalURL,
	}
}

func analyzeContent(doc *goquery.Document) map[string]interface{} {
	bodyText := doc.Find("body").Text()
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

func analyzeMedia(doc *goquery.Document) map[string]interface{} {
	var imageList []map[string]interface{}
	doc.Find("img").Each(func(_ int, s *goquery.Selection) {
		src, _ := s.Attr("src")
		alt, _ := s.Attr("alt")
		title, _ := s.Attr("title")
		imageList = append(imageList, map[string]interface{}{
			"src":   src,
			"alt":   alt,
			"title": title,
		})
	})
	return map[string]interface{}{
		"images": imageList,
	}
}

func analyzeLinks(doc *goquery.Document, baseURL *url.URL) []map[string]interface{} {
	var linkList []map[string]interface{}
	doc.Find("a").Each(func(_ int, s *goquery.Selection) {
		href, _ := s.Attr("href")
		text := s.Text()
		absURL := baseURL.ResolveReference(&url.URL{Path: href}).String()
		isInternal := strings.HasPrefix(absURL, CONFIG.BaseURL.Scheme+"://"+CONFIG.BaseURL.Host)
		linkList = append(linkList, map[string]interface{}{
			"href":       absURL,
			"text":       text,
			"isInternal": isInternal,
		})
	})
	return linkList
}

func extractStructuredData(doc *goquery.Document) []map[string]interface{} {
	var data []map[string]interface{}
	doc.Find("script[type='application/ld+json']").Each(func(_ int, s *goquery.Selection) {
		var jsonData map[string]interface{}
		if err := json.Unmarshal([]byte(s.Text()), &jsonData); err == nil {
			data = append(data, jsonData)
		}
	})
	return data
}

func extractSocialMetaTags(doc *goquery.Document) map[string]interface{} {
	metaTags := make(map[string]string)
	doc.Find("meta").Each(func(_ int, s *goquery.Selection) {
		property, _ := s.Attr("property")
		name, _ := s.Attr("name")
		content, _ := s.Attr("content")
		if strings.HasPrefix(property, "og:") || strings.HasPrefix(name, "twitter:") {
			metaTags[property] = content
		}
	})
	return map[string]interface{}{
		"metaTags": metaTags,
	}
}

func analyzeSemanticStructure(doc *goquery.Document) map[string]bool {
	return map[string]bool{
		"hasHeader":  doc.Find("header").Length() > 0,
		"hasNav":     doc.Find("nav").Length() > 0,
		"hasMain":    doc.Find("main").Length() > 0,
		"hasArticle": doc.Find("article").Length() > 0,
		"hasSection": doc.Find("section").Length() > 0,
		"hasAside":   doc.Find("aside").Length() > 0,
		"hasFooter":  doc.Find("footer").Length() > 0,
	}
}

func calculateContentToHtmlRatio(doc *goquery.Document) string {
	content := doc.Find("body").Text()
	html, _ := doc.Html()
	ratio := float64(len(content)) / float64(len(html)) * 100
	return fmt.Sprintf("%.2f%%", ratio)
}

func extractKeywordUsage(doc *goquery.Document) []map[string]interface{} {
	text := strings.ToLower(doc.Find("body").Text())
	words := strings.Fields(text)
	wordCounts := make(map[string]int)
	for _, word := range words {
		wordCounts[word]++
	}

	var keywordUsage []map[string]interface{}
	for word, count := range wordCounts {
		keywordUsage = append(keywordUsage, map[string]interface{}{
			"word":    word,
			"count":   count,
			"density": fmt.Sprintf("%.2f%%", float64(count)/float64(len(words))*100),
		})
	}

	return keywordUsage[:10] // Return top 10 keywords
}

func calculateKeywordDensity(doc *goquery.Document) map[string]interface{} {
	text := strings.ToLower(doc.Find("body").Text())
	words := strings.Fields(text)
	wordCounts := make(map[string]int)
	for _, word := range words {
		wordCounts[word]++
	}

	var topKeywords []map[string]interface{}
	for word, count := range wordCounts {
		topKeywords = append(topKeywords, map[string]interface{}{
			"word":    word,
			"count":   count,
			"density": fmt.Sprintf("%.2f%%", float64(count)/float64(len(words))*100),
		})
	}

	return map[string]interface{}{
		"topKeywords": topKeywords[:5], // Return top 5 keywords
		"label":       "keyword_density",
	}
}

func analyzeTechnicalSeo(r *colly.Response) map[string]interface{} {
	return map[string]interface{}{
		"statusCode": r.StatusCode,
		"headers":    r.Headers,
		"isHttps":    strings.HasPrefix(r.Request.URL.String(), "https"),
	}
}

func savePageDataAsJson(u string, data interface{}, rootDir string) {
	parsedUrl, _ := url.Parse(u)
	relativePath := strings.TrimPrefix(parsedUrl.Path, CONFIG.BaseURL.Path)
	parts := strings.Split(strings.Trim(relativePath, "/"), "/")
	currentPath := filepath.Join(".", CONFIG.BaseURL.Hostname(), strings.Trim(CONFIG.BaseURL.Path, "/"))
	for _, part := range parts[:len(parts)-1] {
		currentPath = filepath.Join(currentPath, slugify(part))
		os.MkdirAll(currentPath, os.ModePerm)
	}
	fileName := "index"
	if len(parts) > 0 && parts[len(parts)-1] != "" {
		fileName = slugify(parts[len(parts)-1])
	}
	filePath := filepath.Join(currentPath, fmt.Sprintf("%s.json", fileName))
	fileData, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		fmt.Printf("Error marshaling JSON: %v\n", err)
		return
	}
	err = os.WriteFile(filePath, fileData, 0644)
	if err != nil {
		fmt.Printf("Error writing file: %v\n", err)
	}
	fmt.Printf("Saved: %s\n", filePath)
}

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

func slugify(s string) string {
	re := regexp.MustCompile(`[^a-z0-9]+`)
	return strings.Trim(re.ReplaceAllString(strings.ToLower(s), "-"), "-")
}
