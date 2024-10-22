// sitemap.go
package main

import (
	"encoding/xml"
	"fmt"
	"io/ioutil"
	"path/filepath"
	"sync"
)

type Sitemap struct {
	XMLName xml.Name `xml:"urlset"`
	URLs    []string `xml:"url>loc"`
}

type SitemapIndex struct {
	XMLName  xml.Name `xml:"sitemapindex"`
	Sitemaps []string `xml:"sitemap>loc"`
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

