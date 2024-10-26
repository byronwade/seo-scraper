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

// Main function to initiate the crawler
func main() {
	fmt.Printf("Starting crawl of %s\n", CONFIG.BaseURL.String())

	// Create the root directory based on the hostname
	rootDir := filepath.Join(".", CONFIG.BaseURL.Hostname())
	if err := os.MkdirAll(rootDir, os.ModePerm); err != nil {
		fmt.Printf("Error creating root directory: %v\n", err)
		return
	}

	// Set up the collector with configurations
	c := setupCollector()

	var processedURLs []string

	// Process sitemaps if not skipped
	if !CONFIG.SkipSitemapRobots {
		robotsTxtURL := CONFIG.BaseURL.ResolveReference(&url.URL{Path: "/robots.txt"}).String()
		robotsTxtPath := filepath.Join(rootDir, "robots.txt")
		robotsTxtContent := downloadFile(robotsTxtURL, robotsTxtPath)

		sitemapURLs := extractSitemapURLs(robotsTxtContent)
		processedURLs = processSitemapsRecursively(sitemapURLs, rootDir)
	}

	// Set up crawler callbacks
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

	// Wait until crawling is complete
	c.Wait()
	fmt.Println("Crawler finished.")
}

// setupCollector initializes the Colly collector with the desired configurations
func setupCollector() *colly.Collector {
	c := colly.NewCollector(
		colly.MaxDepth(CONFIG.MaxCrawlDepth),
		colly.Async(true),
		colly.UserAgent(CONFIG.UserAgent),
		colly.AllowedDomains(CONFIG.BaseURL.Hostname()),
	)

	// Set rate limits and delays
	c.Limit(&colly.LimitRule{
		DomainGlob:  "*",
		Parallelism: CONFIG.MaxConcurrency,
		RandomDelay: 5 * time.Second,
	})

	// Set request timeout
	c.SetRequestTimeout(CONFIG.RequestTimeout)

	// Respect or ignore robots.txt based on configuration
	c.IgnoreRobotsTxt = !CONFIG.RespectRobotsTxt

	return c
}
