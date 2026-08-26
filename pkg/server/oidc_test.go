package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/lixmal/gdprshare/pkg/auth"
	"github.com/lixmal/gdprshare/pkg/config"
)

// Which routes ask for a sign in is the whole point of the setting, so it is
// worth stating route by route rather than trusting the wiring.
var (
	senderRoutes = []struct {
		method string
		path   string
	}{
		{http.MethodGet, "/"},
		{http.MethodGet, "/uploaded"},
		{http.MethodGet, "/api/v1/countries"},
		{http.MethodPost, "/api/v1/files"},
		{http.MethodPost, "/api/v1/uploads"},
		{http.MethodPost, "/api/v1/uploads/someid"},
		{http.MethodPost, "/api/v1/uploads/someid/finish"},
		{http.MethodDelete, "/api/v1/files/someid"},
		{http.MethodPost, "/api/v1/files/someid/prolong"},
		{http.MethodPost, "/api/v1/files/someid/downloads"},
		{http.MethodPost, "/api/v1/files/validate"},
	}

	recipientRoutes = []struct {
		method string
		path   string
	}{
		{http.MethodGet, "/d/someid"},
		{http.MethodGet, "/api/v1/config"},
		{http.MethodGet, "/api/v1/files/someid"},
		{http.MethodHead, "/api/v1/files/someid"},
		{http.MethodPost, "/api/v1/files/someid"},
		{http.MethodPost, "/api/v1/stats"},
	}
)

func setupGuardedServer(t *testing.T, protect string) (*Server, func()) {
	t.Helper()

	return setupTestServerWith(t, func(conf *config.Config) {
		conf.OIDC.Enabled = true
		conf.OIDC.Issuer = "https://auth.example.org"
		conf.OIDC.ClientID = "gdprshare"
		conf.OIDC.ClientSecret = "shh"
		conf.OIDC.RedirectURL = "https://share.example.org" + auth.CallbackPath
		conf.OIDC.SessionLifetime = "12h"
		conf.OIDC.Protect = protect
		conf.RateLimit.Enabled = false
	})
}

func askedToSignIn(t *testing.T, srv *Server, method, path string) bool {
	t.Helper()

	w := httptest.NewRecorder()
	srv.Handler.ServeHTTP(w, httptest.NewRequest(method, path, nil))

	// a page is sent to the provider, anything else is told plainly
	return w.Code == http.StatusFound || w.Code == http.StatusUnauthorized
}

// TestProtectUploadsAsksOnlyTheSender covers the setting a server runs with by
// default: the person sending a file signs in, the person a link was sent to
// does not.
func TestProtectUploadsAsksOnlyTheSender(t *testing.T) {
	srv, cleanup := setupGuardedServer(t, "uploads")
	defer cleanup()

	for _, route := range senderRoutes {
		assert.True(t, askedToSignIn(t, srv, route.method, route.path),
			"%s %s let a stranger through", route.method, route.path)
	}

	for _, route := range recipientRoutes {
		assert.False(t, askedToSignIn(t, srv, route.method, route.path),
			"%s %s asked a recipient to sign in", route.method, route.path)
	}
}

// TestProtectAllAsksEveryone covers the other setting, where a link is only
// good for people this server knows.
func TestProtectAllAsksEveryone(t *testing.T) {
	srv, cleanup := setupGuardedServer(t, "all")
	defer cleanup()

	for _, route := range append(senderRoutes, recipientRoutes...) {
		assert.True(t, askedToSignIn(t, srv, route.method, route.path),
			"%s %s let a stranger through", route.method, route.path)
	}
}

// TestWithoutAProviderNobodyIsAsked keeps the door open where no provider is
// configured, which is what every existing setup expects.
func TestWithoutAProviderNobodyIsAsked(t *testing.T) {
	srv, cleanup := setupTestServer(t)
	defer cleanup()

	for _, route := range append(senderRoutes, recipientRoutes...) {
		assert.False(t, askedToSignIn(t, srv, route.method, route.path),
			"%s %s asked for a sign in with no provider configured", route.method, route.path)
	}
}

