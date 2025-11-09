package server

import (
	"path/filepath"
	"regexp"
	"strings"
	"unicode"
)

var (
	controlCharsRegex = regexp.MustCompile(`[\x00-\x1f\x7f-\x9f]`)
	mimeTypeRegex     = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9!#$&\-\^_+.]{0,126}/[a-zA-Z0-9][a-zA-Z0-9!#$&\-\^_+.]{0,126}$`)
	pathTraversal     = regexp.MustCompile(`\.\.|/|\\`)
)

func sanitizeFilename(filename string) string {
	if filename == "" {
		return ""
	}

	filename = filepath.Base(filename)
	filename = controlCharsRegex.ReplaceAllString(filename, "")
	filename = strings.TrimSpace(filename)

	var filtered strings.Builder
	for _, r := range filename {
		if unicode.IsPrint(r) && r != '/' && r != '\\' {
			filtered.WriteRune(r)
		}
	}

	result := filtered.String()
	if len(result) > 255 {
		result = result[:255]
	}

	return result
}

func sanitizeType(mimeType string) string {
	if mimeType == "" {
		return ""
	}

	mimeType = strings.TrimSpace(mimeType)
	mimeType = strings.ToLower(mimeType)

	if before, _, found := strings.Cut(mimeType, ";"); found {
		mimeType = strings.TrimSpace(before)
	}

	if !mimeTypeRegex.MatchString(mimeType) {
		return ""
	}

	return mimeType
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
