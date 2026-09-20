package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"strings"
	"time"
)

var ErrSignature = errors.New("auth: bad signature")
var ErrExpired = errors.New("auth: token expired")

type Claims struct {
	Subject string
	Expires time.Time
}

type Signer struct {
	key []byte
	now func() time.Time
}

func NewSigner(key []byte) *Signer { return &Signer{key: key, now: time.Now} }

func (s *Signer) Sign(c Claims) string {
	payload := c.Subject + "|" + c.Expires.UTC().Format(time.RFC3339)
	mac := hmac.New(sha256.New, s.key)
	mac.Write([]byte(payload))
	return base64.RawURLEncoding.EncodeToString([]byte(payload)) + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func (s *Signer) Parse(tok string) (*Claims, error) {
	body, sig, ok := strings.Cut(tok, ".")
	if !ok {
		return nil, ErrSignature
	}
	payload, err := base64.RawURLEncoding.DecodeString(body)
	if err != nil {
		return nil, ErrSignature
	}
	want := hmac.New(sha256.New, s.key)
	want.Write(payload)
	got, err := base64.RawURLEncoding.DecodeString(sig)
	if err != nil || !hmac.Equal(got, want.Sum(nil)) {
		return nil, ErrSignature
	}
	subject, exp, _ := strings.Cut(string(payload), "|")
	expires, err := time.Parse(time.RFC3339, exp)
	if err != nil {
		return nil, ErrSignature
	}
	if s.now().After(expires) {
		return nil, ErrExpired
	}
	return &Claims{Subject: subject, Expires: expires}, nil
}