// TestASignedInSenderIsLetThrough proves the guard is a door and not a wall.
func TestASignedInSenderIsLetThrough(t *testing.T) {
	srv, cleanup := setupGuardedServer(t, "uploads")
	defer cleanup()

	t.Chdir("../..")

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.AddCookie(sessionCookie(t, srv, time.Hour))
	w := httptest.NewRecorder()
	srv.Handler.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

// TestAnExpiredSessionIsNoSession is the trade for keeping no session store:
// the lifetime in the cookie is what ends a session.
func TestAnExpiredSessionIsNoSession(t *testing.T) {
	srv, cleanup := setupGuardedServer(t, "uploads")
	defer cleanup()

	req := httptest.NewRequest(http.MethodGet, "/api/v1/countries", nil)
	req.AddCookie(sessionCookie(t, srv, -time.Minute))
	w := httptest.NewRecorder()
	srv.Handler.ServeHTTP(w, req)

	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

// TestASessionFromAnotherServerIsNoSession covers a cookie that was not opened
// here: with the sessions in a table there is nothing to forge, so an id from
// somewhere else simply names nothing.
func TestASessionFromAnotherServerIsNoSession(t *testing.T) {
	srv, cleanup := setupGuardedServer(t, "uploads")
	defer cleanup()

	other, otherCleanup := setupGuardedServer(t, "uploads")
	defer otherCleanup()

	req := httptest.NewRequest(http.MethodGet, "/api/v1/countries", nil)
	req.AddCookie(sessionCookie(t, other, time.Hour))
	w := httptest.NewRecorder()
	srv.Handler.ServeHTTP(w, req)

	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

// TestTheLoginPathsAreOpen keeps the sign in itself from needing a sign in.
func TestTheLoginPathsAreOpen(t *testing.T) {
	srv, cleanup := setupGuardedServer(t, "all")
	defer cleanup()

	// the provider is not reachable in a test, so this is as far as it gets:
	// what matters is that it is not turned away for want of a session
	w := httptest.NewRecorder()
	srv.Handler.ServeHTTP(w, httptest.NewRequest(http.MethodGet, auth.LoginPath, nil))
	assert.NotEqual(t, http.StatusNotFound, w.Code)

	logout := httptest.NewRecorder()
	srv.Handler.ServeHTTP(logout, httptest.NewRequest(http.MethodPost, auth.LogoutPath, nil))
	assert.Equal(t, http.StatusFound, logout.Code)
}

// TestTheBundleStaysOpen is what the download page is built from, so a
// recipient has to be able to fetch it whatever the setting.
func TestTheBundleStaysOpen(t *testing.T) {
	srv, cleanup := setupGuardedServer(t, "all")
	defer cleanup()

	t.Chdir("../..")

	w := httptest.NewRecorder()
	srv.Handler.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/assets/locales/en.json", nil))

	assert.Equal(t, http.StatusOK, w.Code)
}

// sessionCookie mints a cookie the way a finished login would.
func sessionCookie(t *testing.T, srv *Server, in time.Duration) *http.Cookie {
	t.Helper()

	require.NotNil(t, srv.guard, "the server has no provider configured")

	value, err := auth.OpenForTest(srv.guard, "cf7c2c1a", "someone@example.org", nil, in)
	require.NoError(t, err)

	return &http.Cookie{Name: auth.SessionCookie, Value: value}
}

// TestConfigSaysWhetherASignInIsNeeded lets a client know before it starts sending. An upload
// refused for want of a session is refused while the file is still on its way up, which whatever
// sits in front of the server may report as something else entirely.
func TestConfigSaysWhetherASignInIsNeeded(t *testing.T) {
	guarded, cleanup := setupGuardedServer(t, "uploads")
	defer cleanup()

	assert.True(t, signInRequired(t, guarded))

	open, openCleanup := setupTestServer(t)
	defer openCleanup()

	assert.False(t, signInRequired(t, open))
}

func signInRequired(t *testing.T, srv *Server) bool {
	t.Helper()

	w := httptest.NewRecorder()
	srv.Handler.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/config", nil))
	require.Equal(t, http.StatusOK, w.Code)

	var resp map[string]any
	require.NoError(t, json.NewDecoder(w.Body).Decode(&resp))

	required, ok := resp["signInRequired"].(bool)
	require.True(t, ok, "the config says nothing about signing in: %v", resp)

	return required
}
