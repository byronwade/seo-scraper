package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"io/ioutil"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Configuration variables
var (
	inputDir        = "/Users/byronwade/seo-scraper/src"
	outputDir       = "/Users/byronwade/seo-scraper/output"
	ollamaAPIURL    = "http://localhost:11434/api/generate"
	ollamaModel     = "llama2"
	maxRetries      = 5
	targetWordCount = 3000
)

// Struct for input JSON files
type InputContent struct {
	URL         string   `json:"url"`
	Slug        string   `json:"slug"`
	Title       string   `json:"title"`
	Description string   `json:"description"`
	Content     string   `json:"content"`
	Headers     []Header `json:"headers"`
	Author      string   `json:"author"`
}

type Header struct {
	Level string `json:"level"`
	Text  string `json:"text"`
}

// Struct for output JSON files
type OutputContent struct {
	ID             int64     `json:"id"`
	Title          string    `json:"title"`
	Content        string    `json:"content"`
	Slug           string    `json:"slug"`
	Description    string    `json:"description"`
	Author         string    `json:"author"`
	Date           time.Time `json:"date"`
	Image          string    `json:"image"`
	Keywords       []string  `json:"keywords"`
	SEOTitle       string    `json:"seoTitle"`
	SEODescription string    `json:"seoDescription"`
	SEOImage       string    `json:"seoImage"`
	CreatedAt      time.Time `json:"createdAt"`
	UpdatedAt      time.Time `json:"updatedAt"`
	ContentTypeID  int64     `json:"contentTypeId"`
	Sources        string    `json:"sources"`
	PageType       string    `json:"pageType"`
}

func readJSONFile(filePath string) (*InputContent, error) {
	log.Printf("Reading JSON file: %s", filePath)
	file, err := os.Open(filePath)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	data, err := io.ReadAll(file)
	if err != nil {
		return nil, err
	}

	var inputContent InputContent
	err = json.Unmarshal(data, &inputContent)
	if err != nil {
		return nil, err
	}

	log.Printf("Successfully read JSON file: %s", filePath)
	return &inputContent, nil
}

func callOllamaAPI(prompt string) (string, error) {
	log.Printf("Calling Ollama API with prompt: %s", prompt)
	requestBody := map[string]interface{}{
		"model":  ollamaModel,
		"prompt": prompt,
	}

	jsonBody, err := json.Marshal(requestBody)
	if err != nil {
		return "", err
	}

	req, err := http.NewRequest("POST", ollamaAPIURL, bytes.NewBuffer(jsonBody))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("Ollama API returned status code: %d", resp.StatusCode)
	}

	var apiResponse map[string]interface{}
	err = json.NewDecoder(resp.Body).Decode(&apiResponse)
	if err != nil {
		return "", err
	}

	generatedText, ok := apiResponse["generated_text"].(string)
	if !ok {
		return "", fmt.Errorf("unexpected response format from Ollama API")
	}

	log.Printf("Successfully called Ollama API and received generated text")
	return generatedText, nil
}

