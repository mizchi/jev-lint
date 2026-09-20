package setup

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

func EnsureUsersTable(ctx context.Context, db *sql.DB) error {
	_, err := db.ExecContext(ctx, `CREATE TABLE users (
		id TEXT PRIMARY KEY,
		email TEXT NOT NULL UNIQUE,
		created_at TIMESTAMPTZ NOT NULL DEFAULT now()
	)`)
	return err
}

func EnsureEmailIndex(ctx context.Context, db *sql.DB) error {
	_, err := db.ExecContext(ctx, `CREATE INDEX IF NOT EXISTS users_email_idx ON users (email)`)
	return err
}

func UpsertUser(ctx context.Context, db *sql.DB, id, email string) error {
	_, err := db.ExecContext(ctx,
		`INSERT INTO users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email`,
		id, email)
	return err
}

func UpsertSetting(ctx context.Context, db *sql.DB, key, value string) error {
	_, err := db.ExecContext(ctx, `INSERT INTO settings (key, value) VALUES ($1, $2)`, key, value)
	return err
}

func ensureDir(path string) error {
	return os.MkdirAll(path, 0o755)
}

func EnsureStateFile(path string) error {
	if err := ensureDir(filepath.Dir(path)); err != nil {
		return err
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = f.WriteString("# state\n")
	return err
}

func EnsureTrailingSlash(s string) string {
	if strings.HasSuffix(s, "/") {
		return s
	}
	return s + "/"
}

type Registry struct {
	mu        sync.Mutex
	handlers  []http.Handler
	providers map[string]Provider
	metrics   map[string]int
	running   bool
	stop      chan struct{}
}

type Provider interface {
	Name() string
}

func (r *Registry) RegisterHandler(h http.Handler) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.handlers = append(r.handlers, h)
}

func (r *Registry) RegisterProvider(p Provider) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.providers == nil {
		r.providers = map[string]Provider{}
	}
	if _, ok := r.providers[p.Name()]; ok {
		return nil
	}
	r.providers[p.Name()] = p
	return nil
}

func (r *Registry) RegisterMetric(name string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.metrics == nil {
		r.metrics = map[string]int{}
	}
	r.metrics[name] = 0
}

func (r *Registry) EnsureRunning() {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.running {
		return
	}
	r.running = true
	r.stop = make(chan struct{})
	go r.loop(r.stop)
}

func (r *Registry) loop(stop <-chan struct{}) {
	<-stop
}

func SetupRoutes(mux *http.ServeMux, r *Registry) {
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, req *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("GET /providers", func(w http.ResponseWriter, req *http.Request) {
		r.mu.Lock()
		defer r.mu.Unlock()
		fmt.Fprintf(w, "%d providers\n", len(r.providers))
	})
}

var defaultRegistry *Registry

func SetupDefaultRegistry() *Registry {
	defaultRegistry = &Registry{}
	return defaultRegistry
}

type Hook func() error

var shutdownHooks []Hook

func InstallShutdownHook(h Hook) {
	shutdownHooks = append(shutdownHooks, h)
}

func InstallSignalHandler(ch chan<- os.Signal) error {
	if ch == nil {
		return errors.New("setup: nil channel")
	}
	installOnce.Do(func() { notify(ch) })
	return nil
}

var installOnce sync.Once

func notify(ch chan<- os.Signal) {}
