package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io/ioutil"
	"log"
	"math/rand"
	"net/http"
	"strings"
	"time"
)

// Struct for BlogContent as read from the JSON file
type BlogContent struct {
    URL         string `json:"url"`
    PageType    string `json:"pageType"`
    SEOElements struct {
        Title           struct{ Content string } `json:"title"`
        MetaDescription struct{ Content string } `json:"metaDescription"`
        H1              struct{ Text string }     `json:"h1"`
    } `json:"seoElements"`
    Content struct {
        HTML string `json:"html"`
    } `json:"content"`
}

// Struct for structured output
type StructuredContent struct {
	ID             int64     `json:"id"`
	Title          string    `json:"title"`
	Content        string    `json:"content"`
	Slug           string    `json:"slug,omitempty"`
	Description    string    `json:"description,omitempty"`
	Author         string    `json:"author"`
	Date           time.Time `json:"date"`
	Image          string    `json:"image,omitempty"`
	Keywords       []string  `json:"keywords"`
	SEOTitle       string    `json:"seoTitle,omitempty"`
	SEODescription string    `json:"seoDescription,omitempty"`
	SEOImage       string    `json:"seoImage,omitempty"`
	CreatedAt      time.Time `json:"createdAt"`
	UpdatedAt      time.Time `json:"updatedAt"`
	ContentTypeID  int64     `json:"contentTypeId"`
	Sources        string    `json:"sources,omitempty"`
}

// Function to read the JSON file
func readJSONFile(filePath string) (*BlogContent, error) {
    log.Println("Reading JSON file:", filePath)
    file, err := ioutil.ReadFile(filePath)
    if err != nil {
        log.Println("Error reading file:", err)
        return nil, err
    }
    var content BlogContent
    if err := json.Unmarshal(file, &content); err != nil {
        log.Println("Error unmarshalling JSON:", err)
        return nil, err
    }
    log.Println("Successfully read and parsed JSON file")
    return &content, nil
}

func callOllamaAPI(prompt string, maxRetries int) (string, error) {
	url := "http://localhost:11434/api/generate"
	log.Println("Calling Ollama API with prompt:", prompt[:100]+"...") // Log first 100 chars of prompt

	requestBody := map[string]interface{}{
		"model":  "llama2",
		"prompt": prompt,
		"stream": false,
	}

	jsonBody, err := json.Marshal(requestBody)
	if err != nil {
		log.Println("Error marshalling request body:", err)
		return "", err
	}

	for attempt := 0; attempt < maxRetries; attempt++ {
		log.Printf("API call attempt %d of %d", attempt+1, maxRetries)
		req, err := http.NewRequest("POST", url, bytes.NewBuffer(jsonBody))
		if err != nil {
			log.Println("Error creating request:", err)
			return "", err
		}

		req.Header.Set("Content-Type", "application/json")

		client := &http.Client{Timeout: 0} // No timeout
		resp, err := client.Do(req)
		if err != nil {
			log.Printf("Attempt %d failed: %v. Retrying...", attempt+1, err)
			time.Sleep(time.Duration(rand.Intn(5)+1) * time.Second)
			continue
		}
		defer resp.Body.Close()

		log.Printf("Received response with status: %s", resp.Status)

		responseData, err := ioutil.ReadAll(resp.Body)
		if err != nil {
			log.Println("Error reading response body:", err)
			return "", err
		}

		log.Printf("Response body: %s", string(responseData)[:100]+"...") // Log first 100 chars of response

		var apiResponse struct {
			Response string `json:"response"`
		}
		err = json.Unmarshal(responseData, &apiResponse)
		if err != nil {
			log.Println("Error unmarshalling API response:", err)
			return "", err
		}

		if apiResponse.Response != "" {
			log.Println("Successfully received non-empty response from API")
			return apiResponse.Response, nil
		}

		log.Printf("Attempt %d: Empty response. Retrying...", attempt+1)
		time.Sleep(time.Duration(rand.Intn(5)+1) * time.Second)
	}

	log.Printf("Failed to get a valid response after %d attempts", maxRetries)
	return "", fmt.Errorf("failed to get a valid response after %d attempts", maxRetries)
}

