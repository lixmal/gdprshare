package server

import (
	"crypto/tls"
	"strconv"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/lixmal/gdprshare/pkg/config"
	"github.com/lixmal/gdprshare/pkg/database"
)

func TestTLSVersionParsing(t *testing.T) {
	tests := []struct {
		input    string
		expected uint16
		hasError bool
	}{
		{"1.2", tls.VersionTLS12, false},
		{"1.3", tls.VersionTLS13, false},
		{"1.1", tls.VersionTLS11, false},
		{"1.0", tls.VersionTLS10, false},
		{strconv.Itoa(int(tls.VersionTLS12)), tls.VersionTLS12, false},
		{"", 0, true},
		{"invalid", 0, true},
	}

	for _, tt := range tests {
		result, err := parseTLSVersion(tt.input)
		if tt.hasError {
			assert.Error(t, err, "Input: %s", tt.input)
		} else {
			require.NoError(t, err, "Input: %s", tt.input)
			assert.Equal(t, tt.expected, result, "Input: %s", tt.input)
		}
	}
}

func TestTLSValidation(t *testing.T) {
	conf := config.Default()
	conf.TLSValidation.Enabled = true
	conf.TLSValidation.MinVersion = "1.2"
	conf.Database.Driver = "sqlite3"
	conf.Database.Args = ":memory:"

	db, err := database.New(conf)
	require.NoError(t, err)
	defer db.Close()

	srv := New(db, conf)

	err = srv.validateTLS(strconv.Itoa(int(tls.VersionTLS12)), "")
	assert.NoError(t, err, "TLS 1.2 should be allowed")

	err = srv.validateTLS(strconv.Itoa(int(tls.VersionTLS13)), "")
	assert.NoError(t, err, "TLS 1.3 should be allowed")

	err = srv.validateTLS(strconv.Itoa(int(tls.VersionTLS11)), "")
	assert.Error(t, err, "TLS 1.1 should be rejected")

	err = srv.validateTLS(strconv.Itoa(int(tls.VersionTLS10)), "")
	assert.Error(t, err, "TLS 1.0 should be rejected")
}

func TestWeakCipherRejection(t *testing.T) {
	conf := config.Default()
	conf.TLSValidation.Enabled = true
	conf.TLSValidation.MinVersion = "1.2"
	conf.Database.Driver = "sqlite3"
	conf.Database.Args = ":memory:"

	db, err := database.New(conf)
	require.NoError(t, err)
	defer db.Close()

	srv := New(db, conf)

	err = srv.validateTLS(
		strconv.Itoa(int(tls.VersionTLS12)),
		strconv.Itoa(int(tls.TLS_RSA_WITH_RC4_128_SHA)),
	)
	assert.Error(t, err, "RC4 cipher should be rejected")

	err = srv.validateTLS(
		strconv.Itoa(int(tls.VersionTLS12)),
		strconv.Itoa(int(tls.TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256)),
	)
	assert.NoError(t, err, "Strong cipher should be allowed")
}

func TestTLSValidationDisabled(t *testing.T) {
	conf := config.Default()
	conf.TLSValidation.Enabled = false
	conf.Database.Driver = "sqlite3"
	conf.Database.Args = ":memory:"

	db, err := database.New(conf)
	require.NoError(t, err)
	defer db.Close()

	srv := New(db, conf)

	err = srv.validateTLS(strconv.Itoa(int(tls.VersionTLS10)), "")
	assert.NoError(t, err, "TLS validation should be disabled")
}

func TestBlockedCipherFromConfig(t *testing.T) {
	conf := config.Default()
	conf.TLSValidation.Enabled = true
	conf.TLSValidation.MinVersion = "1.2"
	conf.TLSValidation.BlockedCiphers = []string{"0xc02f"}
	conf.Database.Driver = "sqlite3"
	conf.Database.Args = ":memory:"

	db, err := database.New(conf)
	require.NoError(t, err)
	defer db.Close()

	srv := New(db, conf)

	err = srv.validateTLS(
		strconv.Itoa(int(tls.VersionTLS12)),
		"0xc02f",
	)
	assert.Error(t, err, "Configured blocked cipher should be rejected")

	err = srv.validateTLS(
		strconv.Itoa(int(tls.VersionTLS12)),
		"0xc030",
	)
	assert.NoError(t, err, "Non-blocked cipher should be allowed")
}
