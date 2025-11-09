package config

import (
	"fmt"
	"os"
	"text/template"

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
	SaveClientInfo       bool `default:"false"`
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
	_, err := template.New("mailbody").Parse(c.Mail.Body)
	return err
}