func generateStructuredContent(topic string, originalContent string) (*StructuredContent, error) {
	log.Println("Generating structured content for topic:", topic)

	// Generate outline
	log.Println("Generating outline...")
	outlinePrompt := fmt.Sprintf(`Create a detailed outline for a comprehensive, 3000-word blog post about '%s'. 
	Include an introduction, 5-7 main sections with subsections, and a conclusion. 
	Format the outline with markdown headers. 
	Ensure the outline covers all important aspects of the topic and provides a logical flow of information.
	
	Original content for reference:
	%s
	
	Use this original content as a reference, but expand and improve upon it significantly.`, topic, originalContent[:500]+"...") // Log first 500 chars of original content
	
	outline, err := callOllamaAPI(outlinePrompt, 5)
	if err != nil {
		log.Println("Error generating outline:", err)
		return nil, err
	}
	log.Println("Successfully generated outline")

	// Generate content for each section
	log.Println("Generating content for each section...")
	fullContent := ""
	sections := strings.Split(outline, "\n#")
	for i, section := range sections {
		if strings.TrimSpace(section) == "" {
			continue
		}
		log.Printf("Generating content for section %d of %d", i+1, len(sections))
		sectionPrompt := fmt.Sprintf(`Expand on the following section of the blog post about '%s':

		%s

		Provide detailed, informative content for this section, maintaining a professional and engaging tone. 
		Use markdown formatting. Aim for about 500 words for this section.
		Include relevant examples, statistics, and expert opinions where appropriate.
		Ensure the content is well-researched, accurate, and provides value to the reader.
		
		Original content for reference:
		%s
		
		Use this original content as a reference, but expand and improve upon it significantly.`, topic, section, originalContent[:500]+"...")
		
		sectionContent, err := callOllamaAPI(sectionPrompt, 5)
		if err != nil {
			log.Printf("Error generating content for section %d: %v", i+1, err)
			return nil, err
		}
		fullContent += "# " + sectionContent + "\n\n"
		log.Printf("Successfully generated content for section %d", i+1)
	}

	// Generate SEO title, description, and keywords
	log.Println("Generating SEO elements...")
	seoPrompt := fmt.Sprintf(`For a blog post about '%s', create:
	1. An SEO-optimized title (max 60 characters)
	2. A meta description (max 160 characters)
	3. A list of 5-7 relevant keywords or key phrases

	Ensure these elements accurately represent the content and are optimized for search engines.`, topic)
	
	seoContent, err := callOllamaAPI(seoPrompt, 5)
	if err != nil {
		log.Println("Error generating SEO elements:", err)
		return nil, err
	}
	log.Println("Successfully generated SEO elements")

	seoLines := strings.Split(seoContent, "\n")
	seoTitle := seoLines[0]
	seoDescription := seoLines[1]
	keywords := strings.Split(strings.Join(seoLines[2:], ","), ",")

	now := time.Now()
	structuredContent := &StructuredContent{
		Title:          seoTitle,
		Content:        fullContent,
		Slug:           strings.ReplaceAll(strings.ToLower(seoTitle), " ", "-"),
		Description:    seoDescription,
		 Author:         "AI Generated",
		Date:           now,
		Keywords:       keywords,
		SEOTitle:       seoTitle,
		SEODescription: seoDescription,
		CreatedAt:      now,
		UpdatedAt:      now,
		ContentTypeID:  1,
		Sources:        "Generated from Ollama API",
	}

	log.Println("Successfully generated structured content")
	return structuredContent, nil
}

func writeJSONFile(content *StructuredContent, filePath string) error {
	log.Println("Writing structured content to JSON file:", filePath)
	jsonData, err := json.MarshalIndent(content, "", "  ")
	if err != nil {
		log.Println("Error marshalling content to JSON:", err)
		return err
	}
	err = ioutil.WriteFile(filePath, jsonData, 0644)
	if err != nil {
		log.Println("Error writing JSON file:", err)
		return err
	}
	log.Println("Successfully wrote JSON file")
	return nil
}

func main() {
	log.Println("Starting content generation process...")

	// Read the JSON file
	inputFile := "C:\\Users\\bcw19\\seo-scraper\\src\\www.semrush.com\\blog\\alt-text.json"
	blogContent, err := readJSONFile(inputFile)
	if err != nil {
		log.Fatalf("Error reading JSON file: %v", err)
	}

	// Extract the main topic and original content
	topic := blogContent.SEOElements.Title.Content
	originalContent := blogContent.Content.HTML
	log.Printf("Extracted topic: %s", topic)
	log.Printf("Original content length: %d characters", len(originalContent))

	// Generate structured content
	structuredContent, err := generateStructuredContent(topic, originalContent)
	if err != nil {
		log.Fatalf("Error generating content: %v", err)
	}

	// Write the structured content to a JSON file
	outputFile := "structured_content.json"
	if err := writeJSONFile(structuredContent, outputFile); err != nil {
		log.Fatalf("Error writing JSON file: %v", err)
	}

	log.Printf("Structured content written to %s\n", outputFile)
	log.Println("Content generation process completed successfully")
}
