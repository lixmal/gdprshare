package server

import (
	"fmt"
	"regexp"
	"strings"
)

// A user agent string says what it likes, and nothing forces it to be true. The
// short name is a reading aid for the download record, never a fact to act on:
// the raw string is kept next to it, which is what matters when a refused
// attempt has to be looked at closely.
//
// The order is what makes this work: Edge calls itself Chrome, Chrome calls
// itself Safari, and every crawler calls itself a browser, so the most specific
// match has to come first.
var userAgentNames = []struct {
	name    string
	pattern *regexp.Regexp
}{
	// crawlers and fetchers first: they wear browser names as camouflage
	{"Googlebot", regexp.MustCompile(`Googlebot|Google-InspectionTool`)},
	{"Bingbot", regexp.MustCompile(`bingbot|BingPreview`)},
	{"DuckDuckBot", regexp.MustCompile(`DuckDuckBot|DuckDuckGo`)},
	{"YandexBot", regexp.MustCompile(`YandexBot`)},
	{"Baiduspider", regexp.MustCompile(`Baiduspider`)},
	{"AhrefsBot", regexp.MustCompile(`AhrefsBot`)},
	{"SemrushBot", regexp.MustCompile(`SemrushBot`)},
	{"Applebot", regexp.MustCompile(`Applebot`)},
	{"Facebook", regexp.MustCompile(`facebookexternalhit|facebookcatalog`)},
	{"WhatsApp", regexp.MustCompile(`WhatsApp`)},
	{"Telegram", regexp.MustCompile(`TelegramBot`)},
	{"Slack", regexp.MustCompile(`Slackbot|Slack-ImgProxy`)},
	{"Discord", regexp.MustCompile(`Discordbot`)},
	{"Mastodon", regexp.MustCompile(`Mastodon`)},
	{"Twitterbot", regexp.MustCompile(`Twitterbot`)},
	{"LinkedIn", regexp.MustCompile(`LinkedInBot`)},
	{"Archiver", regexp.MustCompile(`ia_archiver|archive\.org_bot`)},
	{"Bot", regexp.MustCompile(`(?i)bot\b|crawler|spider|scrapy`)},

	// this project's own clients, which the system suffix names further
	{"GDPRShare", regexp.MustCompile(`^GDPRShare`)},

	// tools that fetch without a browser
	{"curl", regexp.MustCompile(`^curl/`)},
	{"wget", regexp.MustCompile(`^Wget/`)},
	{"Python", regexp.MustCompile(`python-requests|Python-urllib|aiohttp`)},
	{"Go", regexp.MustCompile(`^Go-http-client/`)},
	{"Java", regexp.MustCompile(`^Java/|okhttp`)},
	{"PowerShell", regexp.MustCompile(`WindowsPowerShell|PowerShell/`)},

	// browsers, most specific first
	{"Edge", regexp.MustCompile(`Edg[A-Z]?/`)},
	{"Opera", regexp.MustCompile(`OPR/|Opera`)},
	{"Vivaldi", regexp.MustCompile(`Vivaldi`)},
	{"Brave", regexp.MustCompile(`Brave`)},
	{"Samsung Internet", regexp.MustCompile(`SamsungBrowser`)},
	{"Firefox", regexp.MustCompile(`Firefox/|FxiOS/`)},
	{"Chrome", regexp.MustCompile(`Chrome/|CriOS/|Chromium/`)},
	{"Safari", regexp.MustCompile(`Safari/`)},
}

var userAgentSystems = []struct {
	name    string
	pattern *regexp.Regexp
}{
	{"Android", regexp.MustCompile(`Android`)},
	{"iOS", regexp.MustCompile(`iPhone|iPad|iPod`)},
	{"Windows", regexp.MustCompile(`Windows NT`)},
	{"macOS", regexp.MustCompile(`Mac OS X|Macintosh`)},
	{"Linux", regexp.MustCompile(`Linux|X11`)},
}

// the version that belongs to the matched name, when the string carries one
var userAgentVersions = map[string]*regexp.Regexp{
	"Edge":             regexp.MustCompile(`Edg[A-Z]?/(\d+)`),
	"Opera":            regexp.MustCompile(`OPR/(\d+)`),
	"Firefox":          regexp.MustCompile(`(?:Firefox|FxiOS)/(\d+)`),
	"Chrome":           regexp.MustCompile(`(?:Chrome|CriOS|Chromium)/(\d+)`),
	"Safari":           regexp.MustCompile(`Version/(\d+)`),
	"Samsung Internet": regexp.MustCompile(`SamsungBrowser/(\d+)`),
	"curl":             regexp.MustCompile(`^curl/([\d.]+)`),
	"wget":             regexp.MustCompile(`^Wget/([\d.]+)`),
	"Go":               regexp.MustCompile(`^Go-http-client/([\d.]+)`),
}

// userAgentName reads a stored user agent as a short label, empty when there is
// nothing to read or nothing recognisable in it.
func userAgentName(userAgent string) string {
	if userAgent == "" || userAgent == "none" {
		return ""
	}

	name := ""
	for _, candidate := range userAgentNames {
		if candidate.pattern.MatchString(userAgent) {
			name = candidate.name
			break
		}
	}

	if name == "" {
		return ""
	}

	if version := userAgentVersions[name]; version != nil {
		if match := version.FindStringSubmatch(userAgent); match != nil {
			name = fmt.Sprintf("%s %s", name, match[1])
		}
	}

	for _, system := range userAgentSystems {
		if system.pattern.MatchString(userAgent) {
			return fmt.Sprintf("%s on %s", name, system.name)
		}
	}

	return strings.TrimSpace(name)
}
