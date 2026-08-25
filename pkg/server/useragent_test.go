package server

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

// TestUserAgentName reads the common cases the download record has to make
// sense of, including the ones that wear another name.
func TestUserAgentName(t *testing.T) {
	tests := []struct {
		userAgent string
		want      string
	}{
		{
			"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
			"Chrome 141 on Linux",
		},
		{
			// Edge says Chrome, and Chrome says Safari
			"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0",
			"Edge 141 on Windows",
		},
		{"Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0", "Firefox 121 on Linux"},
		{
			"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
			"Safari 17 on iOS",
		},
		{"curl/8.5.0", "curl 8.5.0"},
		{"Go-http-client/2.0", "Go 2.0"},
		{
			"Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
			"Googlebot",
		},
		{"Mozilla/5.0 (compatible; SomeUnknownBot/1.0)", "Bot"},
		// nothing to read, and nothing invented
		{"", ""},
		{"none", ""},
		{"a string that names nothing", ""},
	}

	for _, tt := range tests {
		assert.Equal(t, tt.want, userAgentName(tt.userAgent), tt.userAgent)
	}
}
