package server

import (
	"crypto/tls"
	"fmt"
	"strconv"
	"strings"
)

var weakCiphers = map[uint16]bool{
	tls.TLS_RSA_WITH_RC4_128_SHA:                true,
	tls.TLS_RSA_WITH_3DES_EDE_CBC_SHA:           true,
	tls.TLS_RSA_WITH_AES_128_CBC_SHA:            true,
	tls.TLS_RSA_WITH_AES_256_CBC_SHA:            true,
	tls.TLS_RSA_WITH_AES_128_CBC_SHA256:         true,
	tls.TLS_RSA_WITH_AES_128_GCM_SHA256:         true,
	tls.TLS_RSA_WITH_AES_256_GCM_SHA384:         true,
	tls.TLS_ECDHE_ECDSA_WITH_RC4_128_SHA:        true,
	tls.TLS_ECDHE_RSA_WITH_RC4_128_SHA:          true,
	tls.TLS_ECDHE_RSA_WITH_3DES_EDE_CBC_SHA:     true,
	tls.TLS_ECDHE_ECDSA_WITH_AES_128_CBC_SHA256: true,
	tls.TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA256:   true,
}

func parseTLSVersion(versionStr string) (uint16, error) {
	if versionStr == "" {
		return 0, fmt.Errorf("empty TLS version")
	}

	version, err := strconv.ParseUint(versionStr, 0, 16)
	if err != nil {
		parts := strings.Split(versionStr, ".")
		if len(parts) == 2 && parts[0] == "1" {
			switch parts[1] {
			case "0":
				return tls.VersionTLS10, nil
			case "1":
				return tls.VersionTLS11, nil
			case "2":
				return tls.VersionTLS12, nil
			case "3":
				return tls.VersionTLS13, nil
			}
		}
		return 0, fmt.Errorf("invalid TLS version format: %s", versionStr)
	}

	return uint16(version), nil
}

func parseCipher(cipherStr string) (uint16, error) {
	if cipherStr == "" {
		return 0, fmt.Errorf("empty cipher")
	}

	cipher, err := strconv.ParseUint(cipherStr, 0, 16)
	if err != nil {
		return 0, fmt.Errorf("invalid cipher format: %s", cipherStr)
	}

	return uint16(cipher), nil
}

func (s *Server) validateTLS(versionStr, cipherStr string) error {
	if !s.config.TLSValidation.Enabled {
		return nil
	}

	if versionStr == "" && cipherStr == "" {
		return nil
	}

	minVersion, err := parseTLSVersion(s.config.TLSValidation.MinVersion)
	if err != nil {
		return fmt.Errorf("parse minimum TLS version from config: %w", err)
	}

	version, err := parseTLSVersion(versionStr)
	if err != nil {
		return fmt.Errorf("parse TLS version: %w", err)
	}

	if version < minVersion {
		return fmt.Errorf("TLS version %s is below minimum required version %s", versionStr, s.config.TLSValidation.MinVersion)
	}

	if cipherStr != "" {
		cipher, err := parseCipher(cipherStr)
		if err != nil {
			return fmt.Errorf("parse cipher: %w", err)
		}

		if weakCiphers[cipher] {
			return fmt.Errorf("weak cipher 0x%04x not allowed", cipher)
		}

		for _, blockedStr := range s.config.TLSValidation.BlockedCiphers {
			blocked, err := parseCipher(blockedStr)
			if err != nil {
				continue
			}
			if cipher == blocked {
				return fmt.Errorf("cipher 0x%04x is blocked by configuration", cipher)
			}
		}
	}

	return nil
}
