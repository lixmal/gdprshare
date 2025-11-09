package server

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestSanitizeFilename(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"test.txt", "test.txt"},
		{"../../../etc/passwd", "passwd"},
		{"../../file.txt", "file.txt"},
		{"/etc/passwd", "passwd"},
		{"file\x00name.txt", "filename.txt"},
		{"file\nname.txt", "filename.txt"},
		{"file\r\nname.txt", "filename.txt"},
		{"file\x7fname.txt", "filename.txt"},
		{"file/name.txt", "name.txt"},
		{"file\\name.txt", "filename.txt"},
		{"   spaces.txt   ", "spaces.txt"},
		{"", ""},
		{string(make([]byte, 300)), ""},
	}

	for _, tt := range tests {
		result := sanitizeFilename(tt.input)
		assert.Equal(t, tt.expected, result, "Input: %q", tt.input)
	}
}

func TestSanitizeType(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"text/plain", "text/plain"},
		{"application/json", "application/json"},
		{"image/png", "image/png"},
		{"TEXT/PLAIN", "text/plain"},
		{"text/plain; charset=utf-8", "text/plain"},
		{"text/plain ; charset=utf-8", "text/plain"},
		{"invalid", ""},
		{"text/", ""},
		{"/plain", ""},
		{"text//plain", ""},
		{"text\x00/plain", ""},
		{"", ""},
		{"application/vnd.ms-excel", "application/vnd.ms-excel"},
		{"application/x-custom+json", "application/x-custom+json"},
	}

	for _, tt := range tests {
		result := sanitizeType(tt.input)
		assert.Equal(t, tt.expected, result, "Input: %q", tt.input)
	}
}

func TestSanitizeUserAgent(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"Mozilla/5.0", "Mozilla/5.0"},
		{"Mozilla/5.0\x00evil", "Mozilla/5.0evil"},
		{"Mozilla\n5.0", "Mozilla5.0"},
		{"Mozilla\r\n5.0", "Mozilla5.0"},
		{"   Mozilla/5.0   ", "Mozilla/5.0"},
		{"", ""},
	}

	for _, tt := range tests {
		result := sanitizeUserAgent(tt.input)
		assert.Equal(t, tt.expected, result, "Input: %q", tt.input)
	}

	longUA := make([]byte, 1000)
	for i := range longUA {
		longUA[i] = 'A'
	}
	result := sanitizeUserAgent(string(longUA))
	assert.Equal(t, 512, len(result), "Long user agent should be truncated to 512")
}
