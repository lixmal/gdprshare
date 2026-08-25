package auth

import (
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/lixmal/gdprshare/pkg/config"
	"github.com/lixmal/gdprshare/pkg/database"
)

const (
	// SessionCookie carries the signed session, PendingCookie the login that is
	// under way. Both are host only and unreadable to scripts.
	SessionCookie = "gdprshare_session"
	PendingCookie = "gdprshare_login"

	// LoginPath sends a visitor to the provider, CallbackPath is where the
	// provider sends them back, LogoutPath clears the session.
	LoginPath    = "/auth/login"
	CallbackPath = "/auth/callback"
	LogoutPath   = "/auth/logout"

	// A login has to be finished in this long, which is generous for typing a
	// password and short enough that a stale redirect is not worth replaying.
	pendingLifetime = 15 * time.Minute

	// where a session ends up in the request, for a handler that wants to know
	// who it is talking to
	contextKey = "gdprshare_session"

	// what a refusal is called, the same code the rest of the api uses so the
	// client can read it in the visitor's own language
	codeNotSignedIn = "not_signed_in"
)

// Guard answers the question every protected request asks: is this visitor
// allowed here.
type Guard struct {
	provider *Provider
	config   *config.Config
	sessions *store
	lifetime time.Duration
	secure   bool
}

func NewGuard(conf *config.Config, db *database.Database) (*Guard, error) {
	lifetime, err := conf.SessionLifetime()
	if err != nil {
		return nil, err
	}

	// A cookie may only be marked secure when the address it belongs to is
	// https, or a browser will drop it and nobody can sign in at all.
	secure := strings.HasPrefix(strings.ToLower(conf.OIDC.RedirectURL), "https://")

	return &Guard{
		provider: NewProvider(
			conf.OIDC.Issuer,
			conf.OIDC.ClientID,
			conf.OIDC.ClientSecret,
			conf.OIDC.RedirectURL,
			conf.OIDC.Scopes,
		),
		config:   conf,
		sessions: &store{db: db},
		lifetime: lifetime,
		secure:   secure,
	}, nil
}

// Register puts the three paths a login needs on the router. They are never
// protected themselves, or signing in would require being signed in.
func (g *Guard) Register(router gin.IRoutes) {
	router.GET(LoginPath, g.login)
	router.GET(CallbackPath, g.callback)
	router.POST(LogoutPath, g.logout)
	router.GET(LogoutPath, g.logout)
}

// SessionOf reports who a request came from, when it came through the guard.
func SessionOf(c *gin.Context) (Session, bool) {
	value, found := c.Get(contextKey)
	if !found {
		return Session{}, false
	}

	session, ok := value.(Session)

	return session, ok
}

// Require refuses a request that carries no valid session. A page redirects to
// the provider, since a person can be asked to sign in; anything else is
// answered plainly, since a script cannot.
func (g *Guard) Require(page bool) gin.HandlerFunc {
	return func(c *gin.Context) {
		session, err := g.sessions.read(cookieValue(c, SessionCookie), time.Now())
		if err == nil && allowed(session.Groups, g.config.OIDC.AllowedGroups) {
			c.Set(contextKey, session)
			c.Next()

			return
		}

		if !page {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"code":    codeNotSignedIn,
				"message": "sign in to use this server",
			})

			return
		}

		g.startLogin(c, c.Request.URL.RequestURI())
	}
}

// login is the door a visitor knocks on themselves, rather than being sent to.
func (g *Guard) login(c *gin.Context) {
	g.startLogin(c, safeReturn(c.Query("return")))
}

func (g *Guard) startLogin(c *gin.Context, returnTo string) {
	c.Abort()

	login, err := newPending(safeReturn(returnTo), pendingLifetime)
	if err != nil {
		log.Printf("Failed to start a login: %s\n", err)
		g.refuse(c, "the login could not be started")

		return
	}

	address, err := g.provider.authorizationURL(c.Request.Context(), login)
	if err != nil {
		log.Printf("Failed to reach the provider: %s\n", err)
		g.refuse(c, "the provider could not be reached")

		return
	}

	id, err := g.sessions.begin(login, pendingLifetime)
	if err != nil {
		log.Printf("Failed to remember a login: %s\n", err)
		g.refuse(c, "the login could not be started")

		return
	}

	g.setCookie(c, PendingCookie, id, int(pendingLifetime.Seconds()))
	c.Redirect(http.StatusFound, address)
}

// callback is where the provider sends the visitor back with a code.
func (g *Guard) callback(c *gin.Context) {
	// the login is spent either way: it is answered once
	login, err := g.sessions.claim(cookieValue(c, PendingCookie), time.Now())
	g.clearCookie(c, PendingCookie)

	if err != nil {
		log.Printf("Refused a callback without a login under way: %s\n", err)
		g.refuse(c, "this login is no longer under way, please start again")

		return
	}

	if failure := c.Query("error"); failure != "" {
		log.Printf("The provider refused a login: %s\n", failure)
		g.refuse(c, "the provider refused the login")

		return
	}

	// The state has to be the one this server sent, or the code belongs to
	// somebody else's login.
	if !equal(c.Query("state"), login.State) {
		log.Printf("Refused a callback with a state that was not ours\n")
		g.refuse(c, "this login does not match, please start again")

		return
	}

	code := c.Query("code")
	if code == "" {
		g.refuse(c, "the provider sent no code")

		return
	}

	session, err := g.provider.exchange(c.Request.Context(), code, login, g.config.OIDC.GroupsClaim)
	if err != nil {
		log.Printf("Failed to finish a login: %s\n", err)
		g.refuse(c, "the login could not be finished")

		return
	}

	if !allowed(session.Groups, g.config.OIDC.AllowedGroups) {
		log.Printf("Refused %s: not in an allowed group\n", session.Subject)
		g.refuseWith(c, http.StatusForbidden, "this account is not allowed on this server")

		return
	}

	id, err := g.sessions.open(session, g.lifetime)
	if err != nil {
		log.Printf("Failed to open a session: %s\n", err)
		g.refuse(c, "the login could not be finished")

		return
	}

	g.setCookie(c, SessionCookie, id, int(g.lifetime.Seconds()))
	c.Redirect(http.StatusFound, login.Return)
}

func (g *Guard) logout(c *gin.Context) {
	// really ended, not merely forgotten by the browser
	g.sessions.close(cookieValue(c, SessionCookie))
	g.clearCookie(c, SessionCookie)
	g.clearCookie(c, PendingCookie)
	c.Redirect(http.StatusFound, "/")
}

func (g *Guard) refuse(c *gin.Context, message string) {
	g.refuseWith(c, http.StatusUnauthorized, message)
}

func (g *Guard) refuseWith(c *gin.Context, status int, message string) {
	c.Abort()
	c.JSON(status, gin.H{"code": codeNotSignedIn, "message": message})
}

func (g *Guard) setCookie(c *gin.Context, name, value string, seconds int) {
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(name, value, seconds, "/", "", g.secure, true)
}

func (g *Guard) clearCookie(c *gin.Context, name string) {
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(name, "", -1, "/", "", g.secure, true)
}

func cookieValue(c *gin.Context, name string) string {
	value, err := c.Cookie(name)
	if err != nil {
		return ""
	}

	return value
}

// safeReturn keeps a login from being turned into a way of sending someone
// somewhere else: only a path on this server is ever returned to.
func safeReturn(returnTo string) string {
	if returnTo == "" || !strings.HasPrefix(returnTo, "/") || strings.HasPrefix(returnTo, "//") {
		return "/"
	}

	if _, err := url.Parse(returnTo); err != nil {
		return "/"
	}

	return returnTo
}
