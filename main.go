// main.go
package main

import (
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"time"

	"github.com/gocolly/colly/v2"
)

func main() {
	fmt.Printf("Starting crawl of %s\n", CONFIG.BaseURL.String())

	rootDir := filepath.Join(".", CONFIG.BaseURL.Hostname())
	os.MkdirAll(rootDir, os.ModePerm)

	c := setupCollector()

	var processedURLs []string

	if !CONFIG.SkipSitemapRobots {
		robotsTxtURL := CONFIG.BaseURL.ResolveReference(&url.URL{Path: "/robots.txt"}).String()
		robotsTxtPath := filepath.Join(rootDir, "robots.txt")
		robotsTxtContent := downloadFile(robotsTxtURL, robotsTxtPath)

		sitemapURLs := extractSitemapURLs(robotsTxtContent)
		processedURLs = processSitemapsRecursively(sitemapURLs, rootDir)
	}

	setupCrawlerCallbacks(c, rootDir)

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

func setupCollector() *colly.Collector {
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

	return c
}
