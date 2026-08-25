package auth

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/lixmal/gdprshare/pkg/config"
	"github.com/lixmal/gdprshare/pkg/database"
)

func testStore(t *testing.T) *store {
	t.Helper()

	return &store{db: testDatabase(t)}
}

func TestASessionIsReadBackAsItWasOpened(t *testing.T) {
	s := testStore(t)

	id, err := s.open(Session{
		Subject: "cf7c2c1a",
		Email:   "someone@example.org",
		Groups:  []string{"staff", "everyone"},
	}, time.Hour)
	require.NoError(t, err)

	got, err := s.read(id, time.Now())
	require.NoError(t, err)
	assert.Equal(t, "cf7c2c1a", got.Subject)
	assert.Equal(t, "someone@example.org", got.Email)
	assert.Equal(t, []string{"staff", "everyone"}, got.Groups)
}

// TestAnIdThatNamesNoSessionIsNoSession is what replaces checking a signature:
// there is nothing to forge, only an id that is either in the table or not.
func TestAnIdThatNamesNoSessionIsNoSession(t *testing.T) {
	s := testStore(t)

	for _, id := range []string{"", "made-up", "0000000000000000000000000000000000000000000"} {
		_, err := s.read(id, time.Now())
		assert.ErrorIs(t, err, errNoSession, "id %q", id)
	}
}

func TestASessionEndsWhenItRunsOut(t *testing.T) {
	s := testStore(t)

	id, err := s.open(Session{Subject: "someone"}, time.Minute)
	require.NoError(t, err)

	_, err = s.read(id, time.Now())
	require.NoError(t, err)

	_, err = s.read(id, time.Now().Add(2*time.Minute))
	assert.ErrorIs(t, err, errExpired)

	// and it is gone, not merely ignored
	var left int
	require.NoError(t, s.db.Model(&database.Session{}).Count(&left).Error)
	assert.Equal(t, 0, left)
}

// TestClosingASessionEndsItAtOnce is the reason for keeping sessions here
// rather than in a cookie the server signs.
func TestClosingASessionEndsItAtOnce(t *testing.T) {
	s := testStore(t)

	id, err := s.open(Session{Subject: "someone"}, time.Hour)
	require.NoError(t, err)

	s.close(id)

	_, err = s.read(id, time.Now())
	assert.ErrorIs(t, err, errNoSession)
}

func TestSessionIdsAreUnguessable(t *testing.T) {
	s := testStore(t)

	seen := make(map[string]bool, 50)
	for i := 0; i < 50; i++ {
		id, err := s.open(Session{Subject: "someone"}, time.Hour)
		require.NoError(t, err)
		assert.False(t, seen[id], "an id came up twice")
		assert.GreaterOrEqual(t, len(id), 43, "an id is 32 bytes of randomness")
		seen[id] = true
	}
}

// TestALoginIsAnsweredOnce keeps a code from being replayed against the same
// login, and keeps a leftover login from being usable later.
func TestALoginIsAnsweredOnce(t *testing.T) {
	s := testStore(t)

	login, err := newPending("/uploaded", time.Minute)
	require.NoError(t, err)

	id, err := s.begin(login, time.Minute)
	require.NoError(t, err)

	got, err := s.claim(id, time.Now())
	require.NoError(t, err)
	assert.Equal(t, login.State, got.State)
	assert.Equal(t, login.Nonce, got.Nonce)
	assert.Equal(t, login.Verifier, got.Verifier)
	assert.Equal(t, "/uploaded", got.Return)

	// the second answer finds nothing
	_, err = s.claim(id, time.Now())
	assert.ErrorIs(t, err, errNoSession)
}

func TestAnAbandonedLoginExpires(t *testing.T) {
	s := testStore(t)

	login, err := newPending("/", time.Minute)
	require.NoError(t, err)

	id, err := s.begin(login, time.Minute)
	require.NoError(t, err)

	_, err = s.claim(id, time.Now().Add(2*time.Minute))
	assert.ErrorIs(t, err, errExpired)
}

func TestAllowedGroups(t *testing.T) {
	// nothing asked for means anyone the provider vouches for
	assert.True(t, allowed(nil, nil))
	assert.True(t, allowed([]string{"guest"}, nil))

	assert.True(t, allowed([]string{"guest", "staff"}, []string{"staff"}))
	assert.False(t, allowed([]string{"guest"}, []string{"staff"}))
	// and a visitor the provider says nothing about is not in a group
	assert.False(t, allowed(nil, []string{"staff"}))
}

// TestSafeReturnStaysOnThisServer keeps the login from being turned into a way
// of sending somebody somewhere else.
func TestSafeReturnStaysOnThisServer(t *testing.T) {
	assert.Equal(t, "/uploaded", safeReturn("/uploaded"))
	assert.Equal(t, "/d/abc?x=1", safeReturn("/d/abc?x=1"))

	assert.Equal(t, "/", safeReturn("https://elsewhere.example.org/"))
	assert.Equal(t, "/", safeReturn("//elsewhere.example.org/"))
	assert.Equal(t, "/", safeReturn("javascript:alert(1)"))
	assert.Equal(t, "/", safeReturn(""))
}

// TestSigningOutEndsTheSessionForTheWholeServer walks it through the handler,
// which is where it matters: the cookie the browser still holds is worthless.
func TestSigningOutEndsTheSessionForTheWholeServer(t *testing.T) {
	provider := newFakeProvider(t)
	db := testDatabase(t)
	guard := guardWith(t, provider, nil, db)
	router := routerFor(guard)

	session := signIn(t, router, provider, "/protected")

	first := httptest.NewRequest(http.MethodGet, "/protected", nil)
	first.AddCookie(session)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, first)
	require.Equal(t, http.StatusOK, w.Code)

	out := httptest.NewRequest(http.MethodPost, LogoutPath, nil)
	out.AddCookie(session)
	router.ServeHTTP(httptest.NewRecorder(), out)

	// the same cookie, offered again, is nobody
	again := httptest.NewRequest(http.MethodGet, "/protected", nil)
	again.AddCookie(session)
	after := httptest.NewRecorder()
	router.ServeHTTP(after, again)
	assert.Equal(t, http.StatusFound, after.Code, "a signed out cookie was still let through")
}

// TestAGroupTakenAwayEndsAccess is the other thing a store buys: the provider's
// answer is not frozen into a cookie for hours.
func TestAGroupTakenAwayEndsAccess(t *testing.T) {
	provider := newFakeProvider(t)
	provider.groups = []string{"staff"}
	db := testDatabase(t)
	guard := guardWith(t, provider, func(conf *config.Config) {
		conf.OIDC.AllowedGroups = []string{"staff"}
	}, db)
	router := routerFor(guard)

	session := signIn(t, router, provider, "/protected")

	req := httptest.NewRequest(http.MethodGet, "/protected", nil)
	req.AddCookie(session)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	require.Equal(t, http.StatusOK, w.Code)

	// the operator takes the group off the session
	require.NoError(t, db.Model(&database.Session{}).
		Where(&database.Session{SessionId: session.Value}).
		Update("groups", "guests").Error)

	again := httptest.NewRequest(http.MethodGet, "/protected", nil)
	again.AddCookie(session)
	after := httptest.NewRecorder()
	router.ServeHTTP(after, again)
	assert.Equal(t, http.StatusFound, after.Code, "a session without the group was still let through")
}
