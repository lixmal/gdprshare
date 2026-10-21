package server

import (
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"log"
	"os"
	"regexp"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
)

// The security policy matters most to this app: everything it promises rests on
// the bundle being the bundle that was shipped, and a policy that names one
// origin and a hash per inline script is what says so.
//
// Styles are the exception. The stylesheet is injected at runtime by the
// bundler and components set style attributes as they render, neither of which
// a hash can cover, so inline styles are allowed and scripts are not.
const (
	headerCSP      = "Content-Security-Policy"
	headerHSTS     = "Strict-Transport-Security"
	headerNoSniff  = "X-Content-Type-Options"
	headerFrames   = "X-Frame-Options"
	headerReferrer = "Referrer-Policy"
)

// inlineScript finds a script block with no src, which is one a policy has to
// name by hash for the browser to run it.
var inlineScript = regexp.MustCompile(`(?is)<script(?:\s[^>]*)?>(.*?)</script>`)

// securityHeaders states how the pages this server hands out may be used. It is
// added to every response, the static bundle included: a policy that only
// covers the document leaves the door open on everything else.
func (s *Server) securityHeaders() gin.HandlerFunc {
	policy := s.contentSecurityPolicy()

	// A share is a document someone was sent, so the address of the page is
	// worth as little to another site as this server can make it. Fragments
	// never travel in a referrer, but the file id does.
	referrer := "same-origin"

	var transport string
	if s.config.SendHSTS() {
		transport = "max-age=" + strconv.Itoa(s.config.SecurityHeaders.HSTSMaxAge) + "; includeSubDomains"
	}

	return func(c *gin.Context) {
		header := c.Writer.Header()
		header.Set(headerNoSniff, "nosniff")
		header.Set(headerReferrer, referrer)
		// frame-ancestors says the same thing to a browser that reads the
		// policy; this is for the ones that do not
		header.Set(headerFrames, "DENY")

		if policy != "" {
			header.Set(headerCSP, policy)
		}

		if transport != "" {
			header.Set(headerHSTS, transport)
		}

		c.Next()
	}
}

// contentSecurityPolicy builds the policy from what the app actually loads.
// Empty when the operator turned it off, in which case no policy is sent and a
// proxy's own is left to stand on its own.
func (s *Server) contentSecurityPolicy() string {
	if !*s.config.SecurityHeaders.CSP {
		return ""
	}

	scripts := append([]string{"'self'"}, inlineScriptHashes(IndexFile)...)

	return strings.Join([]string{
		"default-src 'none'",
		"script-src " + strings.Join(scripts, " "),
		"style-src 'self' 'unsafe-inline'",
		// data: for the icons the stylesheet carries, blob: for a decrypted
		// image shown on the page
		"img-src 'self' data: blob:",
		"font-src 'self'",
		// blob: is the decrypted file as the page itself is holding it, not
		// somewhere bytes could be sent
		"connect-src 'self' blob:",
		"base-uri 'none'",
		"form-action 'self'",
		"frame-ancestors 'none'",
		"object-src 'none'",
	}, "; ")
}

// inlineScriptHashes reads the page and hashes each script written into it, so
// the policy names them rather than allowing inline scripts as a class. Read at
// startup from the file that is served, so editing the page cannot leave the
// policy behind.
func inlineScriptHashes(path string) []string {
	page, err := os.ReadFile(path)
	if err != nil {
		// The page is what this server exists to hand out, so this is already
		// broken. Said plainly, since the symptom would otherwise be a blank
		// page and a console full of policy violations.
		log.Printf("Failed to read %s for the content security policy: %s\n", path, err)

		return nil
	}

	matches := inlineScript.FindAllSubmatch(page, -1)
	hashes := make([]string, 0, len(matches))

	for _, match := range matches {
		body := match[1]
		if len(strings.TrimSpace(string(body))) == 0 {
			continue
		}

		sum := sha256.Sum256(body)
		hashes = append(hashes, fmt.Sprintf("'sha256-%s'", base64.StdEncoding.EncodeToString(sum[:])))
	}

	return hashes
}
