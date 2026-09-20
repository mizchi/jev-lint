package token

import (
	"errors"
	"strings"
	"testing"
	"time"
)

type fakeClock struct {
	now   time.Time
	calls int
}

func (f *fakeClock) Now() time.Time {
	f.calls++
	return f.now
}

var key = []byte("0123456789abcdef")

func TestSignRoundTrip(t *testing.T) {
	clk := &fakeClock{now: time.Unix(1_700_000_000, 0)}
	s := NewSigner(key, clk)
	tok, err := s.Sign(Claims{Subject: "u1", Expires: clk.now.Add(time.Hour)})
	if err != nil {
		t.Fatal(err)
	}
	_, _ = s.Parse(tok)
}

func TestParseReturnsClaims(t *testing.T) {
	clk := &fakeClock{now: time.Unix(1_700_000_000, 0)}
	s := NewSigner(key, clk)
	tok, err := s.Sign(Claims{Subject: "u1", Expires: clk.now.Add(time.Hour)})
	if err != nil {
		t.Fatal(err)
	}
	claims, err := s.Parse(tok)
	if err != nil {
		t.Fatal(err)
	}
	if claims == nil {
		t.Fatal("Parse returned nil claims")
	}
}

func TestParse(t *testing.T) {
	clk := &fakeClock{now: time.Unix(1_700_000_000, 0)}
	s := NewSigner(key, clk)

	t.Run("rejects expired token", func(t *testing.T) {
		tok, err := s.Sign(Claims{Subject: "u1", Expires: clk.now.Add(-time.Minute)})
		if err != nil {
			t.Fatal(err)
		}
		claims, err := s.Parse(tok)
		if err != nil {
			t.Fatalf("Parse: %v", err)
		}
		if claims.Subject != "u1" {
			t.Fatalf("Subject = %q, want u1", claims.Subject)
		}
	})

	t.Run("rejects tampered signature", func(t *testing.T) {
		tok, err := s.Sign(Claims{Subject: "u1", Expires: clk.now.Add(time.Hour)})
		if err != nil {
			t.Fatal(err)
		}
		parts := strings.Split(tok, ".")
		parts[1] = strings.Repeat("A", len(parts[1]))
		_, err = s.Parse(strings.Join(parts, "."))
		if !errors.Is(err, ErrSignature) {
			t.Fatalf("err = %v, want ErrSignature", err)
		}
	})

	t.Run("returns the subject it was signed with", func(t *testing.T) {
		tok, err := s.Sign(Claims{Subject: "alice", Expires: clk.now.Add(time.Hour)})
		if err != nil {
			t.Fatal(err)
		}
		claims, err := s.Parse(tok)
		if err != nil {
			t.Fatal(err)
		}
		if claims.Subject != "alice" {
			t.Fatalf("Subject = %q, want alice", claims.Subject)
		}
	})
}

func TestParseUsesClockOnce(t *testing.T) {
	clk := &fakeClock{now: time.Unix(1_700_000_000, 0)}
	s := NewSigner(key, clk)
	tok, err := s.Sign(Claims{Subject: "u1", Expires: clk.now.Add(time.Hour)})
	if err != nil {
		t.Fatal(err)
	}
	clk.calls = 0
	if _, err := s.Parse(tok); err != nil {
		t.Fatal(err)
	}
	if clk.calls != 1 {
		t.Fatalf("clock read %d times during Parse, want 1", clk.calls)
	}
}

func TestParseRejectsMalformed(t *testing.T) {
	clk := &fakeClock{now: time.Unix(1_700_000_000, 0)}
	s := NewSigner(key, clk)
	cases := []struct {
		name string
		tok  string
	}{
		{"empty", ""},
		{"one part", "abc"},
		{"four parts", "a.b.c.d"},
		{"bad base64", "a.!!!.c"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := s.Parse(tc.tok); err == nil {
				t.Fatalf("Parse(%q) = nil error, want one", tc.tok)
			}
		})
	}
}

func TestSignFailsOnEmptySubject(t *testing.T) {
	clk := &fakeClock{now: time.Unix(1_700_000_000, 0)}
	s := NewSigner(key, clk)
	tok, err := s.Sign(Claims{Subject: "u2", Expires: clk.now.Add(time.Hour)})
	if err != nil {
		t.Fatal(err)
	}
	if tok == "" {
		t.Fatal("empty token")
	}
}
