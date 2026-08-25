// Package auth establishes who a visitor is against an OpenID Connect provider.
//
// A signed in visitor is a row in the database, and the cookie carries nothing
// but its id. That is deliberate: a cookie the server signs would mean a secret
// which could mint a session for anyone, and losing it would hand over every
// account at once. Here nothing can manufacture a session but a write to the
// database, signing out really ends one, and a group taken away takes effect on
// the next request rather than whenever the session would have run out.
package auth

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/lixmal/gdprshare/pkg/database"
)

// Session is what the server knows about a signed in visitor.
type Session struct {
	Subject string
	Email   string
	Groups  []string
}

var (
	errNoSession = errors.New("no session")
	errExpired   = errors.New("the session has expired")
)

// store keeps sessions and the logins that are under way.
type store struct {
	db *database.Database
}

// begin writes down a sign in that is under way and returns its id, which is
// what the cookie carries while the visitor is away at the provider.
func (s *store) begin(login pending, lifetime time.Duration) (string, error) {
	id, err := randomString()
	if err != nil {
		return "", err
	}

	row := database.Login{
		LoginId:   id,
		State:     login.State,
		Nonce:     login.Nonce,
		Verifier:  login.Verifier,
		Return:    login.Return,
		ExpiresAt: time.Now().Add(lifetime),
	}

	if err := s.db.Create(&row).Error; err != nil {
		return "", fmt.Errorf("write the login: %w", err)
	}

	return id, nil
}

// claim reads a login back and deletes it in the same breath: an answer from
// the provider is good once, so a code cannot be replayed against it.
func (s *store) claim(id string, now time.Time) (pending, error) {
	var login pending

	if id == "" {
		return login, errNoSession
	}

	var row database.Login
	if err := s.db.Where(&database.Login{LoginId: id}).Find(&row).Error; err != nil {
		return login, errNoSession
	}

	if err := s.db.Unscoped().Delete(&row).Error; err != nil {
		return login, fmt.Errorf("spend the login: %w", err)
	}

	if now.After(row.ExpiresAt) {
		return login, errExpired
	}

	return pending{
		State:    row.State,
		Nonce:    row.Nonce,
		Verifier: row.Verifier,
		Return:   row.Return,
	}, nil
}

// open writes a session and returns the id the cookie carries.
func (s *store) open(session Session, lifetime time.Duration) (string, error) {
	id, err := randomString()
	if err != nil {
		return "", err
	}

	row := database.Session{
		SessionId: id,
		Subject:   session.Subject,
		Email:     session.Email,
		Groups:    strings.Join(session.Groups, ","),
		ExpiresAt: time.Now().Add(lifetime),
	}

	if err := s.db.Create(&row).Error; err != nil {
		return "", fmt.Errorf("write the session: %w", err)
	}

	return id, nil
}

// read reports who a cookie belongs to. An id that names no row, or one whose
// row has run out, is no session at all.
func (s *store) read(id string, now time.Time) (Session, error) {
	var session Session

	if id == "" {
		return session, errNoSession
	}

	var row database.Session
	if err := s.db.Where(&database.Session{SessionId: id}).Find(&row).Error; err != nil {
		return session, errNoSession
	}

	if now.After(row.ExpiresAt) {
		// gone rather than merely ignored, so it cannot be tried again
		s.close(id)

		return session, errExpired
	}

	return Session{
		Subject: row.Subject,
		Email:   row.Email,
		Groups:  splitGroups(row.Groups),
	}, nil
}

// close ends a session for good.
func (s *store) close(id string) {
	if id == "" {
		return
	}

	if err := s.db.Unscoped().Where(&database.Session{SessionId: id}).Delete(&database.Session{}).Error; err != nil {
		log.Printf("Failed to end a session: %s\n", err)
	}
}

func splitGroups(groups string) []string {
	if groups == "" {
		return nil
	}

	return strings.Split(groups, ",")
}

// allowed reports whether the groups a provider vouched for include one the
// operator asked for. With no groups configured, anyone the provider knows is
// let in.
func allowed(groups, wanted []string) bool {
	if len(wanted) == 0 {
		return true
	}

	for _, want := range wanted {
		for _, group := range groups {
			if group == want {
				return true
			}
		}
	}

	return false
}

// equal compares two secrets without giving away where they differ.
func equal(a, b string) bool {
	return len(a) == len(b) && subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}

func randomString() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("read random bytes: %w", err)
	}

	return base64.RawURLEncoding.EncodeToString(buf), nil
}

// OpenForTest opens a session the way a finished login would, so a test can
// stand in for one without a provider to talk to.
func OpenForTest(g *Guard, subject, email string, groups []string, lifetime time.Duration) (string, error) {
	return g.sessions.open(Session{Subject: subject, Email: email, Groups: groups}, lifetime)
}
