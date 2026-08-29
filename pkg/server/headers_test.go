package server

import (
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/lixmal/gdprshare/pkg/config"
)

// pageInRepo is the page the server hands out, from a test that runs in the
// package directory rather than at the root.
const pageInRepo = "../../" + IndexFile

func headersOf(t *testing.T, srv *Server) http.Header {
	t.Helper()

	req := httptest.NewRequest(http.MethodGet, "/api/v1/config", nil)
	w := httptest.NewRecorder()
	srv.Handler.ServeHTTP(w, req)

	return w.Header()
}

func TestSecurityHeadersAreSent(t *testing.T) {
	srv, cleanup := newTestServer(t, ":memory:")
	defer cleanup()

	header := headersOf(t, srv)

	assert.Equal(t, "nosniff", header.Get(headerNoSniff))
	assert.Equal(t, "same-origin", header.Get(headerReferrer))
	assert.Equal(t, "DENY", header.Get(headerFrames))
	assert.NotEmpty(t, header.Get(headerCSP))

	// promising https for a year is only for a server that knows it is on it
	assert.Empty(t, header.Get(headerHSTS))
}

func TestTransportSecurityFollowsTLS(t *testing.T) {
	srv, cleanup := newTestServer(t, ":memory:", func(conf *config.Config) {
		conf.TLS.Use = true
	})
	defer cleanup()

	assert.Equal(t, "max-age=31536000; includeSubDomains", headersOf(t, srv).Get(headerHSTS))
}

func TestSecurityHeadersCanBeTurnedOff(t *testing.T) {
	off := false
	srv, cleanup := newTestServer(t, ":memory:", func(conf *config.Config) {
		conf.SecurityHeaders.Enabled = &off
	})
	defer cleanup()

	header := headersOf(t, srv)

	assert.Empty(t, header.Get(headerNoSniff))
	assert.Empty(t, header.Get(headerCSP))
}

// Two policies on one response are both applied, so an operator whose proxy
// sends one turns this off and keeps the rest.
func TestPolicyCanBeTurnedOffOnItsOwn(t *testing.T) {
	off := false
	srv, cleanup := newTestServer(t, ":memory:", func(conf *config.Config) {
		conf.SecurityHeaders.CSP = &off
	})
	defer cleanup()

	header := headersOf(t, srv)

	assert.Empty(t, header.Get(headerCSP))
	assert.Equal(t, "nosniff", header.Get(headerNoSniff))
}

// The policy has to reach the bundle too: one that only covers the document
// leaves everything the page loads unprotected.
func TestThePolicyCoversTheStaticFiles(t *testing.T) {
	srv, cleanup := newTestServer(t, ":memory:")
	defer cleanup()

	req := httptest.NewRequest(http.MethodGet, "/assets/scripts/bundle.js", nil)
	w := httptest.NewRecorder()
	srv.Handler.ServeHTTP(w, req)

	assert.NotEmpty(t, w.Header().Get(headerCSP))
}

func TestThePolicyNamesWhatTheAppNeeds(t *testing.T) {
	srv, cleanup := newTestServer(t, ":memory:")
	defer cleanup()

	policy := headersOf(t, srv).Get(headerCSP)

	for _, directive := range []string{
		"default-src 'none'",
		"style-src 'self' 'unsafe-inline'",
		"img-src 'self' data: blob:",
		"font-src 'self'",
		"connect-src 'self' blob:",
		"frame-ancestors 'none'",
		"object-src 'none'",
		"base-uri 'none'",
	} {
		assert.Contains(t, policy, directive)
	}

	// scripts are the one thing that gets no blanket permission: the promise
	// this app makes is that the code doing the encrypting is the code that
	// was shipped
	scripts := ""
	for _, directive := range strings.Split(policy, "; ") {
		if strings.HasPrefix(directive, "script-src ") {
			scripts = directive
		}
	}

	require.NotEmpty(t, scripts)
	assert.Contains(t, scripts, "'self'")
	assert.NotContains(t, scripts, "'unsafe-inline'", "only styles are allowed inline")
	assert.NotContains(t, scripts, "'unsafe-eval'")
}

// The hashes only appear when the page can be read, which is from the directory
// the server actually runs in.
func TestThePolicySentCarriesTheHashesOfThePage(t *testing.T) {
	hashes := inlineScriptHashes(pageInRepo)
	require.NotEmpty(t, hashes)

	t.Chdir("../..")

	srv, cleanup := newTestServer(t, ":memory:")
	defer cleanup()

	policy := headersOf(t, srv).Get(headerCSP)
	for _, hash := range hashes {
		assert.Contains(t, policy, hash)
	}
}

// The page carries a script written into it, which a browser runs only when the
// policy names its hash. Read from the file that is served, so editing the page
// cannot leave the policy behind.
func TestTheInlineScriptOnThePageIsNamed(t *testing.T) {
	page, err := os.ReadFile(pageInRepo)
	require.NoError(t, err)

	matches := inlineScript.FindAllSubmatch(page, -1)
	require.NotEmpty(t, matches)

	named := 0
	for _, match := range matches {
		body := match[1]
		if strings.TrimSpace(string(body)) == "" {
			continue
		}

		sum := sha256.Sum256(body)
		hash := fmt.Sprintf("'sha256-%s'", base64.StdEncoding.EncodeToString(sum[:]))
		assert.Contains(t, inlineScriptHashes(pageInRepo), hash)
		named++
	}

	require.Positive(t, named, "the page is expected to carry a script the policy has to name")
}

// A script that is only loaded needs no hash, and one that is not there at all
// must not turn into a policy that names nothing and blocks the app.
func TestOnlyWrittenScriptsAreHashed(t *testing.T) {
	page := filepath.Join(t.TempDir(), "index.html")
	require.NoError(t, os.WriteFile(page, []byte(
		`<script src="/assets/scripts/bundle.js"></script><script>  </script><script>var a = 1</script>`,
	), 0o600))

	hashes := inlineScriptHashes(page)
	require.Len(t, hashes, 1)

	sum := sha256.Sum256([]byte("var a = 1"))
	assert.Equal(t, fmt.Sprintf("'sha256-%s'", base64.StdEncoding.EncodeToString(sum[:])), hashes[0])
}
