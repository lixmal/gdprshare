package server

import (
	"regexp"
	"strings"
)

var (
	controlCharsRegex = regexp.MustCompile(`[\x00-\x1f\x7f-\x9f]`)
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

func sanitizeCountries(raw string) string {
	if raw == "" {
		return ""
	}
	var valid []string
	seen := make(map[string]bool)
	for _, code := range strings.Split(raw, ",") {
		code = strings.TrimSpace(strings.ToUpper(code))
		if len(code) == 2 && countries[code] != "" && !seen[code] {
			valid = append(valid, code)
			seen[code] = true
		}
	}
	return strings.Join(valid, ",")
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
