// config.go
package main

import (
	"net/url"
	"os"
	"strings"
	"sync"
	"time"
)

// Config holds the configuration settings for the crawler
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
	SkipSitemapRobots   bool
}

// Global configuration variable
var CONFIG Config

// Global variables for crawler state
var (
	crawledUrls = make(map[string]struct{})
	cache       = make(map[string][]byte)
	cacheMutex  sync.Mutex
	basePath    string
	websiteName string
	seenUrls    = make(map[string]struct{})
	seenMutex   sync.Mutex
)

// init initializes the configuration settings
func init() {
	// Default base URL
	baseURLStr := "https://developers.google.com/search/docs/"
	if len(os.Args) > 1 {
		baseURLStr = os.Args[1]
	}
	baseURL, err := url.Parse(baseURLStr)
	if err != nil {
		panic(err)
	}

	// Set up the configuration with default values
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

	// Set base path and website name
	basePath = "/"
	websiteName = strings.ToLower(strings.ReplaceAll(strings.Trim(CONFIG.BaseURL.Hostname(), "/"), ".", "-"))
}
