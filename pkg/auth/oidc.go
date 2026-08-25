package auth

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// What the provider tells us about itself. Only the two endpoints are of any
// use here, and the issuer, which every ID token has to name.
type discovery struct {
	Issuer        string `json:"issuer"`
	Authorization string `json:"authorization_endpoint"`
	Token         string `json:"token_endpoint"`
	EndSession    string `json:"end_session_endpoint"`
}

// Provider is an OpenID Connect provider as far as this server needs one.
type Provider struct {
	issuer   string
	clientID string
	secret   string
	redirect string
	scopes   []string

	client *http.Client

	mu    sync.Mutex
	found *discovery
}

func NewProvider(issuer, clientID, secret, redirect string, scopes []string) *Provider {
	if len(scopes) == 0 {
		scopes = []string{"openid", "email", "profile"}
	}

	return &Provider{
		issuer:   strings.TrimSuffix(issuer, "/"),
		clientID: clientID,
		secret:   secret,
		redirect: redirect,
		scopes:   scopes,
		client:   &http.Client{Timeout: 15 * time.Second},
	}
}

// discover reads the provider's own description of itself, once, and keeps it.
// A provider that cannot be reached is a reason to refuse a visitor, never to
// let one through.
func (p *Provider) discover(ctx context.Context) (*discovery, error) {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.found != nil {
		return p.found, nil
	}

	address := p.issuer + "/.well-known/openid-configuration"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, address, nil)
	if err != nil {
		return nil, fmt.Errorf("build discovery request: %w", err)
	}

	response, err := p.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("reach the provider: %w", err)
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("the provider answered discovery with %s", response.Status)
	}

	var found discovery
	if err := json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&found); err != nil {
		return nil, fmt.Errorf("read the provider's description: %w", err)
	}

	// The issuer in the description has to be the one we asked, or the tokens
	// it hands out belong to somebody else.
	if strings.TrimSuffix(found.Issuer, "/") != p.issuer {
		return nil, fmt.Errorf("the provider calls itself %q, not %q", found.Issuer, p.issuer)
	}

	if found.Authorization == "" || found.Token == "" {
		return nil, fmt.Errorf("the provider named no authorization or token endpoint")
	}

	p.found = &found

	return p.found, nil
}

// A login in progress: what has to come back unchanged for the answer to be
// this server's own question rather than someone else's.
type pending struct {
	State    string `json:"state"`
	Nonce    string `json:"nonce"`
	Verifier string `json:"verifier"`
	Return   string `json:"return"`
	Expires  int64  `json:"exp"`
}

func newPending(returnTo string, lifetime time.Duration) (pending, error) {
	state, err := randomString()
	if err != nil {
		return pending{}, err
	}

	nonce, err := randomString()
	if err != nil {
		return pending{}, err
	}

	verifier, err := randomString()
	if err != nil {
		return pending{}, err
	}

	return pending{
		State:    state,
		Nonce:    nonce,
		Verifier: verifier,
		Return:   returnTo,
		Expires:  time.Now().Add(lifetime).Unix(),
	}, nil
}

// authorizationURL is where the visitor is sent to prove who they are. The
// verifier never leaves this server: only its hash goes along, so an
// authorization code picked out of a redirect cannot be traded in by anyone
// else.
func (p *Provider) authorizationURL(ctx context.Context, login pending) (string, error) {
	found, err := p.discover(ctx)
	if err != nil {
		return "", err
	}

	challenge := sha256.Sum256([]byte(login.Verifier))

	query := url.Values{}
	query.Set("response_type", "code")
	query.Set("client_id", p.clientID)
	query.Set("redirect_uri", p.redirect)
	query.Set("scope", strings.Join(p.scopes, " "))
	query.Set("state", login.State)
	query.Set("nonce", login.Nonce)
	query.Set("code_challenge", base64.RawURLEncoding.EncodeToString(challenge[:]))
	query.Set("code_challenge_method", "S256")

	separator := "?"
	if strings.Contains(found.Authorization, "?") {
		separator = "&"
	}

	return found.Authorization + separator + query.Encode(), nil
}

// claims are the parts of an ID token this server reads.
type claims struct {
	Issuer   string          `json:"iss"`
	Subject  string          `json:"sub"`
	Audience json.RawMessage `json:"aud"`
	Expires  int64           `json:"exp"`
	Nonce    string          `json:"nonce"`
	Email    string          `json:"email"`
}

