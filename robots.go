// robots.go
package main

import (
	"net/url"
	"strings"
)

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

