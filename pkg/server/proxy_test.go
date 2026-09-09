package server

import (
	"crypto/tls"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/lixmal/gdprshare/pkg/config"
)

// requestFrom builds a request that arrived from peer and claims, in the
// headers a proxy would set, to be someone else on a good connection.
func requestFrom(peer, forwarded string) *http.Request {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/config", nil)
	req.RemoteAddr = peer

	if forwarded != "" {
		req.Header.Set("X-Forwarded-For", forwarded)
	}

	req.Header.Set("X-TLS-Version", strconv.Itoa(int(tls.VersionTLS13)))
	req.Header.Set("X-TLS-CipherSuite", strconv.Itoa(int(tls.TLS_AES_128_GCM_SHA256)))

	return req
}

// clientOf runs getClientInfo the way a handler would, so the test sees the
// address and the encryption the server settled on. The context is given the
// same trusted proxies as the server, since that is what decides whose
// X-Forwarded-For gin reads.
func clientOf(t *testing.T, srv *Server, req *http.Request) (addr, version string) {
	t.Helper()

	c, engine := gin.CreateTestContext(httptest.NewRecorder())
	require.NoError(t, engine.SetTrustedProxies(srv.proxies.Prefixes()))
	c.Request = req

	client := srv.getClientInfo(c)
	require.NotNil(t, client)

	return client.Addr, client.TLSVersion
}

// The header names carry a `default` tag that only a loaded config file gets,
// so a config put together in a test has to say what a deployment's would.
func proxyHeaders(conf *config.Config) {
	conf.Header.TLSVersion = "X-TLS-Version"
	conf.Header.TLSCipherSuite = "X-TLS-CipherSuite"
}

func TestUntrustedPeerCannotSpeakForSomeoneElse(t *testing.T) {
	srv, cleanup := newTestServer(t, ":memory:", func(conf *config.Config) {
		proxyHeaders(conf)
		conf.TrustedProxies = []string{"none"}
		conf.SaveClientInfo = true
	})
	defer cleanup()

	addr, version := clientOf(t, srv, requestFrom("198.51.100.9:4444", "1.2.3.4"))

	assert.Equal(t, "198.51.100.9", addr, "the address of the connection, not the one it asked for")
	assert.Empty(t, version, "a client cannot state the encryption of its own connection")
}

func TestTrustedProxySpeaksForTheClient(t *testing.T) {
	srv, cleanup := newTestServer(t, ":memory:", func(conf *config.Config) {
		proxyHeaders(conf)
		conf.TrustedProxies = []string{"198.51.100.9"}
		conf.SaveClientInfo = true
	})
	defer cleanup()

	addr, version := clientOf(t, srv, requestFrom("198.51.100.9:4444", "1.2.3.4"))

	assert.Equal(t, "1.2.3.4", addr)
	assert.Equal(t, strconv.Itoa(int(tls.VersionTLS13)), version)
}

// The setting an existing deployment has by leaving it out, kept working on
// purpose: it is wrong for anything reachable directly, and the server says so
// at startup rather than changing under an operator who has not read it yet.
func TestTrustingEveryoneStaysTheDefault(t *testing.T) {
	srv, cleanup := newTestServer(t, ":memory:", func(conf *config.Config) {
		proxyHeaders(conf)
		conf.SaveClientInfo = true
	})
	defer cleanup()

	require.True(t, srv.proxies.Everyone())

	addr, version := clientOf(t, srv, requestFrom("198.51.100.9:4444", "1.2.3.4"))

	assert.Equal(t, "1.2.3.4", addr)
	assert.Equal(t, strconv.Itoa(int(tls.VersionTLS13)), version)
}

// The rate limit is per client, and the client is whoever the trusted proxies
// say it is. Without them, one host cannot become many by asking.
func TestRateLimitIgnoresForwardedForFromAnUntrustedPeer(t *testing.T) {
	srv, cleanup := newTestServer(t, ":memory:", func(conf *config.Config) {
		proxyHeaders(conf)
		conf.TrustedProxies = []string{"none"}
		conf.RateLimit.Enabled = true
		conf.RateLimit.RPS = 1
		conf.RateLimit.Burst = 2
	})
	defer cleanup()

	var lastStatus int
	for i := 0; i < 8; i++ {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/config", nil)
		req.RemoteAddr = "198.51.100.9:4444"
		req.Header.Set("X-Forwarded-For", "10.0.0."+strconv.Itoa(i))

		w := httptest.NewRecorder()
		srv.Handler.ServeHTTP(w, req)
		lastStatus = w.Code
	}

	assert.Equal(t, http.StatusTooManyRequests, lastStatus, "a new address per request must not buy a new bucket")
}

func TestTLSValidationCanBeRequired(t *testing.T) {
	srv, cleanup := newTestServer(t, ":memory:", func(conf *config.Config) {
		conf.TLSValidation.Enabled = true
		conf.TLSValidation.MinVersion = "1.2"
		conf.TLSValidation.Required = true
	})
	defer cleanup()

	assert.Error(t, srv.validateTLS("", ""), "silence is not evidence of encryption")
	assert.NoError(t, srv.validateTLS(strconv.Itoa(int(tls.VersionTLS13)), ""))
}

// What every deployment that has not turned it on still gets.
func TestTLSValidationLetsSilenceThroughByDefault(t *testing.T) {
	srv, cleanup := newTestServer(t, ":memory:", func(conf *config.Config) {
		conf.TLSValidation.Enabled = true
		conf.TLSValidation.MinVersion = "1.2"
	})
	defer cleanup()

	assert.NoError(t, srv.validateTLS("", ""))
}
