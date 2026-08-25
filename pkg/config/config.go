package config

import (
	"fmt"
	"os"
	"sort"
	"strings"
	"text/template"
	"time"

	"github.com/jinzhu/configor"
)

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
	SaveClientInfo bool `default:"false"`
	ShowCountdown  bool `default:"false"`
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
		Enabled        bool   `default:"true"`
		MinVersion     string `default:"1.2"`
		BlockedCiphers []string
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
	return &Config{}
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
		if err := c.validateOIDC(); err != nil {
			return err
		}
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

// CleanupInterval is how often expired files are swept, parsed from the config.
func (c *Config) CleanupInterval() (time.Duration, error) {
	interval, err := time.ParseDuration(c.Cleanup.Interval)
	if err != nil {
		return 0, fmt.Errorf("parse cleanup interval %q: %w", c.Cleanup.Interval, err)
	}

	return interval, nil
}
