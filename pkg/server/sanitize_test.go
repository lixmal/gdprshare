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
		{"../../../etc/passwd", "../../../etc/passwd"},
		{"../../file.txt", "../../file.txt"},
		{"/etc/passwd", "/etc/passwd"},
		{"file\x00name.txt", "filename.txt"},
		{"file\nname.txt", "filename.txt"},
		{"file\r\nname.txt", "filename.txt"},
		{"file\x7fname.txt", "filename.txt"},
		{"file/name.txt", "file/name.txt"},
		{"file\\name.txt", "file\\name.txt"},
		{"   spaces.txt   ", "spaces.txt"},
		{"", ""},
		{"OM7hgMs3yGnGSpUjWq52Ny5Vk7XRTofieQD6yaLGf269o/HL6LYBalf2KDmJCm+ZrJnb46l6gRWfdZU=", "OM7hgMs3yGnGSpUjWq52Ny5Vk7XRTofieQD6yaLGf269o/HL6LYBalf2KDmJCm+ZrJnb46l6gRWfdZU="},
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
		{"file", "file"},
		{"text", "text"},
		{"image", "image"},
		{"FILE", "file"},
		{"Text", "text"},
		{"IMAGE", "image"},
		{"  file  ", "file"},
		{"invalid", "file"},
		{"text/plain", "file"},
		{"", "file"},
		{"application/json", "file"},
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
