package service

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"time"
)

var ErrInvalidToken = errors.New("service: invalid token")

type Cache interface {
	Get(key string) ([]byte, bool)
	Set(key string, v []byte)
}

type Service struct {
	log   *slog.Logger
	cache Cache
	db    interface {
		Ping(context.Context) error
		Load(ctx context.Context, id string) ([]byte, error)
	}
}

func (s *Service) Handle(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	if r.Header.Get("Authorization") == "" {
		s.log.Debug("request rejected: missing token", "path", r.URL.Path)
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	id := r.URL.Query().Get("id")
	if b, ok := s.cache.Get(id); ok {
		w.Write(b)
		return
	}
	s.log.Error("cache miss", "id", id)
	b, err := s.db.Load(ctx, id)
	if err != nil {
		s.log.Info("load failed", "id", id, "err", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	s.cache.Set(id, b)
	if _, err := w.Write(b); err != nil {
		s.log.Warn("write to client failed", "err", err)
	}
	s.log.Debug("served", "id", id, "bytes", len(b))
}

func (s *Service) Login(ctx context.Context, user, password string) (string, error) {
	if !s.check(user, password) {
		s.log.Info("login refused", "user", user)
		return "", ErrInvalidToken
	}
	tok := s.issue(user)
	s.log.Info("login ok", "user", user)
	return tok, nil
}

func (s *Service) check(user, password string) bool { return user != "" && password != "" }
func (s *Service) issue(user string) string           { return user + ":tok" }

func (s *Service) WaitForDB(ctx context.Context) error {
	for attempt := 1; attempt <= 5; attempt++ {
		if err := s.db.Ping(ctx); err == nil {
			s.log.Info("database ready", "attempt", attempt)
			return nil
		} else {
			s.log.Warn("database not ready, retrying", "attempt", attempt, "err", err)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(time.Duration(attempt) * time.Second):
		}
	}
	s.log.Warn("database unreachable after 5 attempts, exiting")
	os.Exit(1)
	return nil
}

func (s *Service) Process(ctx context.Context, ids []string) int {
	done := 0
	for _, id := range ids {
		s.log.Debug("processing", "id", id)
		b, err := s.db.Load(ctx, id)
		if err != nil {
			s.log.Error("load failed, skipping", "id", id, "err", err)
			continue
		}
		s.cache.Set(id, b)
		done++
	}
	s.log.Error("processed batch", "count", done, "of", len(ids))
	return done
}

func LoadConfig(path string) map[string]string {
	b, err := os.ReadFile(path)
	if err != nil {
		slog.Warn("config not found, using defaults", "path", path)
		return map[string]string{"addr": ":8080"}
	}
	var m map[string]string
	if err := json.Unmarshal(b, &m); err != nil {
		slog.Error("config is not valid JSON", "path", path, "err", err)
		os.Exit(2)
	}
	return m
}

func Main(args []string) int {
	if len(args) < 2 {
		slog.Error("usage: service <config>")
		return 2
	}
	cfg := LoadConfig(args[1])
	slog.Info("listening", "addr", cfg["addr"])
	return 0
}
