// crawler.go
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"github.com/gocolly/colly/v2"
)

func setupCrawlerCallbacks(c *colly.Collector, rootDir string) {
	c.OnHTML("a[href]", func(e *colly.HTMLElement) {
		link := e.Request.AbsoluteURL(e.Attr("href"))
		if shouldCrawl(link) {
			e.Request.Visit(link)
		}
	})

	c.OnResponse(func(r *colly.Response) {
		fmt.Printf("Visited: %s\n", r.Request.URL)
		pageData := extractPageData(r)
		savePageDataAsJSON(r.Request.URL.String(), pageData, rootDir)
	})

	c.OnError(func(r *colly.Response, err error) {
		fmt.Printf("Error on %s: %s\n", r.Request.URL, err)
	})
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

func savePageDataAsJSON(u string, data *PageData, rootDir string) {
	parsedURL, _ := url.Parse(u)
	relativePath := strings.TrimPrefix(parsedURL.Path, CONFIG.BaseURL.Path)
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

	// Create a custom marshaler that doesn't escape HTML
	jsonData, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		fmt.Printf("Error marshaling JSON: %v\n", err)
		return
	}

	// Replace escaped HTML entities
	jsonData = bytes.Replace(jsonData, []byte("\\u003c"), []byte("<"), -1)
	jsonData = bytes.Replace(jsonData, []byte("\\u003e"), []byte(">"), -1)
	jsonData = bytes.Replace(jsonData, []byte("\\u0026"), []byte("&"), -1)

	if err := os.WriteFile(filePath, jsonData, 0644); err != nil {
		fmt.Printf("Error writing file: %v\n", err)
		return
	}

	fmt.Printf("Saved: %s\n", filePath)
}

