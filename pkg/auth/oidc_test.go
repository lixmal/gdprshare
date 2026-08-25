package auth

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/lixmal/gdprshare/pkg/config"
	"github.com/lixmal/gdprshare/pkg/database"
)

// A provider that behaves, so the parts that talk to one can be exercised. Its
// tokens are unsigned on purpose: the code flow takes them straight from the
// token endpoint over TLS, which is the case where OpenID Connect allows that.
type fakeProvider struct {
	server   *httptest.Server
	audience string
	nonce    string
	groups   any
	email    string
	subject  string
	issuer   string
	expires  int64
	// what the last token request carried, so the exchange can be checked
	form url.Values
	fail bool
}

func newFakeProvider(t *testing.T) *fakeProvider {
	t.Helper()

	p := &fakeProvider{audience: "gdprshare", subject: "cf7c2c1a", email: "someone@example.org"}

	mux := http.NewServeMux()
	mux.HandleFunc("/.well-known/openid-configuration", func(w http.ResponseWriter, r *http.Request) {
		issuer := p.issuer
		if issuer == "" {
			issuer = p.server.URL
		}
		_ = json.NewEncoder(w).Encode(map[string]string{
			"issuer":                 issuer,
			"authorization_endpoint": p.server.URL + "/authorize",
			"token_endpoint":         p.server.URL + "/token",
		})
	})
	mux.HandleFunc("/token", func(w http.ResponseWriter, r *http.Request) {
		if p.fail {
			w.WriteHeader(http.StatusBadRequest)
			return
		}

		require.NoError(t, r.ParseForm())
		p.form = r.PostForm

		expires := p.expires
		if expires == 0 {
			expires = time.Now().Add(time.Minute).Unix()
		}
		issuer := p.issuer
		if issuer == "" {
			issuer = p.server.URL
		}

		claims := map[string]any{
			"iss":   issuer,
			"sub":   p.subject,
			"aud":   p.audience,
			"exp":   expires,
			"nonce": p.nonce,
			"email": p.email,
		}
		if p.groups != nil {
			claims["groups"] = p.groups
		}

		_ = json.NewEncoder(w).Encode(map[string]string{"id_token": unsignedToken(t, claims)})
	})

	p.server = httptest.NewServer(mux)
	t.Cleanup(p.server.Close)

	return p
}

