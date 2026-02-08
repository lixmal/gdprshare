package server

import (
	"regexp"
	"strings"
)

var (
	controlCharsRegex = regexp.MustCompile(`[\x00-\x1f\x7f-\x9f]`)
	pathTraversal     = regexp.MustCompile(`\.\.|/|\\`)
	validTypes        = map[string]bool{"file": true, "text": true, "image": true}
)

func sanitizeFilename(filename string) string {
	if filename == "" {
		return ""
	}

	// Remove control characters to prevent header injection.
	filename = controlCharsRegex.ReplaceAllString(filename, "")
	filename = strings.TrimSpace(filename)

	return filename
}

func sanitizeType(t string) string {
	t = strings.TrimSpace(strings.ToLower(t))
	if validTypes[t] {
		return t
	}
	return "file"
}

func sanitizeUserAgent(ua string) string {
	if ua == "" {
		return ""
	}

	ua = controlCharsRegex.ReplaceAllString(ua, "")
	ua = strings.TrimSpace(ua)

	if len(ua) > 512 {
		ua = ua[:512]
	}

	return ua
}
