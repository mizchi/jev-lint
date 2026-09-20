package server

import (
	"context"
	"net/http"
	"strings"
)

type ctxKey int

const sessionKey ctxKey = iota

type Session struct {
	UserID string
	Roles  []string
}

type SessionStore interface {
	Lookup(ctx context.Context, token string) (*Session, error)
}

func RequireSession(store SessionStore, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		if token == "" {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		s, err := store.Lookup(r.Context(), token)
		if err != nil {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), sessionKey, s)))
	})
}

func SessionFrom(ctx context.Context) (*Session, bool) {
	s, ok := ctx.Value(sessionKey).(*Session)
	return s, ok
}

func HasRole(s *Session, role string) bool {
	for _, r := range s.Roles {
		if r == role {
			return true
		}
	}
	return false
}
