// Package trustedproxy answers which addresses may speak for someone else.
//
// A header like X-Forwarded-For is only worth reading when the connection it
// arrived on came from a proxy this server was told about. Believed from any
// client, it lets a request pick its own rate limit bucket, its own country and
// its own TLS evidence, none of which the server can then tell apart from the
// real thing.
package trustedproxy

import (
	"fmt"
	"net/netip"
	"strings"
)

// Everyone and nobody, spelled out in the configuration so an operator does not
// have to write a prefix that covers both families to say what they mean.
const (
	All  = "all"
	None = "none"
)

// anywhere is what All stands for, and what gin has always trusted.
var anywhere = []string{"0.0.0.0/0", "::/0"}

// List is a set of prefixes that may set forwarding headers. The zero value
// trusts nobody, so a caller needs no nil check.
type List struct {
	prefixes []netip.Prefix
	// set when the list came from All, so the server can say so at startup
	everyone bool
}

// Parse reads the configured entries. "all" and "none" stand alone; anything
// else is a list of addresses or CIDR prefixes.
func Parse(entries []string) (*List, error) {
	cleaned := make([]string, 0, len(entries))
	for _, entry := range entries {
		if entry = strings.TrimSpace(entry); entry != "" {
			cleaned = append(cleaned, entry)
		}
	}

	if len(cleaned) == 0 {
		return &List{}, nil
	}

	for _, entry := range cleaned {
		word := strings.ToLower(entry)
		if word != All && word != None {
			continue
		}

		if len(cleaned) > 1 {
			return nil, fmt.Errorf("trusted proxy %q stands on its own, not next to %d other entries", word, len(cleaned)-1)
		}

		if word == None {
			return &List{}, nil
		}

		list, err := parsePrefixes(anywhere)
		if err != nil {
			return nil, err
		}
		list.everyone = true

		return list, nil
	}

	return parsePrefixes(cleaned)
}

func parsePrefixes(entries []string) (*List, error) {
	prefixes := make([]netip.Prefix, 0, len(entries))

	for _, entry := range entries {
		if prefix, err := netip.ParsePrefix(entry); err == nil {
			// a prefix with host bits set says something other than what it
			// looks like, so it is refused rather than quietly masked
			if prefix.Masked() != prefix {
				return nil, fmt.Errorf("trusted proxy %q has bits set below its prefix length", entry)
			}

			prefixes = append(prefixes, prefix.Masked())

			continue
		}

		addr, err := netip.ParseAddr(entry)
		if err != nil {
			return nil, fmt.Errorf("trusted proxy %q is neither an address nor a prefix", entry)
		}

		addr = addr.Unmap().WithZone("")
		prefixes = append(prefixes, netip.PrefixFrom(addr, addr.BitLen()))
	}

	return &List{prefixes: prefixes}, nil
}

// Empty reports whether nobody is trusted.
func (l *List) Empty() bool {
	return l == nil || len(l.prefixes) == 0
}

// Everyone reports whether the list was configured as "all", which is worth
// saying out loud at startup.
func (l *List) Everyone() bool {
	return l != nil && l.everyone
}

// Prefixes is the list in the form gin wants for SetTrustedProxies. Nil when
// nobody is trusted, which is how gin is told to read no headers at all.
func (l *List) Prefixes() []string {
	if l.Empty() {
		return nil
	}

	prefixes := make([]string, 0, len(l.prefixes))
	for _, prefix := range l.prefixes {
		prefixes = append(prefixes, prefix.String())
	}

	return prefixes
}

// Contains reports whether an address is one of the trusted proxies.
func (l *List) Contains(addr netip.Addr) bool {
	if l.Empty() || !addr.IsValid() {
		return false
	}

	addr = addr.Unmap().WithZone("")
	for _, prefix := range l.prefixes {
		if prefix.Contains(addr) {
			return true
		}
	}

	return false
}

// IsTrusted reports whether the peer a request arrived from is a trusted proxy.
// The address is a host:port as net/http hands it over, or a bare address. An
// address that cannot be read is not trusted: a header is believed only when
// this server is sure of who sent it.
func (l *List) IsTrusted(remoteAddr string) bool {
	return l.Contains(HostIP(remoteAddr))
}

// HostIP reads the address out of a host:port pair, or out of a bare address.
// The zero Addr when it is neither.
func HostIP(hostPort string) netip.Addr {
	if pair, err := netip.ParseAddrPort(hostPort); err == nil {
		return pair.Addr().Unmap().WithZone("")
	}

	if addr, err := netip.ParseAddr(hostPort); err == nil {
		return addr.Unmap().WithZone("")
	}

	return netip.Addr{}
}
