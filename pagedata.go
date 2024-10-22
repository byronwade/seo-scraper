// pagedata.go
// pagedata.go
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"math"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"sort"

	"html"

	"github.com/PuerkitoBio/goquery"
	"github.com/bbalet/stopwords"
	"github.com/gocolly/colly/v2"
	"github.com/jdkato/prose/v2"
)

type PageData struct {
	URL                 string             `json:"url"`
	EstimatedGoogleRank int                `json:"estimatedGoogleRank"`
	PriorityIndicators  PriorityIndicators `json:"priorityIndicators"`
	TechnicalSEO        TechnicalSEO       `json:"technicalSEO"`
	Content             Content            `json:"content"`
	SEOScores           SEOScores          `json:"seoScores"`
	AdditionalInsights  AdditionalInsights `json:"additionalInsights"`
}

type PriorityIndicators struct {
	HighPriority   HighPriority   `json:"highPriority"`
	MediumPriority MediumPriority `json:"mediumPriority"`
	LowPriority    LowPriority    `json:"lowPriority"`
}

type HighPriority struct {
	ContentQuality  ContentQuality  `json:"contentQuality"`
	UserExperience  UserExperience  `json:"userExperience"`
	PageSpeed       PageSpeed       `json:"pageSpeed"`
	Metadata        Metadata        `json:"metadata"`
	InternalLinking InternalLinking `json:"internalLinking"`
}

type ContentQuality struct {
	WordCount              int                `json:"wordCount"`
	ContentUniquenessScore int                `json:"contentUniquenessScore"`
	ReadingLevel           string             `json:"readingLevel"`
	KeywordOccurrences     KeywordOccurrences `json:"keywordOccurrences"`
	LSITerms               []string           `json:"lsiTerms"`
	TextContent            string             `json:"textContent"`
	KeywordDensity         float64            `json:"keywordDensity"`
	ContentSections        []ContentSection   `json:"contentSections"`
}

type KeywordOccurrences struct {
	PrimaryKeyword    int            `json:"primaryKeyword"`
	SecondaryKeywords map[string]int `json:"secondaryKeywords"`
}

type ContentSection struct {
	SectionTitle     string `json:"sectionTitle"`
	Text             string `json:"text"`
	SectionWordCount int    `json:"sectionWordCount"`
}

type UserExperience struct {
	MobileFriendly       bool               `json:"mobileFriendly"`
	CoreWebVitals        CoreWebVitals      `json:"coreWebVitals"`
	Accessibility        Accessibility      `json:"accessibility"`
	PopupsOrInterruption PopupsInterruption `json:"popupsOrInterruption"`
}

type CoreWebVitals struct {
	LargestContentfulPaintMs int     `json:"largestContentfulPaintMs"`
	FirstInputDelayMs        int     `json:"firstInputDelayMs"`
	CumulativeLayoutShift    float64 `json:"cumulativeLayoutShift"`
}

type Accessibility struct {
	HasAltText             bool   `json:"hasAltText"`
	MetaViewportTagPresent bool   `json:"metaViewportTagPresent"`
	ColorContrastScore     int    `json:"colorContrastScore"`
	KeyboardNavigation     string `json:"keyboardNavigation"`
}

type PopupsInterruption struct {
	HasIntrusivePopups bool     `json:"hasIntrusivePopups"`
	PopupTypes         []string `json:"popupTypes"`
}

type PageSpeed struct {
	FetchTimeMs            int `json:"fetchTimeMs"`
	HTMLSizeKb             int `json:"htmlSizeKb"`
	ResourceCount          int `json:"resourceCount"`
	TimeToInteractiveMs    int `json:"timeToInteractiveMs"`
	FirstContentfulPaintMs int `json:"firstContentfulPaintMs"`
	ImageOptimizationScore int `json:"imageOptimizationScore"`
}

type Metadata struct {
	Title                 string `json:"title"`
	MetaDescription       string `json:"metaDescription"`
	TitleLength           int    `json:"titleLength"`
	MetaDescriptionLength int    `json:"metaDescriptionLength"`
}

type InternalLinking struct {
	Links                       []Link `json:"links"`
	AverageInternalLinksPerPage int    `json:"averageInternalLinksPerPage"`
}

type Link struct {
	Href       string `json:"href"`
	AnchorText string `json:"anchorText"`
	LinkType   string `json:"linkType"`
	Context    string `json:"context"`
}

type MediumPriority struct {
	BacklinkProfile  BacklinkProfile  `json:"backlinkProfile"`
	StructuredData   []StructuredData `json:"structuredData"`
	SocialSignals    SocialSignals    `json:"socialSignals"`
	ContentFreshness ContentFreshness `json:"contentFreshness"`
}

