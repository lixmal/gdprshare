package config

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// write puts a configuration on disk and loads it the way the server does.
func load(t *testing.T, body string) (*Config, error) {
	t.Helper()

	path := filepath.Join(t.TempDir(), "config.yml")
	require.NoError(t, os.WriteFile(path, []byte(body), 0o600))

	return New(path)
}

// The least an operator has to write to put a provider in front of the server.
const minimalOIDC = `
oidc:
    enabled:  true
    issuer:   'https://auth.example.org/realms/main'
    clientid: 'gdprshare'
    clientsecret: 'shh'
    redirecturl:  'https://share.example.org/auth/callback'
`

// TestOIDCDefaultsApplyToWhatIsLeftOut is the whole reason those defaults are
// written out in code: the `default` tags are honoured for fields at the top
// level of the configuration but not for the ones nested in a block, so a
// setting left out of this one arrives empty. It used to refuse to start.
func TestOIDCDefaultsApplyToWhatIsLeftOut(t *testing.T) {
	conf, err := load(t, minimalOIDC)
	require.NoError(t, err, "a configuration with only the required fields has to start")

	assert.Equal(t, DefaultProtect, conf.OIDC.Protect)
	assert.Equal(t, DefaultGroupsClaim, conf.OIDC.GroupsClaim)
	assert.Equal(t, DefaultSessionLifetime, conf.OIDC.SessionLifetime)
	assert.Equal(t, DefaultScopes, conf.OIDC.Scopes)

	lifetime, err := conf.SessionLifetime()
	require.NoError(t, err)
	assert.Equal(t, 12*time.Hour, lifetime)
}

func TestOIDCKeepsWhatWasWrittenDown(t *testing.T) {
	conf, err := load(t, minimalOIDC+`    protect: 'all'
    groupsclaim: 'roles'
    sessionlifetime: '30m'
    scopes: ['openid', 'groups']
`)
	require.NoError(t, err)

	assert.Equal(t, "all", conf.OIDC.Protect)
	assert.Equal(t, "roles", conf.OIDC.GroupsClaim)
	assert.Equal(t, []string{"openid", "groups"}, conf.OIDC.Scopes)

	lifetime, err := conf.SessionLifetime()
	require.NoError(t, err)
	assert.Equal(t, 30*time.Minute, lifetime)
}

// A lifetime is written by hand, so both spellings a person would use have to
// read the same.
func TestOIDCSessionLifetimeQuotedOrNot(t *testing.T) {
	for _, written := range []string{"'12h'", "12h", `"12h"`} {
		conf, err := load(t, minimalOIDC+"    sessionlifetime: "+written+"\n")
		require.NoError(t, err, "written as %s", written)

		lifetime, err := conf.SessionLifetime()
		require.NoError(t, err, "written as %s", written)
		assert.Equal(t, 12*time.Hour, lifetime, "written as %s", written)
	}
}

// A provider half configured would let everyone in or nobody, so it is refused
// before the server is listening.
func TestOIDCRefusesAHalfConfiguredProvider(t *testing.T) {
	_, err := load(t, `
oidc:
    enabled:  true
    issuer:   'https://auth.example.org/realms/main'
`)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "clientid")
	assert.Contains(t, err.Error(), "clientsecret")
	assert.Contains(t, err.Error(), "redirecturl")
}

func TestOIDCRefusesNonsense(t *testing.T) {
	_, err := load(t, minimalOIDC+"    protect: 'sometimes'\n")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "neither uploads nor all")

	_, err = load(t, minimalOIDC+"    sessionlifetime: 'a fortnight'\n")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "session lifetime")

	_, err = load(t, minimalOIDC+"    sessionlifetime: '30s'\n")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "below the one minute minimum")

	_, err = load(t, `
oidc:
    enabled:  true
    issuer:   'auth.example.org'
    clientid: 'gdprshare'
    clientsecret: 'shh'
    redirecturl:  'https://share.example.org/auth/callback'
`)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not an address")
}

// Nothing is asked of a server that was not given a provider.
func TestWithoutAProviderNothingIsRequired(t *testing.T) {
	conf, err := load(t, "idlength: 20\n")
	require.NoError(t, err)

	assert.False(t, conf.OIDC.Enabled)
}

// A key nobody knows is a typo worth stopping for, not a setting to ignore.
func TestAnUnknownKeyIsRefused(t *testing.T) {
	_, err := load(t, `
oidc:
    enabled:  true
    client_id: 'gdprshare'
`)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "client_id")
}
