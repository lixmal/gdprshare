package config

import (
	"fmt"
	"os"
	"sort"
	"strings"
	"text/template"
	"time"

	"github.com/jinzhu/configor"

	"github.com/lixmal/gdprshare/pkg/trustedproxy"
)

// What the OIDC block falls back to for anything an operator leaves out. The
// example config states the same values.
const (
	DefaultProtect         = "uploads"
	DefaultGroupsClaim     = "groups"
	DefaultSessionLifetime = "12h"

	// DefaultHSTSMaxAge is a year, which is what a browser preload list asks
	// for and long enough to be worth sending at all.
	DefaultHSTSMaxAge = 31536000
)

// DefaultScopes is what is asked of the provider when the config names nothing.
var DefaultScopes = []string{"openid", "email", "profile"}

// DefaultTrustedProxies keeps a configuration written before this setting
// existed working the way it did: every client is believed.
var DefaultTrustedProxies = []string{trustedproxy.All}

type Config struct {
	MaxUploadSize int64  `default:"25"` // MiB
	IDLength      int    `default:"20"`
	StorePath     string `default:"files"`
	ListenAddr    string `default:":8080"`
	TLS           struct {
		Use  bool   `default:"false"`
		Key  string `default:"/etc/ssl/private/ssl-cert-snakeoil.key"`
		Cert string `default:"/etc/ssl/certs/ssl-cert-snakeoil.pem"`
	}
	Database struct {
		Driver string `default:"sqlite3"`
		Args   string `default:"gdprshare.db"`
	}
	Mail struct {
		SmtpHost       string `default:"localhost"`
		SmtpPort       uint16 `default:"25"`
		SmtpUser       string
		SmtpPass       string
		From           string `default:"root@localhost"`
		Subject        string `default:"File has been accessed: %s"`
		SubjectReceipt string `default:"File download confirmed: %s"`
		Body           string `default:"File download with id {{.FileID}} has been attempted. {{.Denied}}"`
		DeniedMsg      string `default:"Download was denied."`
	}
	Header struct {
		TLSVersion     string `default:"X-TLS-Version"`
		TLSCipherSuite string `default:"X-TLS-CipherSuite"`
	}
	// Deleting expired files from inside the server, so a container does not
	// need a cron job next to it. The -cleanup flag stays for setups that
	// would rather drive it from outside.
	Cleanup struct {
		Enabled  bool   `default:"true"`
		Interval string `default:"1h"`
	}
	// Who may set X-Forwarded-For and the TLS headers above. "all" believes
	// any client, which is what this server has always done; "none" believes
	// nobody and reads the address the connection came from. Otherwise a list
	// of proxy addresses or CIDR prefixes.
	TrustedProxies []string `default:"[all]"`
	SaveClientInfo bool     `default:"false"`
	ShowCountdown  bool     `default:"false"`
	// Operator pages the footer links to, left out of the footer when empty.
	PrivacyURL           string
	ImprintURL           string
	GeoIPPath            string
	DisallowedUserAgents []string
	RateLimit            struct {
		Enabled bool    `default:"true"`
		RPS     float64 `default:"10"`
		Burst   int     `default:"20"`
	}
	TLSValidation struct {
		Enabled    bool   `default:"true"`
		MinVersion string `default:"1.2"`
		// When set, a request that says nothing about its encryption is
		// refused rather than let through. Off by default, since a server that
		// is not behind a proxy setting the headers would otherwise refuse
		// every request.
		Required       bool
		BlockedCiphers []string
	}
	// What the server states about how its pages may be used. A `default` tag
	// is not honoured this deep in the configuration, so these are pointers:
	// left out is not the same as turned off, and ApplySecurityHeaderDefaults
	// fills them in.
	SecurityHeaders struct {
		// Everything below, off in one go for a deployment whose proxy sets
		// its own.
		Enabled *bool
		// The content security policy. Two policies on one response are both
		// applied, so an operator whose proxy sends one turns this off rather
		// than fighting it.
		CSP *bool
		// Strict-Transport-Security. Left out, it follows whether this server
		// terminates TLS itself; a proxy that terminates it should send the
		// header, but an operator can turn it on here instead.
		HSTS *bool
		// How long a browser is asked to remember that, in seconds.
		HSTSMaxAge int
	}
	// Who may use this server, established against an OpenID Connect provider.
	// Recipients of a share are not asked to sign in unless Protect says so:
	// they are the people a link was sent to, not users of the server.
	OIDC struct {
		Enabled      bool
		Issuer       string
		ClientID     string
		ClientSecret string
		// Where the provider sends the visitor back to, which has to be this
		// server's own address plus the callback path.
		RedirectURL string
		Scopes      []string `default:"[openid,email,profile]"`
		// "uploads" asks only the sender to sign in, "all" asks everyone,
		// recipients included.
		Protect string `default:"uploads"`
		// When set, the claim has to carry one of these for the visitor to be
		// let in. Empty means anyone the provider vouches for.
		AllowedGroups []string
		GroupsClaim   string `default:"groups"`
		// How long a visitor stays signed in. A session lives in the database,
		// so it survives a restart and ends the moment it is signed out.
		SessionLifetime string `default:"12h"`
	}
}