func generateContent(filePath string) (*OutputContent, error) {
	inputContent, err := ioutil.ReadFile(filePath)
	if err != nil {
		log.Printf("Error reading file %s: %v", filePath, err)
		return nil, err
	}

	log.Printf("Generating content for input: %+v", inputContent)
	var contentParts []string

	// Generate content outline
	outlinePrompt := fmt.Sprintf(`Please create an outline for an article with the following details:

Title: %s
Description: %s
Existing Content: %s

The outline should have 5-7 main sections, each focusing on a specific aspect of the topic. Provide a brief description for each section.`, inputContent.Title, inputContent.Description, inputContent.Content)

	outlineResponse, err := callOllamaAPI(outlinePrompt)
	if err != nil {
		log.Printf("Error calling Ollama API for outline: %v", err)
		return nil, fmt.Errorf("error generating content outline: %v", err)
	}
	log.Printf("Received outline response: %s", outlineResponse)

	// Extract outline sections
	outlineSections := extractOutlineSections(outlineResponse)
	log.Printf("Extracted outline sections: %+v", outlineSections)

	// Generate content for each section
	for _, section := range outlineSections {
			sectionPrompt := fmt.Sprintf(`Please generate a detailed and SEO-optimized paragraph or two for the following section:

Section: %s
Title: %s
Description: %s
Existing Content: %s

The generated content should be informative, engaging, and relevant to the section topic. Include relevant keywords and phrases for SEO optimization.`, section.Title, inputContent.Title, inputContent.Description, inputContent.Content)

		sectionResponse, err := callOllamaAPI(sectionPrompt)
		if err != nil {
			log.Printf("Error calling Ollama API for section: %v", err)
			return nil, fmt.Errorf("error generating section content: %v", err)
		}
		log.Printf("Received section response: %s", sectionResponse)

		contentParts = append(contentParts, sectionResponse)
	}

	// Combine the generated content parts
	var fullContentBuffer bytes.Buffer
	for _, part := range contentParts {
		fullContentBuffer.WriteString(part)
		fullContentBuffer.WriteString("\n\n")
	}
	fullContent := fullContentBuffer.String()
	log.Printf("Combined generated content parts into full content")

	// Truncate or expand the content to reach the target word count
	fullContent = adjustContentLength(fullContent, targetWordCount)
	log.Printf("Adjusted content length to reach target word count")

	// Generate the rest of the output content (title, slug, description, etc.)
	output := &OutputContent{
		Date:      time.Now(),
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	// Extract the title
	titlePrefix := "Title:"
	titleIndex := strings.Index(fullContent, titlePrefix)
	if titleIndex != -1 {
		titleEndIndex := strings.Index(fullContent[titleIndex:], "\n")
		if titleEndIndex != -1 {
			output.Title = strings.TrimSpace(fullContent[titleIndex+len(titlePrefix) : titleIndex+titleEndIndex])
			output.SEOTitle = output.Title
		}
	}
	log.Printf("Extracted title: %s", output.Title)

	// Extract the slug
	slugPrefix := "Slug:"
	slugIndex := strings.Index(fullContent, slugPrefix)
	if slugIndex != -1 {
		slugEndIndex := strings.Index(fullContent[slugIndex:], "\n")
		if slugEndIndex != -1 {
			output.Slug = strings.TrimSpace(fullContent[slugIndex+len(slugPrefix) : slugIndex+slugEndIndex])
		}
	}
	log.Printf("Extracted slug: %s", output.Slug)

	// Extract the description
	descriptionPrefix := "Meta Description:"
	descriptionIndex := strings.Index(fullContent, descriptionPrefix)
	if descriptionIndex != -1 {
		descriptionEndIndex := strings.Index(fullContent[descriptionIndex:], "\n")
		if descriptionEndIndex != -1 {
			output.Description = strings.TrimSpace(fullContent[descriptionIndex+len(descriptionPrefix) : descriptionIndex+descriptionEndIndex])
			output.SEODescription = output.Description
		}
	}
	log.Printf("Extracted description: %s", output.Description)

	// Extract the page type
	pageTypePrefix := "Determination:"
	pageTypeIndex := strings.Index(fullContent, pageTypePrefix)
	if pageTypeIndex != -1 {
		pageTypeEndIndex := strings.Index(fullContent[pageTypeIndex:], "\n")
		if pageTypeEndIndex != -1 {
			output.PageType = strings.TrimSpace(fullContent[pageTypeIndex+len(pageTypePrefix) : pageTypeIndex+pageTypeEndIndex])
		}
	}
	log.Printf("Extracted page type: %s", output.PageType)

	// Extract the keywords
	keywordsPrefix := "Keywords:"
	keywordsIndex := strings.Index(fullContent, keywordsPrefix)
	if keywordsIndex != -1 {
		keywordsEndIndex := strings.Index(fullContent[keywordsIndex:], "\n\n")
		if keywordsEndIndex != -1 {
			keywordsSection := fullContent[keywordsIndex+len(keywordsPrefix) : keywordsIndex+keywordsEndIndex]
			keywordsLines := strings.Split(keywordsSection, "\n")
			output.Keywords = make([]string, 0)
			for _, line := range keywordsLines {
				keyword := strings.TrimSpace(strings.TrimPrefix(line, "- "))
				if keyword != "" {
					output.Keywords = append(output.Keywords, keyword)
				}
			}
		}
	}
	log.Printf("Extracted keywords: %+v", output.Keywords)

	// Extract the content
	contentPrefix := "Expanded Content:"
	contentIndex := strings.Index(fullContent, contentPrefix)
	if contentIndex != -1 {
		output.Content = strings.TrimSpace(fullContent[contentIndex+len(contentPrefix):])
	}
	log.Printf("Extracted content: %s", output.Content)

	output.Author = "AI Generated (based on " + inputContent.Author + ")"
	output.ContentTypeID = 1 // Assuming 1 is for blog posts/documentation pages

	log.Printf("Generated Output: %+v", output)

	return output, nil
}

func writeJSONFile(content *OutputContent, filePath string) error {
	log.Printf("Writing JSON file: %s", filePath)
	jsonData, err := json.MarshalIndent(content, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filePath, jsonData, 0644)
}

func main() {
	// Create the output directory if it doesn't exist
	if err := os.MkdirAll(outputDir, os.ModePerm); err != nil {
		log.Fatalf("Error creating output directory: %v", err)
	}

	files, err := filepath.Glob(filepath.Join(inputDir, "*.json"))
	if err != nil {
		log.Fatal(err)
	}

	for _, filePath := range files {
		outputContent, err := generateContent(filePath)
		if err != nil {
			log.Printf("Error generating content for %s: %v", filePath, err)
			continue
		}

		outputFilePath := strings.TrimSuffix(filePath, filepath.Ext(filePath)) + ".json"
		err = writeOutputToFile(outputContent, outputFilePath)
		if err != nil {
			log.Printf("Error writing output to file for %s: %v", filePath, err)
			continue
		}
	}
}

func extractOutlineSections(outlineResponse string) []struct {
	Title       string
	Description string
} {
	var sections []struct {
		Title       string
		Description string
	}

	// Try parsing the response as an array first
	err := json.Unmarshal([]byte(outlineResponse), &sections)
	if err == nil {
		return sections
	}

	// If parsing as an array fails, try parsing as a single object
	var section struct {
		Title       string
		Description string
	}
	err = json.Unmarshal([]byte(outlineResponse), &section)
	if err == nil {
		sections = append(sections, section)
		return sections
	}

	// If both parsing attempts fail, return an empty slice
	log.Printf("Error parsing outline response: %v", err)
	return sections
}

func adjustContentLength(content string, targetWordCount int) string {
	words := strings.Fields(content)
	currentWordCount := len(words)

	if currentWordCount < targetWordCount {
		// Expand the content to reach the target word count
		for currentWordCount < targetWordCount {
			// Duplicate sentences or paragraphs to increase the word count
			content += " " + content
			words = strings.Fields(content)
			currentWordCount = len(words)
		}
	} else if currentWordCount > targetWordCount {
		// Truncate the content to reach the target word count
		truncatedWords := words[:targetWordCount]
		content = strings.Join(truncatedWords, " ")
	}

	return content
}

func writeOutputToFile(outputContent *OutputContent, filePath string) error {
	jsonData, err := json.MarshalIndent(outputContent, "", "  ")
	if err != nil {
		log.Printf("Error marshaling output content: %v", err)
		return err
	}

	err = ioutil.WriteFile(filePath, jsonData, 0644)
	if err != nil {
		log.Printf("Error writing output to file %s: %v", filePath, err)
		return err
	}

	log.Printf("Successfully wrote output to file: %s", filePath)
	return nil
}
