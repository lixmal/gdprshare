package geoip

import (
	"fmt"
	"log"
	"net"

	"github.com/oschwald/geoip2-golang"
)

type Location struct {
	Continent    string
	Country      string
	Subdivision1 string
	Subdivision2 string
	City         string
	IsEU         bool
}

// LookupIP performs a GeoIP lookup for the given IP address and returns location information.
func LookupIP(path string, rawip string) (*Location, error) {
	db, err := geoip2.Open(path)
	if err != nil {
		return nil, fmt.Errorf("open: %w", err)
	}
	defer func() {
		if err := db.Close(); err != nil {
			log.Printf("Failed to close geoip database: %s\n", err)
		}
	}()

	ip := net.ParseIP(rawip)
	record, err := db.City(ip)
	if err != nil {
		return nil, fmt.Errorf("parse ip: %w", err)
	}

	var sub1, sub2 string
	if len(record.Subdivisions) > 0 {
		sub1 = record.Subdivisions[0].Names["en"]
	}
	if len(record.Subdivisions) > 1 {
		sub2 = record.Subdivisions[1].Names["en"]
	}

	return &Location{
		Continent:    record.Continent.Names["en"],
		Country:      record.Country.Names["en"],
		Subdivision1: sub1,
		Subdivision2: sub2,
		City:         record.City.Names["en"],
		IsEU:         record.Country.IsInEuropeanUnion,
	}, nil
}
