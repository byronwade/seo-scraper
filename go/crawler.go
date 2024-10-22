// crawler.go
package main

import (
	"fmt"
	"net/url"
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