// Default returns a Config instance with default values.
func Default() *Config {
	conf := &Config{}
	conf.ApplyDefaults()

	return conf
}

// New loads and validates a configuration from the specified file path.
func New(path string) (*Config, error) {
	if _, err := os.Stat(path); err != nil {
		return nil, fmt.Errorf("open config file: %w", err)
	}

	var conf Config
	if err := configor.New(&configor.Config{ErrorOnUnmatchedKeys: true}).Load(&conf, path); err != nil {
		return nil, fmt.Errorf("parsing config file %s: %w", path, err)
	}

	if err := conf.validate(); err != nil {
		return nil, fmt.Errorf("validation: %w", err)
	}

	return &conf, nil
}

func (c *Config) validate() error {
	// try parsing the mail body template
	if _, err := template.New("mailbody").Parse(c.Mail.Body); err != nil {
		return err
	}

	if c.OIDC.Enabled {
		c.applyOIDCDefaults()

		if err := c.validateOIDC(); err != nil {
			return err
		}
	}

	c.ApplyDefaults()

	if _, err := c.TrustedProxyList(); err != nil {
		return err
	}

	if c.Cleanup.Enabled {
		interval, err := c.CleanupInterval()
		if err != nil {
			return err
		}
		if interval < time.Minute {
			return fmt.Errorf("cleanup interval %s is below the one minute minimum", interval)
		}
	}

	return nil
}

// The `default` tags are only honoured for fields at the top level of the
// configuration, not for the ones nested in a block like this, so a setting left
// out arrives as an empty string rather than as what the example config says it
// would be. These are the ones an operator is entitled to leave out.
func (c *Config) applyOIDCDefaults() {
	if c.OIDC.Protect == "" {
		c.OIDC.Protect = DefaultProtect
	}

	if c.OIDC.GroupsClaim == "" {
		c.OIDC.GroupsClaim = DefaultGroupsClaim
	}

	if c.OIDC.SessionLifetime == "" {
		c.OIDC.SessionLifetime = DefaultSessionLifetime
	}

	if len(c.OIDC.Scopes) == 0 {
		c.OIDC.Scopes = append([]string(nil), DefaultScopes...)
	}
}

