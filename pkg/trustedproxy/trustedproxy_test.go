package trustedproxy

import (
	"net/netip"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParseWords(t *testing.T) {
	all, err := Parse([]string{"all"})
	require.NoError(t, err)
	assert.True(t, all.Everyone())
	assert.False(t, all.Empty())
	assert.True(t, all.Contains(netip.MustParseAddr("198.51.100.7")))
	assert.True(t, all.Contains(netip.MustParseAddr("2001:db8::1")))

	none, err := Parse([]string{"NONE"})
	require.NoError(t, err)
	assert.True(t, none.Empty())
	assert.False(t, none.Everyone())
	assert.False(t, none.Contains(netip.MustParseAddr("198.51.100.7")))

	// nothing configured is nobody, and the caller decides what to make of it
	empty, err := Parse(nil)
	require.NoError(t, err)
	assert.True(t, empty.Empty())

	_, err = Parse([]string{"all", "10.0.0.1"})
	assert.Error(t, err, "a word next to an address says two different things")
}

func TestParseAddresses(t *testing.T) {
	list, err := Parse([]string{" 10.0.0.0/8 ", "192.0.2.4", "2001:db8::/32", "::1"})
	require.NoError(t, err)

	for _, trusted := range []string{"10.1.2.3", "192.0.2.4", "2001:db8::99", "::1"} {
		assert.True(t, list.Contains(netip.MustParseAddr(trusted)), trusted)
	}

	for _, untrusted := range []string{"11.1.2.3", "192.0.2.5", "2001:db9::1", "::2"} {
		assert.False(t, list.Contains(netip.MustParseAddr(untrusted)), untrusted)
	}
}

// A v4 address arriving on a dual stack listener is handed over mapped, and is
// the same address as the one the operator wrote down.
func TestMappedAndZonedAddresses(t *testing.T) {
	list, err := Parse([]string{"192.0.2.4", "fe80::1"})
	require.NoError(t, err)

	assert.True(t, list.Contains(netip.MustParseAddr("::ffff:192.0.2.4")))
	assert.True(t, list.IsTrusted("[::ffff:192.0.2.4]:4443"))
	assert.True(t, list.Contains(netip.MustParseAddr("fe80::1%eth0")))
}

func TestParseRejectsNonsense(t *testing.T) {
	for _, entry := range []string{"not-an-address", "10.0.0.0/64", "10.0.0.0/-1", "example.org"} {
		_, err := Parse([]string{entry})
		assert.Error(t, err, entry)
	}

	// host bits below the prefix length mean the entry does not say what it
	// looks like, so it is refused rather than masked behind the operator's back
	_, err := Parse([]string{"10.1.2.3/8"})
	assert.Error(t, err)
}

func TestIsTrustedReadsTheAddressOfThePeer(t *testing.T) {
	list, err := Parse([]string{"192.0.2.4", "2001:db8::1"})
	require.NoError(t, err)

	assert.True(t, list.IsTrusted("192.0.2.4:51234"))
	assert.True(t, list.IsTrusted("192.0.2.4"))
	assert.True(t, list.IsTrusted("[2001:db8::1]:443"))
	assert.False(t, list.IsTrusted("192.0.2.5:51234"))

	// an address that cannot be read is not trusted: a header is believed only
	// when the sender is known
	assert.False(t, list.IsTrusted(""))
	assert.False(t, list.IsTrusted("garbage"))
	assert.False(t, list.IsTrusted("2001:db8::1:443"), "a v6 address needs brackets to carry a port")
}

func TestPrefixesForGin(t *testing.T) {
	none, err := Parse([]string{"none"})
	require.NoError(t, err)
	assert.Nil(t, none.Prefixes(), "nil is how gin is told to read no forwarding headers")

	all, err := Parse([]string{"all"})
	require.NoError(t, err)
	assert.Equal(t, []string{"0.0.0.0/0", "::/0"}, all.Prefixes())

	one, err := Parse([]string{"192.0.2.4"})
	require.NoError(t, err)
	assert.Equal(t, []string{"192.0.2.4/32"}, one.Prefixes())
}

func TestZeroValueTrustsNobody(t *testing.T) {
	var list *List

	assert.True(t, list.Empty())
	assert.False(t, list.Everyone())
	assert.False(t, list.Contains(netip.MustParseAddr("192.0.2.4")))
	assert.False(t, list.IsTrusted("192.0.2.4:443"))
	assert.Nil(t, list.Prefixes())
}