type BacklinkProfile struct {
	NumberOfBacklinks      int     `json:"numberOfBacklinks"`
	ReferringDomains       int     `json:"referringDomains"`
	AverageDomainAuthority int     `json:"averageDomainAuthority"`
	NofollowLinksRatio     float64 `json:"nofollowLinksRatio"`
}

type StructuredData struct {
	Type       string                 `json:"type"`
	Properties map[string]interface{} `json:"properties"`
}

type SocialSignals struct {
	NumberOfShares NumberOfShares `json:"numberOfShares"`
	EngagementRate float64        `json:"engagementRate"`
}

type NumberOfShares struct {
	Facebook int `json:"facebook"`
	Twitter  int `json:"twitter"`
	LinkedIn int `json:"linkedin"`
}

type ContentFreshness struct {
	LastUpdatedDate string `json:"lastUpdatedDate"`
	UpdateFrequency string `json:"updateFrequency"`
}

type LowPriority struct {
	OpenGraphTags OpenGraphTags `json:"openGraphTags"`
	TwitterCards  TwitterCards  `json:"twitterCards"`
}

type OpenGraphTags struct {
	OgTitle       string `json:"ogTitle"`
	OgDescription string `json:"ogDescription"`
	OgImage       string `json:"ogImage"`
}

type TwitterCards struct {
	CardType    string `json:"cardType"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Image       string `json:"image"`
}

type TechnicalSEO struct {
	URLStructure URLStructure     `json:"urlStructure"`
	SchemaMarkup []StructuredData `json:"schemaMarkup"`
}

type URLStructure struct {
	IsClean          bool `json:"isClean"`
	ContainsKeywords bool `json:"containsKeywords"`
	Length           int  `json:"length"`
	HTTPSEnabled     bool `json:"httpsEnabled"`
}

type Content struct {
	PlainText      string         `json:"plainText"`
	CleanedHTML    string         `json:"cleanedHTML"`
	FullHTML       string         `json:"fullHTML"` // Add this line
	TextStatistics TextStatistics `json:"textStatistics"`
}

type TextStatistics struct {
	SentenceCount           int     `json:"sentenceCount"`
	ParagraphCount          int     `json:"paragraphCount"`
	AverageWordsPerSentence float64 `json:"averageWordsPerSentence"`
	ReadabilityScore        int     `json:"readabilityScore"`
}

type SEOScores struct {
	OverallScore        int `json:"overallScore"`
	ContentScore        int `json:"contentScore"`
	TechnicalScore      int `json:"technicalScore"`
	UserExperienceScore int `json:"userExperienceScore"`
	SocialScore         int `json:"socialScore"`
}

type AdditionalInsights struct {
	KeywordRelevanceScore int `json:"keywordRelevanceScore"`
	ContentDepthScore     int `json:"contentDepthScore"`
	EstimatedTraffic      int `json:"estimatedTraffic"`
	PageAuthority         int `json:"pageAuthority"`
}

func extractPageData(r *colly.Response) *PageData {
	doc, err := goquery.NewDocumentFromReader(bytes.NewReader(r.Body))
	if err != nil {
		fmt.Printf("Error parsing HTML: %v\n", err)
		return nil
	}

	return &PageData{
		URL:                 r.Request.URL.String(),
		EstimatedGoogleRank: estimateGoogleRank(doc),
		PriorityIndicators:  extractPriorityIndicators(doc, r),
		TechnicalSEO:        extractTechnicalSEO(r),
		Content:             extractContent(r),
		SEOScores:           calculateSEOScores(doc, r),
		AdditionalInsights:  extractAdditionalInsights(doc),
	}
}

func extractContent(r *colly.Response) Content {
	doc, err := goquery.NewDocumentFromReader(bytes.NewReader(r.Body))
	if err != nil {
		fmt.Println("Error parsing HTML:", err)
		return Content{}
	}

	var textBuilder strings.Builder

	// Remove non-content elements
	doc.Find("script, style").Remove()

	// Extract text from body
	doc.Find("body").Each(func(i int, s *goquery.Selection) {
		s.Contents().Each(func(i int, c *goquery.Selection) {
			extractTextFromNode(&textBuilder, c, 0)
		})
	})

	plainText := textBuilder.String()
	plainText = removeExtraWhitespace(plainText)
	plainText = html.UnescapeString(plainText)

	return Content{
		PlainText: plainText,
		// ... other fields ...
	}
}

func extractTextFromNode(builder *strings.Builder, s *goquery.Selection, depth int) {
	if goquery.NodeName(s) == "#text" {
		text := strings.TrimSpace(s.Text())
		if text != "" {
			builder.WriteString(text + " ")
		}
	} else {
		// Handle specific elements
		switch goquery.NodeName(s) {
		case "br":
			builder.WriteString("\n")
		case "p", "div", "h1", "h2", "h3", "h4", "h5", "h6":
			if depth > 0 {
				builder.WriteString("\n")
			}
		case "li":
			builder.WriteString("- ")
		}

		// Recursively extract text from child nodes
		s.Contents().Each(func(i int, c *goquery.Selection) {
			extractTextFromNode(builder, c, depth+1)
		})

		// Add newline after block-level elements
		switch goquery.NodeName(s) {
		case "p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol":
			builder.WriteString("\n")
		}
	}
}

// extractBodyContent extracts the content inside the <body> tag.
func extractBodyContent(htmlStr string) string {
	bodyRegex := regexp.MustCompile(`(?is)<body.*?>(.*?)</body>`)
	matches := bodyRegex.FindStringSubmatch(htmlStr)
	if len(matches) > 1 {
		return matches[1] // Return the content inside <body>...</body>
	}
	return htmlStr // If no <body> tags are found, return the original content
}

// removeTags removes <script> and <style> tags including their content from the HTML string.
func removeTags(htmlStr string) string {
	scriptRegex := regexp.MustCompile(`(?is)<script.*?>.*?</script>`)
	styleRegex := regexp.MustCompile(`(?is)<style.*?>.*?</style>`)

	htmlStr = scriptRegex.ReplaceAllString(htmlStr, "")
	htmlStr = styleRegex.ReplaceAllString(htmlStr, "")

	return htmlStr
}

// minifyHTML aggressively reduces whitespace and unnecessary attributes from the HTML.
func minifyHTML(htmlStr string) string {
	// Regular expression to match multiple spaces, newlines, and tabs
	whitespaceRegex := regexp.MustCompile(`\s{2,}`)

	// Replace multiple spaces/newlines/tabs with a single space
	htmlStr = whitespaceRegex.ReplaceAllString(htmlStr, " ")

	// Remove spaces around angle brackets
	htmlStr = strings.ReplaceAll(htmlStr, "> <", "><")

	// Trim leading and trailing spaces
	htmlStr = strings.TrimSpace(htmlStr)

	return htmlStr
}

func removeExtraWhitespace(s string) string {
	// Replace newlines and tabs with spaces
	s = strings.ReplaceAll(s, "\n", " ")
	s = strings.ReplaceAll(s, "\t", " ")

	// Replace multiple spaces with a single space
	space := regexp.MustCompile(`\s+`)
	s = space.ReplaceAllString(s, " ")

	return strings.TrimSpace(s)
}

func estimateGoogleRank(doc *goquery.Document) int {
	// Implement logic to estimate Google rank
	return 5 // Placeholder
}

func extractPriorityIndicators(doc *goquery.Document, r *colly.Response) PriorityIndicators {
	return PriorityIndicators{
		HighPriority:   extractHighPriorityIndicators(doc, r),
		MediumPriority: extractMediumPriorityIndicators(doc),
		LowPriority:    extractLowPriorityIndicators(doc),
	}
}

func extractHighPriorityIndicators(doc *goquery.Document, r *colly.Response) HighPriority {
	return HighPriority{
		ContentQuality:  extractContentQuality(doc),
		UserExperience:  extractUserExperience(doc),
		PageSpeed:       extractPageSpeed(r),
		Metadata:        extractMetadata(doc),
		InternalLinking: extractInternalLinking(doc),
	}
}

func extractContentQuality(doc *goquery.Document) ContentQuality {
	// Extract main content
	content := doc.Find("body").Text()
	cleanContent := stopwords.CleanString(content, "en", true)

	// Calculate word count
	words := strings.Fields(cleanContent)
	wordCount := len(words)

	// Calculate reading level (using a simple method)
	readingLevel := calculateReadingLevel(content)

	// Extract keywords and calculate density
	keywords := extractKeywords(cleanContent)
	primaryKeyword := keywords[0]
	secondaryKeywords := make(map[string]int)
	for i := 1; i < len(keywords) && i < 5; i++ {
		secondaryKeywords[keywords[i]] = strings.Count(strings.ToLower(cleanContent), strings.ToLower(keywords[i]))
	}

	// Calculate keyword density
	keywordDensity := float64(strings.Count(strings.ToLower(cleanContent), strings.ToLower(primaryKeyword))) / float64(wordCount) * 100

	// Extract content sections
	sections := extractContentSections(doc)

	return ContentQuality{
		WordCount:              wordCount,
		ContentUniquenessScore: calculateUniquenessScore(cleanContent),
		ReadingLevel:           readingLevel,
		KeywordOccurrences: KeywordOccurrences{
			PrimaryKeyword:    strings.Count(strings.ToLower(cleanContent), strings.ToLower(primaryKeyword)),
			SecondaryKeywords: secondaryKeywords,
		},
		LSITerms:        extractLSITerms(cleanContent),
		TextContent:     content[:min(500, len(content))], // First 500 characters
		KeywordDensity:  keywordDensity,
		ContentSections: sections,
	}
}

func calculateReadingLevel(text string) string {
	sentences := len(strings.Split(text, "."))
	words := len(strings.Fields(text))
	syllables := countSyllables(text)

	fleschKincaid := 0.39*float64(words)/float64(sentences) + 11.8*float64(syllables)/float64(words) - 15.59

	switch {
	case fleschKincaid <= 6:
		return "Grade 6"
	case fleschKincaid <= 8:
		return "Grade 8"
	case fleschKincaid <= 10:
		return "Grade 10"
	case fleschKincaid <= 12:
		return "Grade 12"
	default:
		return "College"
	}
}

func calculateUniquenessScore(content string) int {
	// This is a simplified method. In a real-world scenario, you might want to use
	// more sophisticated techniques like comparing against a corpus of documents.
	words := strings.Fields(content)
	uniqueWords := make(map[string]bool)
	for _, word := range words {
		uniqueWords[strings.ToLower(word)] = true
	}
	return int(float64(len(uniqueWords)) / float64(len(words)) * 100)
}

func extractKeywords(content string) []string {
	doc, _ := prose.NewDocument(content)
	wordFreq := make(map[string]int)
	for _, tok := range doc.Tokens() {
		if tok.Tag == "NN" || tok.Tag == "NNP" || tok.Tag == "NNS" || tok.Tag == "NNPS" {
			wordFreq[strings.ToLower(tok.Text)]++
		}
	}

	type kv struct {
		Key   string
		Value int
	}
	var ss []kv
	for k, v := range wordFreq {
		ss = append(ss, kv{k, v})
	}
	sort.Slice(ss, func(i, j int) bool {
		return ss[i].Value > ss[j].Value
	})

	var keywords []string
	for i := 0; i < min(10, len(ss)); i++ {
		keywords = append(keywords, ss[i].Key)
	}
	return keywords
}

func extractLSITerms(content string) []string {
	// This is a placeholder. In a real-world scenario, you'd use more advanced NLP techniques.
	words := strings.Fields(content)
	uniqueWords := make(map[string]bool)
	for _, word := range words {
		if len(word) > 3 {
			uniqueWords[strings.ToLower(word)] = true
		}
	}
	var lsiTerms []string
	for word := range uniqueWords {
		lsiTerms = append(lsiTerms, word)
	}
	sort.Strings(lsiTerms)
	return lsiTerms[:min(5, len(lsiTerms))]
}

func extractContentSections(doc *goquery.Document) []ContentSection {
	var sections []ContentSection
	doc.Find("h1, h2, h3, h4, h5, h6").Each(func(i int, s *goquery.Selection) {
		title := s.Text()
		content := s.NextUntil("h1, h2, h3, h4, h5, h6").Text()
		sections = append(sections, ContentSection{
			SectionTitle:     title,
			Text:             content,
			SectionWordCount: len(strings.Fields(content)),
		})
	})
	return sections
}

func extractUserExperience(doc *goquery.Document) UserExperience {
	return UserExperience{
		MobileFriendly:       checkMobileFriendly(doc),
		CoreWebVitals:        extractCoreWebVitals(doc),
		Accessibility:        extractAccessibility(doc),
		PopupsOrInterruption: extractPopupsInterruption(doc),
	}
}

func checkMobileFriendly(doc *goquery.Document) bool {
	// Check for responsive meta tag
	_, exists := doc.Find("meta[name='viewport']").Attr("content")
	if exists {
		return true
	}

	// Check for media queries in style tags
	mediaQueryCount := 0
	doc.Find("style").Each(func(i int, s *goquery.Selection) {
		if strings.Contains(s.Text(), "@media") {
			mediaQueryCount++
		}
	})

	return mediaQueryCount > 0
}

func extractCoreWebVitals(doc *goquery.Document) CoreWebVitals {
	// This is a simplified estimation. In reality, these metrics require real user data.
	lcp := estimateLCP(doc)
	fid := estimateFID(doc)
	cls := estimateCLS(doc)

	return CoreWebVitals{
		LargestContentfulPaintMs: lcp,
		FirstInputDelayMs:        fid,
		CumulativeLayoutShift:    cls,
	}
}

func estimateLCP(doc *goquery.Document) int {
	// Estimate LCP based on the largest image or text block
	largestSize := 0
	doc.Find("img, h1, h2, p").Each(func(i int, s *goquery.Selection) {
		if s.Is("img") {
			width, _ := s.Attr("width")
			height, _ := s.Attr("height")
			size := len(width) * len(height)
			if size > largestSize {
				largestSize = size
			}
		} else {
			if len(s.Text()) > largestSize {
				largestSize = len(s.Text())
			}
		}
	})
	// This is a very rough estimation
	return largestSize * 10 // Multiply by 10 to get a millisecond value
}

func estimateFID(doc *goquery.Document) int {
	// Count the number of JavaScript files as a rough proxy for FID
	scriptCount := doc.Find("script[src]").Length()
	return scriptCount * 5 // Assume 5ms delay per script, very rough estimate
}

func estimateCLS(doc *goquery.Document) float64 {
	// Count the number of elements that might cause layout shifts
	shiftingElements := doc.Find("img:not([width]):not([height]), iframe:not([width]):not([height]), div:empty").Length()
	return float64(shiftingElements) * 0.01 // Assume 0.01 shift per element, very rough estimate
}

func extractAccessibility(doc *goquery.Document) Accessibility {
	return Accessibility{
		HasAltText:             checkAltText(doc),
		MetaViewportTagPresent: checkMetaViewport(doc),
		ColorContrastScore:     estimateColorContrast(doc),
		KeyboardNavigation:     checkKeyboardNavigation(doc),
	}
}

func checkAltText(doc *goquery.Document) bool {
	totalImages := doc.Find("img").Length()
	imagesWithAlt := doc.Find("img[alt]").Length()
	return imagesWithAlt == totalImages
}

func checkMetaViewport(doc *goquery.Document) bool {
	_, exists := doc.Find("meta[name='viewport']").Attr("content")
	return exists
}

func estimateColorContrast(doc *goquery.Document) int {
	// This is a very simplified estimation
	darkColors := 0
	lightColors := 0
	doc.Find("[style]").Each(func(i int, s *goquery.Selection) {
		style, _ := s.Attr("style")
		if strings.Contains(style, "color:") || strings.Contains(style, "background-color:") {
			if strings.Contains(style, "#") {
				color := regexp.MustCompile("#[0-9a-fA-F]{6}").FindString(style)
				if len(color) == 7 {
					r, _ := strconv.ParseInt(color[1:3], 16, 0)
					g, _ := strconv.ParseInt(color[3:5], 16, 0)
					b, _ := strconv.ParseInt(color[5:7], 16, 0)
					brightness := (r*299 + g*587 + b*114) / 1000
					if brightness < 128 {
						darkColors++
					} else {
						lightColors++
					}
				}
			}
		}
	})
	totalColors := darkColors + lightColors
	if totalColors == 0 {
		return 50 // Default score if no colors found
	}
	return int((float64(darkColors) / float64(totalColors)) * 100)
}

func checkKeyboardNavigation(doc *goquery.Document) string {
	interactiveElements := doc.Find("a, button, input, select, textarea").Length()
	tabindexElements := doc.Find("[tabindex]").Length()
	if tabindexElements >= interactiveElements {
		return "fully supported"
	} else if tabindexElements > 0 {
		return "partially supported"
	}
	return "not supported"
}

func extractPopupsInterruption(doc *goquery.Document) PopupsInterruption {
	popupTypes := []string{}
	hasIntrusivePopups := false

	// Check for common popup classes or IDs
	popupSelectors := []string{".popup", "#popup", ".modal", "#modal", ".overlay", "#overlay"}
	for _, selector := range popupSelectors {
		if doc.Find(selector).Length() > 0 {
			hasIntrusivePopups = true
			popupTypes = append(popupTypes, strings.TrimPrefix(selector, "."))
		}
	}

	// Check for elements with 'position: fixed' or 'position: absolute'
	doc.Find("[style]").Each(func(i int, s *goquery.Selection) {
		style, _ := s.Attr("style")
		if strings.Contains(style, "position:fixed") || strings.Contains(style, "position:absolute") {
			hasIntrusivePopups = true
			popupTypes = append(popupTypes, "fixed-position")
		}
	})

	return PopupsInterruption{
		HasIntrusivePopups: hasIntrusivePopups,
		PopupTypes:         popupTypes,
	}
}

func extractPageSpeed(r *colly.Response) PageSpeed {
	startTime := time.Now()

	// Calculate fetch time
	fetchTimeMs := time.Since(startTime).Milliseconds()

	// Calculate HTML size
	htmlSizeKb := float64(len(r.Body)) / 1024

	// Count resources
	doc, _ := goquery.NewDocumentFromReader(bytes.NewReader(r.Body))
	resourceCount := doc.Find("script, link[rel='stylesheet'], img").Length()

	// Estimate Time to Interactive (TTI)
	scriptCount := doc.Find("script").Length()
	timeToInteractiveMs := int64(scriptCount * 100) // Rough estimate: 100ms per script

	// Estimate First Contentful Paint (FCP)
	firstContentfulPaintMs := fetchTimeMs + 100 // Rough estimate: fetch time + 100ms

	// Calculate image optimization score
	imageOptimizationScore := calculateImageOptimizationScore(doc)

	return PageSpeed{
		FetchTimeMs:            int(fetchTimeMs),
		HTMLSizeKb:             int(htmlSizeKb),
		ResourceCount:          resourceCount,
		TimeToInteractiveMs:    int(timeToInteractiveMs),
		FirstContentfulPaintMs: int(firstContentfulPaintMs),
		ImageOptimizationScore: imageOptimizationScore,
	}
}

func calculateImageOptimizationScore(doc *goquery.Document) int {
	totalScore := 0
	imageCount := 0

	doc.Find("img").Each(func(i int, s *goquery.Selection) {
		src, exists := s.Attr("src")
		if exists {
			resp, err := http.Get(src)
			if err == nil {
				defer resp.Body.Close()
				img, _, err := image.DecodeConfig(resp.Body)
				if err == nil {
					// Check if image is appropriately sized
					width, _ := s.Attr("width")
					height, _ := s.Attr("height")
					if width != "" && height != "" {
						if img.Width <= 2*atoi(width) && img.Height <= 2*atoi(height) {
							totalScore += 100
						} else {
							totalScore += 50
						}
					} else {
						totalScore += 75 // No size specified, assume it's okay
					}
					imageCount++
				}
			}
		}
	})

	if imageCount == 0 {
		return 100 // No images, consider it fully optimized
	}

	return totalScore / imageCount
}

func atoi(s string) int {
	i, _ := strconv.Atoi(s)
	return i
}

func extractMetadata(doc *goquery.Document) Metadata {
	// Implement metadata extraction logic
	title := doc.Find("title").Text()
	metaDescription, _ := doc.Find("meta[name='description']").Attr("content")
	return Metadata{
		Title:                 title,
		MetaDescription:       metaDescription,
		TitleLength:           len(title),
		MetaDescriptionLength: len(metaDescription),
	}
}

func extractInternalLinking(doc *goquery.Document) InternalLinking {
	// Implement internal linking extraction logic
	var links []Link
	doc.Find("a").Each(func(_ int, s *goquery.Selection) {
		href, _ := s.Attr("href")
		links = append(links, Link{
			Href:       href,
			AnchorText: cleanAnchorText(s.Text()),
			LinkType:   "follow",       // You'll need to implement logic to determine this
			Context:    "Main Content", // You'll need to implement logic to determine this
		})
	})
	return InternalLinking{
		Links:                       links,
		AverageInternalLinksPerPage: len(links),
	}
}

func extractMediumPriorityIndicators(doc *goquery.Document) MediumPriority {
	// Implement medium priority indicators extraction logic
	return MediumPriority{
		BacklinkProfile:  extractBacklinkProfile(),
		StructuredData:   extractStructuredData(doc),
		SocialSignals:    extractSocialSignals(),
		ContentFreshness: extractContentFreshness(doc),
	}
}

func extractBacklinkProfile() BacklinkProfile {
	// Implement backlink profile extraction logic
	return BacklinkProfile{
		NumberOfBacklinks:      50,
		ReferringDomains:       20,
		AverageDomainAuthority: 60,
		NofollowLinksRatio:     0.2,
	}
}

func extractStructuredData(doc *goquery.Document) []StructuredData {
	var structuredData []StructuredData

	// Look for JSON-LD structured data
	doc.Find("script[type='application/ld+json']").Each(func(i int, s *goquery.Selection) {
		var data map[string]interface{}
		if err := json.Unmarshal([]byte(s.Text()), &data); err == nil {
			if data["@type"] == "BreadcrumbList" {
				structuredData = append(structuredData, extractBreadcrumbFromJSON(data))
			}
		}
	})

	// If no JSON-LD data found, try to extract from HTML
	if len(structuredData) == 0 {
		breadcrumb := extractBreadcrumbFromHTML(doc)
		if breadcrumb.Type != "" {
			structuredData = append(structuredData, breadcrumb)
		}
	}

	return structuredData
}

func extractBreadcrumbFromJSON(data map[string]interface{}) StructuredData {
	breadcrumb := StructuredData{
		Type:       "BreadcrumbList",
		Properties: make(map[string]interface{}),
	}

	if itemList, ok := data["itemListElement"].([]interface{}); ok {
		var items []map[string]interface{}
		for position, item := range itemList {
			if itemMap, ok := item.(map[string]interface{}); ok {
				items = append(items, map[string]interface{}{
					"position": position + 1,
					"name":     itemMap["name"],
					"item":     itemMap["item"],
				})
			}
		}
		breadcrumb.Properties["itemListElement"] = items
	}

	return breadcrumb
}

func extractBreadcrumbFromHTML(doc *goquery.Document) StructuredData {
	breadcrumb := StructuredData{
		Type:       "BreadcrumbList",
		Properties: make(map[string]interface{}),
	}

	var items []map[string]interface{}
	position := 1

	// Look for common breadcrumb selectors
	selectors := []string{".breadcrumb", ".breadcrumbs", "nav[aria-label='Breadcrumb']", "[itemtype='http://schema.org/BreadcrumbList']"}
	for _, selector := range selectors {
		doc.Find(selector).Find("a").Each(func(i int, s *goquery.Selection) {
			name := strings.TrimSpace(s.Text())
			href, exists := s.Attr("href")
			if exists && name != "" {
				items = append(items, map[string]interface{}{
					"position": position,
					"name":     name,
					"item":     href,
				})
				position++
			}
		})
		if len(items) > 0 {
			break
		}
	}

	if len(items) > 0 {
		breadcrumb.Properties["itemListElement"] = items
		return breadcrumb
	}

	return StructuredData{} // Return empty if no breadcrumb found
}

func extractSocialSignals() SocialSignals {
	// Implement social signals extraction logic
	return SocialSignals{
		NumberOfShares: NumberOfShares{
			Facebook: 100,
			Twitter:  50,
			LinkedIn: 30,
		},
		EngagementRate: 0.05,
	}
}

func extractContentFreshness(doc *goquery.Document) ContentFreshness {
	freshness := ContentFreshness{
		LastUpdatedDate: "",
		UpdateFrequency: "",
	}

	// Check for common meta tags
	doc.Find("meta").Each(func(i int, s *goquery.Selection) {
		if name, _ := s.Attr("name"); name == "article:modified_time" {
			freshness.LastUpdatedDate = s.AttrOr("content", "")
		}
	})

	// Check for schema.org metadata
	doc.Find(`script[type="application/ld+json"]`).Each(func(i int, s *goquery.Selection) {
		var data map[string]interface{}
		if err := json.Unmarshal([]byte(s.Text()), &data); err == nil {
			if date, ok := data["dateModified"].(string); ok {
				freshness.LastUpdatedDate = date
			}
		}
	})

	// Check for visible date elements
	dateSelectors := []string{
		".post-modified-date", ".last-updated", ".modified-date",
		"time.updated", "span.date-modified", "p.last-updated",
	}
	for _, selector := range dateSelectors {
		if date := doc.Find(selector).First().Text(); date != "" {
			freshness.LastUpdatedDate = strings.TrimSpace(date)
			break
		}
	}

	// Estimate update frequency based on the last updated date
	if freshness.LastUpdatedDate != "" {
		lastUpdated, err := time.Parse(time.RFC3339, freshness.LastUpdatedDate)
		if err == nil {
			daysSinceUpdate := time.Since(lastUpdated).Hours() / 24
			switch {
			case daysSinceUpdate < 7:
				freshness.UpdateFrequency = "weekly"
			case daysSinceUpdate < 30:
				freshness.UpdateFrequency = "monthly"
			case daysSinceUpdate < 90:
				freshness.UpdateFrequency = "quarterly"
			default:
				freshness.UpdateFrequency = "infrequently"
			}
		}
	}

	// If we couldn't find a date, set default values
	if freshness.LastUpdatedDate == "" {
		freshness.LastUpdatedDate = "Unknown"
		freshness.UpdateFrequency = "Unknown"
	}

	return freshness
}

func extractLowPriorityIndicators(doc *goquery.Document) LowPriority {
	// Implement low priority indicators extraction logic
	return LowPriority{
		OpenGraphTags: extractOpenGraphTags(doc),
		TwitterCards:  extractTwitterCards(doc),
	}
}

func extractOpenGraphTags(doc *goquery.Document) OpenGraphTags {
	// Implement Open Graph tags extraction logic
	return OpenGraphTags{
		OgTitle:       doc.Find("meta[property='og:title']").AttrOr("content", ""),
		OgDescription: doc.Find("meta[property='og:description']").AttrOr("content", ""),
		OgImage:       doc.Find("meta[property='og:image']").AttrOr("content", ""),
	}
}

func extractTwitterCards(doc *goquery.Document) TwitterCards {
	// Implement Twitter Cards extraction logic
	return TwitterCards{
		CardType:    doc.Find("meta[name='twitter:card']").AttrOr("content", ""),
		Title:       doc.Find("meta[name='twitter:title']").AttrOr("content", ""),
		Description: doc.Find("meta[name='twitter:description']").AttrOr("content", ""),
		Image:       doc.Find("meta[name='twitter:image']").AttrOr("content", ""),
	}
}

func extractTechnicalSEO(r *colly.Response) TechnicalSEO {
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(string(r.Body)))
	if err != nil {
		// Handle error (e.g., log it or return empty SchemaMarkup)
		return TechnicalSEO{
			URLStructure: URLStructure{
				IsClean:          true,
				ContainsKeywords: true,
				Length:           len(r.Request.URL.Path),
				HTTPSEnabled:     r.Request.URL.Scheme == "https",
			},
			SchemaMarkup: []StructuredData{},
		}
	}
	return TechnicalSEO{
		URLStructure: URLStructure{
			IsClean:          true,
			ContainsKeywords: true,
			Length:           len(r.Request.URL.Path),
			HTTPSEnabled:     r.Request.URL.Scheme == "https",
		},
		SchemaMarkup: extractStructuredData(doc),
	}
}

func calculateSEOScores(doc *goquery.Document, r *colly.Response) SEOScores {
	// Implement SEO scores calculation logic
	return SEOScores{
		OverallScore:        85,
		ContentScore:        90,
		TechnicalScore:      80,
		UserExperienceScore: 88,
		SocialScore:         75,
	}
}

func extractAdditionalInsights(doc *goquery.Document) AdditionalInsights {
	// Implement additional insights extraction logic
	return AdditionalInsights{
		KeywordRelevanceScore: 92,
		ContentDepthScore:     88,
		EstimatedTraffic:      5000,
		PageAuthority:         60,
	}
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

func scrapePage(url string) (*PageData, error) {
	c := colly.NewCollector()
	var pageData *PageData

	c.OnResponse(func(r *colly.Response) {
		content := extractContent(r)
		pageData = &PageData{
			URL:     r.Request.URL.String(),
			Content: content,
			// ... other fields ...
		}

		// Debug: Print the length of the extracted plain text
		fmt.Printf("Extracted plain text length: %d\n", len(content.PlainText))
	})

	c.OnRequest(func(r *colly.Request) {
		fmt.Println("Visiting", r.URL)
	})

	err := c.Visit(url)
	if err != nil {
		return nil, err
	}

	return pageData, nil
}

func cleanAnchorText(s string) string {
	// Remove newlines and extra spaces
	s = removeExtraWhitespace(s)
	// Remove any remaining whitespace at the start or end
	return strings.TrimSpace(s)
}

// Helper function to get the minimum of two integers
func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func countSentences(text string) int {
	// Simple sentence counting based on punctuation
	return len(regexp.MustCompile(`[.!?]+`).FindAllString(text, -1))
}

func countParagraphs(text string) int {
	// Count paragraphs based on double newlines
	return len(regexp.MustCompile(`\n\s*\n`).FindAllString(text, -1)) + 1
}

func calculateAverageWordsPerSentence(text string) float64 {
	sentences := regexp.MustCompile(`[.!?]+`).FindAllString(text, -1)
	words := regexp.MustCompile(`\S+`).FindAllString(text, -1)
	if len(sentences) == 0 {
		return 0
	}
	return float64(len(words)) / float64(len(sentences))
}

func calculateReadabilityScore(text string) int {
	// Implement Flesch-Kincaid Grade Level readability score
	words := strings.Fields(text)
	sentences := strings.Count(text, ".") + strings.Count(text, "!") + strings.Count(text, "?")
	syllables := countSyllables(text)

	if words == nil || sentences == 0 {
		return 0
	}

	wordsPerSentence := float64(len(words)) / float64(sentences)
	syllablesPerWord := float64(syllables) / float64(len(words))

	// Flesch-Kincaid Grade Level formula
	score := 0.39*wordsPerSentence + 11.8*syllablesPerWord - 15.59

	// Round to nearest integer and ensure it's within 0-100 range
	roundedScore := int(math.Round(score))
	if roundedScore < 0 {
		return 0
	} else if roundedScore > 100 {
		return 100
	}
	return roundedScore
}

// Helper function to count syllables in a word
func countSyllables(text string) int {
	text = strings.ToLower(text)
	count := 0
	vowels := "aeiouy"
	prevChar := ' '

	for _, char := range text {
		if strings.ContainsRune(vowels, char) && !strings.ContainsRune(vowels, prevChar) {
			count++
		}
		prevChar = char
	}

	// Adjust for common exceptions
	if strings.HasSuffix(text, "e") {
		count--
	}
	if strings.HasSuffix(text, "le") {
		count++
	}
	if count == 0 {
		count = 1
	}

	return count
}