// A half configured provider would let everyone in or nobody, so the server
// refuses to start on one.
func (c *Config) validateOIDC() error {
	missing := make([]string, 0, 4)
	for name, value := range map[string]string{
		"issuer":       c.OIDC.Issuer,
		"clientid":     c.OIDC.ClientID,
		"clientsecret": c.OIDC.ClientSecret,
		"redirecturl":  c.OIDC.RedirectURL,
	} {
		if strings.TrimSpace(value) == "" {
			missing = append(missing, name)
		}
	}
	if len(missing) > 0 {
		sort.Strings(missing)
		return fmt.Errorf("oidc is enabled but %s %s not set", strings.Join(missing, ", "), plural(len(missing)))
	}

	if !strings.HasPrefix(c.OIDC.Issuer, "https://") && !strings.HasPrefix(c.OIDC.Issuer, "http://") {
		return fmt.Errorf("oidc issuer %q is not an address", c.OIDC.Issuer)
	}

	if c.OIDC.Protect != "uploads" && c.OIDC.Protect != "all" {
		return fmt.Errorf("oidc protect %q is neither uploads nor all", c.OIDC.Protect)
	}

	lifetime, err := c.SessionLifetime()
	if err != nil {
		return err
	}
	if lifetime < time.Minute {
		return fmt.Errorf("oidc session lifetime %s is below the one minute minimum", lifetime)
	}

	return nil
}

func plural(count int) string {
	if count == 1 {
		return "is"
	}

	return "are"
}

// SessionLifetime is how long a visitor stays signed in, parsed from the config.
func (c *Config) SessionLifetime() (time.Duration, error) {
	lifetime, err := time.ParseDuration(c.OIDC.SessionLifetime)
	if err != nil {
		return 0, fmt.Errorf("parse oidc session lifetime %q: %w", c.OIDC.SessionLifetime, err)
	}

	return lifetime, nil
}

// ApplyDefaults fills in the settings whose default a `default` tag cannot
// carry, either because the setting is nested or because leaving it out has to
// mean something other than the zero value. Doing nothing on a second call, so
// it can be reached from more than one direction.
func (c *Config) ApplyDefaults() {
	if len(c.TrustedProxies) == 0 {
		c.TrustedProxies = append([]string(nil), DefaultTrustedProxies...)
	}

	c.applySecurityHeaderDefaults()
}

// applySecurityHeaderDefaults fills in what an operator left out. A
// configuration written before these settings existed gets the headers, which
// only adds to what a response says; the policy that could conflict with a
// proxy's own is the one an operator turns off.
func (c *Config) applySecurityHeaderDefaults() {
	if c.SecurityHeaders.Enabled == nil {
		c.SecurityHeaders.Enabled = boolPtr(true)
	}

	if c.SecurityHeaders.CSP == nil {
		c.SecurityHeaders.CSP = boolPtr(true)
	}

	// HSTS is deliberately left as it is: nil means it follows the TLS setting,
	// which is read when the header is sent rather than fixed here.

	if c.SecurityHeaders.HSTSMaxAge <= 0 {
		c.SecurityHeaders.HSTSMaxAge = DefaultHSTSMaxAge
	}
}

func boolPtr(value bool) *bool {
	return &value
}

// SendHSTS reports whether to promise https for the next year. A browser
// ignores the header over plain http, but a server that does not terminate TLS
// itself cannot tell what the proxy in front did, so it is not guessed at:
// left out, the header goes only where this server holds the certificate.
func (c *Config) SendHSTS() bool {
	if c.SecurityHeaders.HSTS == nil {
		return c.TLS.Use
	}

	return *c.SecurityHeaders.HSTS
}

// TrustedProxyList is who may set the forwarding and TLS headers, parsed from
// the config.
func (c *Config) TrustedProxyList() (*trustedproxy.List, error) {
	list, err := trustedproxy.Parse(c.TrustedProxies)
	if err != nil {
		return nil, fmt.Errorf("parse trustedproxies: %w", err)
	}

	return list, nil
}

// CleanupInterval is how often expired files are swept, parsed from the config.
func (c *Config) CleanupInterval() (time.Duration, error) {
	interval, err := time.ParseDuration(c.Cleanup.Interval)
	if err != nil {
		return 0, fmt.Errorf("parse cleanup interval %q: %w", c.Cleanup.Interval, err)
	}

	return interval, nil
}