func unsignedToken(t *testing.T, claims map[string]any) string {
	t.Helper()

	payload, err := json.Marshal(claims)
	require.NoError(t, err)

	head := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"RS256","typ":"JWT"}`))

	return head + "." + base64.RawURLEncoding.EncodeToString(payload) + ".signature"
}

func guardFor(t *testing.T, p *fakeProvider, adjust func(*config.Config)) *Guard {
	t.Helper()

	return guardWith(t, p, adjust, testDatabase(t))
}

// testDatabase is where sessions live, in memory for the length of one test.
func testDatabase(t *testing.T) *database.Database {
	t.Helper()

	conf := config.Default()
	conf.Database.Driver = "sqlite3"
	conf.Database.Args = ":memory:"

	db, err := database.New(conf)
	require.NoError(t, err)
	t.Cleanup(func() { db.Close() })

	return db
}

func guardWith(t *testing.T, p *fakeProvider, adjust func(*config.Config), db *database.Database) *Guard {
	t.Helper()

	conf := config.Default()
	conf.OIDC.Enabled = true
	conf.OIDC.Issuer = p.server.URL
	conf.OIDC.ClientID = "gdprshare"
	conf.OIDC.ClientSecret = "shh"
	conf.OIDC.RedirectURL = "http://share.example.org" + CallbackPath
	conf.OIDC.SessionLifetime = "12h"
	conf.OIDC.GroupsClaim = "groups"
	conf.OIDC.Protect = "uploads"
	if adjust != nil {
		adjust(conf)
	}

	guard, err := NewGuard(conf, db)
	require.NoError(t, err)

	return guard
}

// routerFor wires the three login paths plus one page behind the guard.
func routerFor(guard *Guard) *gin.Engine {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	guard.Register(router)
	router.GET("/protected", guard.Require(true), func(c *gin.Context) {
		session, _ := SessionOf(c)
		c.String(http.StatusOK, "hello %s", session.Subject)
	})
	router.GET("/api", guard.Require(false), func(c *gin.Context) {
		c.String(http.StatusOK, "data")
	})

	return router
}

// signIn walks the whole flow the way a browser would and returns the session
// cookie it ends up with.
func signIn(t *testing.T, router *gin.Engine, p *fakeProvider, from string) *http.Cookie {
	t.Helper()

	first := httptest.NewRecorder()
	router.ServeHTTP(first, httptest.NewRequest(http.MethodGet, from, nil))
	require.Equal(t, http.StatusFound, first.Code, first.Body.String())

	sent, err := url.Parse(first.Header().Get("Location"))
	require.NoError(t, err)

	// the provider is asked for a code, and told where to send the visitor back
	assert.Equal(t, "code", sent.Query().Get("response_type"))
	assert.Equal(t, "S256", sent.Query().Get("code_challenge_method"))
	assert.NotEmpty(t, sent.Query().Get("state"))
	p.nonce = sent.Query().Get("nonce")

	login := loginCookie(t, first)

	back := httptest.NewRequest(http.MethodGet,
		CallbackPath+"?code=the-code&state="+url.QueryEscape(sent.Query().Get("state")), nil)
	back.AddCookie(login)

	second := httptest.NewRecorder()
	router.ServeHTTP(second, back)
	require.Equal(t, http.StatusFound, second.Code, second.Body.String())

	for _, cookie := range second.Result().Cookies() {
		if cookie.Name == SessionCookie && cookie.Value != "" {
			return cookie
		}
	}

	t.Fatalf("no session cookie was set: %s", second.Body.String())

	return nil
}

func loginCookie(t *testing.T, w *httptest.ResponseRecorder) *http.Cookie {
	t.Helper()

	for _, cookie := range w.Result().Cookies() {
		if cookie.Name == PendingCookie && cookie.Value != "" {
			return cookie
		}
	}

	t.Fatal("no login cookie was set")

	return nil
}

func TestSignInLetsAVisitorThrough(t *testing.T) {
	provider := newFakeProvider(t)
	guard := guardFor(t, provider, nil)
	router := routerFor(guard)

	session := signIn(t, router, provider, "/protected")

	// the verifier was sent to the token endpoint, not to the browser
	assert.NotEmpty(t, provider.form.Get("code_verifier"))
	assert.Equal(t, "authorization_code", provider.form.Get("grant_type"))

	req := httptest.NewRequest(http.MethodGet, "/protected", nil)
	req.AddCookie(session)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, "hello cf7c2c1a", w.Body.String())

	// the cookie is kept from scripts and sent along with a normal navigation
	assert.True(t, session.HttpOnly)
	assert.Equal(t, http.SameSiteLaxMode, session.SameSite)
}

// The provider is shown a hash; the verifier itself only ever goes to the token
// endpoint. That is what keeps an authorization code picked out of a redirect
// from being traded in by anyone else.
func TestTheChallengeMatchesTheVerifier(t *testing.T) {
	provider := newFakeProvider(t)
	guard := guardFor(t, provider, nil)
	router := routerFor(guard)

	first := httptest.NewRecorder()
	router.ServeHTTP(first, httptest.NewRequest(http.MethodGet, "/protected", nil))
	sent, err := url.Parse(first.Header().Get("Location"))
	require.NoError(t, err)

	challenge := sent.Query().Get("code_challenge")
	require.NotEmpty(t, challenge)

	provider.nonce = sent.Query().Get("nonce")
	login := loginCookie(t, first)

	back := httptest.NewRequest(http.MethodGet,
		CallbackPath+"?code=c&state="+url.QueryEscape(sent.Query().Get("state")), nil)
	back.AddCookie(login)
	router.ServeHTTP(httptest.NewRecorder(), back)

	verifier := provider.form.Get("code_verifier")
	require.NotEmpty(t, verifier)
	// the redirect never carried the verifier itself
	assert.NotContains(t, first.Header().Get("Location"), verifier)

	sum := sha256.Sum256([]byte(verifier))
	assert.Equal(t, base64.RawURLEncoding.EncodeToString(sum[:]), challenge)
}

func TestAPageAsksTheVisitorToSignIn(t *testing.T) {
	provider := newFakeProvider(t)
	router := routerFor(guardFor(t, provider, nil))

	w := httptest.NewRecorder()
	router.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/protected", nil))

	require.Equal(t, http.StatusFound, w.Code)
	assert.Contains(t, w.Header().Get("Location"), provider.server.URL+"/authorize")
}

// A script cannot be asked to sign in, so it is told plainly.
func TestAnApiAnswersUnauthorized(t *testing.T) {
	provider := newFakeProvider(t)
	router := routerFor(guardFor(t, provider, nil))

	w := httptest.NewRecorder()
	router.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api", nil))

	assert.Equal(t, http.StatusUnauthorized, w.Code)
	assert.Contains(t, w.Body.String(), "not_signed_in")
}

func TestCallbackRefusesAStateThatWasNotOurs(t *testing.T) {
	provider := newFakeProvider(t)
	router := routerFor(guardFor(t, provider, nil))

	first := httptest.NewRecorder()
	router.ServeHTTP(first, httptest.NewRequest(http.MethodGet, "/protected", nil))
	login := loginCookie(t, first)

	back := httptest.NewRequest(http.MethodGet, CallbackPath+"?code=the-code&state=somebody-elses", nil)
	back.AddCookie(login)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, back)

	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestCallbackRefusesWithoutALoginUnderWay(t *testing.T) {
	provider := newFakeProvider(t)
	router := routerFor(guardFor(t, provider, nil))

	w := httptest.NewRecorder()
	router.ServeHTTP(w, httptest.NewRequest(http.MethodGet, CallbackPath+"?code=c&state=s", nil))

	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

// The nonce is what ties the token to this login: a token minted for another
// one must not be accepted here.
func TestCallbackRefusesATokenForAnotherLogin(t *testing.T) {
	provider := newFakeProvider(t)
	guard := guardFor(t, provider, nil)
	router := routerFor(guard)

	first := httptest.NewRecorder()
	router.ServeHTTP(first, httptest.NewRequest(http.MethodGet, "/protected", nil))
	sent, err := url.Parse(first.Header().Get("Location"))
	require.NoError(t, err)
	login := loginCookie(t, first)

	provider.nonce = "a nonce from somewhere else"

	back := httptest.NewRequest(http.MethodGet,
		CallbackPath+"?code=the-code&state="+url.QueryEscape(sent.Query().Get("state")), nil)
	back.AddCookie(login)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, back)

	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestCallbackRefusesATokenForAnotherAudience(t *testing.T) {
	provider := newFakeProvider(t)
	provider.audience = "some-other-client"
	router := routerFor(guardFor(t, provider, nil))

	first := httptest.NewRecorder()
	router.ServeHTTP(first, httptest.NewRequest(http.MethodGet, "/protected", nil))
	sent, _ := url.Parse(first.Header().Get("Location"))
	provider.nonce = sent.Query().Get("nonce")
	login := loginCookie(t, first)

	back := httptest.NewRequest(http.MethodGet,
		CallbackPath+"?code=c&state="+url.QueryEscape(sent.Query().Get("state")), nil)
	back.AddCookie(login)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, back)

	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestCallbackRefusesAnExpiredToken(t *testing.T) {
	provider := newFakeProvider(t)
	provider.expires = time.Now().Add(-time.Hour).Unix()
	router := routerFor(guardFor(t, provider, nil))

	first := httptest.NewRecorder()
	router.ServeHTTP(first, httptest.NewRequest(http.MethodGet, "/protected", nil))
	sent, _ := url.Parse(first.Header().Get("Location"))
	provider.nonce = sent.Query().Get("nonce")
	login := loginCookie(t, first)

	back := httptest.NewRequest(http.MethodGet,
		CallbackPath+"?code=c&state="+url.QueryEscape(sent.Query().Get("state")), nil)
	back.AddCookie(login)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, back)

	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

// A provider that describes itself as somebody else is not the one configured.
func TestDiscoveryRefusesAnIssuerMismatch(t *testing.T) {
	provider := newFakeProvider(t)
	provider.issuer = "https://somebody.else.example.org"
	router := routerFor(guardFor(t, provider, nil))

	w := httptest.NewRecorder()
	router.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/protected", nil))

	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

// A provider that cannot be reached means nobody gets in, rather than everybody.
func TestAnUnreachableProviderLetsNobodyIn(t *testing.T) {
	provider := newFakeProvider(t)
	guard := guardFor(t, provider, nil)
	provider.server.Close()

	router := routerFor(guard)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/protected", nil))

	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestGroupsDecideWhoIsLetIn(t *testing.T) {
	provider := newFakeProvider(t)
	provider.groups = []string{"guests"}
	guard := guardFor(t, provider, func(conf *config.Config) {
		conf.OIDC.AllowedGroups = []string{"staff"}
	})
	router := routerFor(guard)

	first := httptest.NewRecorder()
	router.ServeHTTP(first, httptest.NewRequest(http.MethodGet, "/protected", nil))
	sent, _ := url.Parse(first.Header().Get("Location"))
	provider.nonce = sent.Query().Get("nonce")
	login := loginCookie(t, first)

	back := httptest.NewRequest(http.MethodGet,
		CallbackPath+"?code=c&state="+url.QueryEscape(sent.Query().Get("state")), nil)
	back.AddCookie(login)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, back)

	assert.Equal(t, http.StatusForbidden, w.Code)

	// and the same visitor in the right group is let through
	provider.groups = []string{"staff", "guests"}
	session := signIn(t, router, provider, "/protected")

	req := httptest.NewRequest(http.MethodGet, "/protected", nil)
	req.AddCookie(session)
	through := httptest.NewRecorder()
	router.ServeHTTP(through, req)
	assert.Equal(t, http.StatusOK, through.Code)
}

// A single group name is as valid as a list of them.
func TestASingleGroupClaimIsRead(t *testing.T) {
	provider := newFakeProvider(t)
	provider.groups = "staff"
	guard := guardFor(t, provider, func(conf *config.Config) {
		conf.OIDC.AllowedGroups = []string{"staff"}
	})

	session := signIn(t, routerFor(guard), provider, "/protected")
	assert.NotEmpty(t, session.Value)
}

func TestLogoutClearsTheSession(t *testing.T) {
	provider := newFakeProvider(t)
	guard := guardFor(t, provider, nil)
	router := routerFor(guard)

	session := signIn(t, router, provider, "/protected")

	req := httptest.NewRequest(http.MethodPost, LogoutPath, nil)
	req.AddCookie(session)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	require.Equal(t, http.StatusFound, w.Code)

	var cleared bool
	for _, cookie := range w.Result().Cookies() {
		if cookie.Name == SessionCookie && cookie.MaxAge < 0 {
			cleared = true
		}
	}
	assert.True(t, cleared, "the session cookie was not cleared")
}

// The visitor comes back where they were headed, and only ever to this server.
func TestSignInReturnsWhereTheVisitorWasHeaded(t *testing.T) {
	provider := newFakeProvider(t)
	router := routerFor(guardFor(t, provider, nil))

	first := httptest.NewRecorder()
	router.ServeHTTP(first, httptest.NewRequest(http.MethodGet, "/protected?keep=this", nil))
	sent, _ := url.Parse(first.Header().Get("Location"))
	provider.nonce = sent.Query().Get("nonce")
	login := loginCookie(t, first)

	back := httptest.NewRequest(http.MethodGet,
		CallbackPath+"?code=c&state="+url.QueryEscape(sent.Query().Get("state")), nil)
	back.AddCookie(login)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, back)

	require.Equal(t, http.StatusFound, w.Code)
	assert.Equal(t, "/protected?keep=this", w.Header().Get("Location"))
}

func TestTheProviderRefusingIsNotALogin(t *testing.T) {
	provider := newFakeProvider(t)
	router := routerFor(guardFor(t, provider, nil))

	first := httptest.NewRecorder()
	router.ServeHTTP(first, httptest.NewRequest(http.MethodGet, "/protected", nil))
	login := loginCookie(t, first)

	back := httptest.NewRequest(http.MethodGet, CallbackPath+"?error=access_denied", nil)
	back.AddCookie(login)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, back)

	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestTokenEndpointFailureIsNotALogin(t *testing.T) {
	provider := newFakeProvider(t)
	provider.fail = true
	router := routerFor(guardFor(t, provider, nil))

	first := httptest.NewRecorder()
	router.ServeHTTP(first, httptest.NewRequest(http.MethodGet, "/protected", nil))
	sent, _ := url.Parse(first.Header().Get("Location"))
	login := loginCookie(t, first)

	back := httptest.NewRequest(http.MethodGet,
		CallbackPath+"?code=c&state="+url.QueryEscape(sent.Query().Get("state")), nil)
	back.AddCookie(login)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, back)

	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestCookiesAreOnlySecureOverHttps(t *testing.T) {
	provider := newFakeProvider(t)

	plain := guardFor(t, provider, nil)
	assert.False(t, plain.secure, "a cookie marked secure over http would never come back")

	https := guardFor(t, provider, func(conf *config.Config) {
		conf.OIDC.RedirectURL = "https://share.example.org" + CallbackPath
	})
	assert.True(t, https.secure)
}

func TestDiscoveryIsReadOnce(t *testing.T) {
	provider := newFakeProvider(t)
	guard := guardFor(t, provider, nil)

	login, err := newPending("/", time.Minute)
	require.NoError(t, err)

	first, err := guard.provider.authorizationURL(context.Background(), login)
	require.NoError(t, err)

	provider.server.Close()

	// the description is kept, so a provider that goes away mid session does
	// not stop a login that is already under way from being built
	second, err := guard.provider.authorizationURL(context.Background(), login)
	require.NoError(t, err)
	assert.Equal(t, strings.Split(first, "?")[0], strings.Split(second, "?")[0])
}

func TestAudienceAcceptsAListOrAName(t *testing.T) {
	assert.True(t, audienceIncludes(json.RawMessage(`"gdprshare"`), "gdprshare"))
	assert.True(t, audienceIncludes(json.RawMessage(`["other","gdprshare"]`), "gdprshare"))
	assert.False(t, audienceIncludes(json.RawMessage(`"other"`), "gdprshare"))
	assert.False(t, audienceIncludes(json.RawMessage(`[]`), "gdprshare"))
	assert.False(t, audienceIncludes(nil, "gdprshare"))
	assert.False(t, audienceIncludes(json.RawMessage(fmt.Sprintf("%d", 5)), "gdprshare"))
}