// exchange trades the authorization code for an ID token and reads who the
// visitor is.
//
// The token comes straight from the provider's token endpoint over TLS, with
// this server authenticating itself, which is the one case where OpenID Connect
// allows a client not to check the token's signature (OIDC Core 3.1.3.7). What
// the token says about itself is still checked: the issuer, the audience, the
// expiry and the nonce this server sent.
func (p *Provider) exchange(ctx context.Context, code string, login pending, groupsClaim string) (Session, error) {
	var session Session

	found, err := p.discover(ctx)
	if err != nil {
		return session, err
	}

	form := url.Values{}
	form.Set("grant_type", "authorization_code")
	form.Set("code", code)
	form.Set("redirect_uri", p.redirect)
	form.Set("client_id", p.clientID)
	form.Set("code_verifier", login.Verifier)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, found.Token, strings.NewReader(form.Encode()))
	if err != nil {
		return session, fmt.Errorf("build token request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.SetBasicAuth(url.QueryEscape(p.clientID), url.QueryEscape(p.secret))

	response, err := p.client.Do(req)
	if err != nil {
		return session, fmt.Errorf("reach the token endpoint: %w", err)
	}
	defer response.Body.Close()

	body, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return session, fmt.Errorf("read the token answer: %w", err)
	}

	if response.StatusCode != http.StatusOK {
		return session, fmt.Errorf("the provider refused the code with %s", response.Status)
	}

	var answer struct {
		IDToken string `json:"id_token"`
	}
	if err := json.Unmarshal(body, &answer); err != nil {
		return session, fmt.Errorf("read the token answer: %w", err)
	}
	if answer.IDToken == "" {
		return session, fmt.Errorf("the provider sent no id token")
	}

	return p.readIDToken(answer.IDToken, login, groupsClaim)
}

func (p *Provider) readIDToken(token string, login pending, groupsClaim string) (Session, error) {
	var session Session

	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return session, fmt.Errorf("the id token is not a jwt")
	}

	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return session, fmt.Errorf("decode the id token: %w", err)
	}

	var read claims
	if err := json.Unmarshal(payload, &read); err != nil {
		return session, fmt.Errorf("read the id token: %w", err)
	}

	if strings.TrimSuffix(read.Issuer, "/") != p.issuer {
		return session, fmt.Errorf("the id token was issued by %q, not %q", read.Issuer, p.issuer)
	}

	if !audienceIncludes(read.Audience, p.clientID) {
		return session, fmt.Errorf("the id token was not issued for this server")
	}

	if read.Expires != 0 && time.Now().Unix() >= read.Expires {
		return session, fmt.Errorf("the id token has expired")
	}

	// the nonce ties the token to the login this server started
	if read.Nonce != login.Nonce {
		return session, fmt.Errorf("the id token answers a different login")
	}

	if read.Subject == "" {
		return session, fmt.Errorf("the id token names no subject")
	}

	return Session{
		Subject: read.Subject,
		Email:   read.Email,
		Groups:  readGroups(payload, groupsClaim),
	}, nil
}

// The audience is one name or a list of them, and both spellings are allowed.
func audienceIncludes(raw json.RawMessage, clientID string) bool {
	if len(raw) == 0 {
		return false
	}

	var one string
	if err := json.Unmarshal(raw, &one); err == nil {
		return one == clientID
	}

	var many []string
	if err := json.Unmarshal(raw, &many); err != nil {
		return false
	}

	for _, name := range many {
		if name == clientID {
			return true
		}
	}

	return false
}

// Which claim carries the groups differs between providers, so it is named in
// the configuration and read loosely: a list of names, or a single one.
func readGroups(payload []byte, claim string) []string {
	if claim == "" {
		return nil
	}

	var all map[string]json.RawMessage
	if err := json.Unmarshal(payload, &all); err != nil {
		return nil
	}

	raw, found := all[claim]
	if !found {
		return nil
	}

	var many []string
	if err := json.Unmarshal(raw, &many); err == nil {
		return many
	}

	var one string
	if err := json.Unmarshal(raw, &one); err == nil {
		return []string{one}
	}

	return nil
}
