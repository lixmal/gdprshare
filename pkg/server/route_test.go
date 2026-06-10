package server

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/lixmal/gdprshare/pkg/database"
	"github.com/lixmal/gdprshare/pkg/geoip"
)

func TestIsDownloadAllowed(t *testing.T) {
	s := &Server{}

	tests := []struct {
		name    string
		file    *database.StoredFile
		client  *database.DstClient
		allowed bool
	}{
		{
			name:    "country in allowed list",
			file:    &database.StoredFile{AllowedCountries: "DE,FR,NL"},
			client:  &database.DstClient{Location: &geoip.Location{CountryCode: "DE"}},
			allowed: true,
		},
		{
			name:    "country not in allowed list",
			file:    &database.StoredFile{AllowedCountries: "DE,FR,NL"},
			client:  &database.DstClient{Location: &geoip.Location{CountryCode: "US"}},
			allowed: false,
		},
		{
			name:    "nil location blocked",
			file:    &database.StoredFile{AllowedCountries: "DE,FR"},
			client:  &database.DstClient{Location: nil},
			allowed: false,
		},
		{
			name:    "empty country code blocked",
			file:    &database.StoredFile{AllowedCountries: "DE,FR"},
			client:  &database.DstClient{Location: &geoip.Location{CountryCode: ""}},
			allowed: false,
		},
		{
			name:    "empty allowed countries falls through to OnlyEEA false",
			file:    &database.StoredFile{AllowedCountries: "", OnlyEEA: false},
			client:  &database.DstClient{Location: &geoip.Location{CountryCode: "US"}},
			allowed: true,
		},
		{
			name:    "empty allowed countries falls through to OnlyEEA true with EU location",
			file:    &database.StoredFile{AllowedCountries: "", OnlyEEA: true},
			client:  &database.DstClient{Location: &geoip.Location{CountryCode: "DE", IsEU: true}},
			allowed: true,
		},
		{
			name:    "empty allowed countries falls through to OnlyEEA true with non-EU location",
			file:    &database.StoredFile{AllowedCountries: "", OnlyEEA: true},
			client:  &database.DstClient{Location: &geoip.Location{CountryCode: "US"}},
			allowed: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := s.isDownloadAllowed(tt.file, tt.client)
			assert.Equal(t, tt.allowed, result)
		})
	}
}
