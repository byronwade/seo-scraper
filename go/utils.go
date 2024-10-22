// utils.go
package main

import (
	"fmt"
	"io/ioutil"
	"net/http"
	"regexp"
	"strings"
)

func downloadFile(url, filePath string) string {
	resp, err := http.Get(url)
	if err != nil {
		fmt.Printf("Error downloading %s: %v\n", url, err)
		return ""
	}
	defer resp.Body.Close()

	content, err := ioutil.ReadAll(resp.Body)
	if err != nil {
		fmt.Printf("Error reading content from %s: %v\n", url, err)
		return ""
	}

	if filePath != "" {
		err = ioutil.WriteFile(filePath, content, 0644)
		if err != nil {
			fmt.Printf("Error writing to file %s: %v\n", filePath, err)
		} else {
			fmt.Printf("Downloaded: %s\n", filePath)
		}
	}

	return string(content)
}

func unique(strings []string) []string {
	uniqueMap := make(map[string]struct{})
	for _, s := range strings {
		uniqueMap[s] = struct{}{}
	}
	var uniqueList []string
	for s := range uniqueMap {
		uniqueList = append(uniqueList, s)
	}
	return uniqueList
}

func slugify(s string) string {
	re := regexp.MustCompile(`[^a-z0-9]+`)
	return strings.Trim(re.ReplaceAllString(strings.ToLower(s), "-"), "-")
}

