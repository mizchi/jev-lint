package boot

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"log/slog"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"time"
)

func MustParseURL(s string) *url.URL {
	u, err := url.Parse(s)
	if err != nil {
		panic(fmt.Sprintf("boot: bad url %q: %v", s, err))
	}
	return u
}

func MustOpen(path string) *os.File {
	f, err := os.Open(path)
	if err != nil {
		slog.Error("open failed", "path", path, "err", err)
		return nil
	}
	return f
}

func mustEnv(key string) string {
	v, ok := os.LookupEnv(key)
	if !ok {
		return ""
	}
	return v
}

func MustCompile(pattern string) *regexp.Regexp {
	return regexp.MustCompile("^(?:" + pattern + ")$")
}

func MustAtoi(s string) (int, error) {
	n, err := strconv.Atoi(s)
	if err != nil {
		return 0, fmt.Errorf("boot: %q is not an integer: %w", s, err)
	}
	return n, nil
}

func mustGet[K comparable, V any](m map[K]V, k K) V {
	v, ok := m[k]
	if !ok {
		panic(fmt.Sprintf("boot: missing key %v", k))
	}
	return v
}

func MustConnect(ctx context.Context, dsn string) *sql.DB {
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		log.Fatalf("boot: open database: %v", err)
	}
	if err := db.PingContext(ctx); err != nil {
		log.Fatalf("boot: ping database: %v", err)
	}
	return db
}

type Config struct {
	Addr    string
	Timeout time.Duration
}

func MustLoad(path string) Config {
	b, err := os.ReadFile(path)
	if err != nil {
		slog.Warn("config missing, using defaults", "path", path)
		return Config{Addr: ":8080", Timeout: 5 * time.Second}
	}
	var c Config
	if err := json.Unmarshal(b, &c); err != nil {
		panic(fmt.Sprintf("boot: parse %s: %v", path, err))
	}
	return c
}

func mustDecode[T any](b []byte) (out T) {
	defer func() {
		if r := recover(); r != nil {
			slog.Error("decode panicked", "recover", r)
		}
	}()
	if err := json.Unmarshal(b, &out); err != nil {
		panic(err)
	}
	return out
}

type Server struct {
	addr string
	cfg  Config
}

func MustNew(cfg Config) *Server {
	if cfg.Addr == "" {
		panic("boot: Addr is required")
	}
	if cfg.Timeout <= 0 {
		panic("boot: Timeout must be positive")
	}
	return &Server{addr: cfg.Addr, cfg: cfg}
}

func MustMarshal(v any) []byte {
	b, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	return b
}

func mustHave(cond bool, msg string) {
	if !cond {
		panic("boot: invariant: " + msg)
	}
}

func MustParseDuration(s string) time.Duration {
	d, err := time.ParseDuration(s)
	if err != nil {
		panic(fmt.Errorf("boot: duration %q: %w", s, err))
	}
	return d
}

func MustResolve(ctx context.Context, lookup func(context.Context) (string, error)) string {
	var last error
	for attempt := 0; attempt < 3; attempt++ {
		addr, err := lookup(ctx)
		if err == nil {
			return addr
		}
		last = err
		time.Sleep(time.Duration(attempt+1) * 200 * time.Millisecond)
	}
	panic(fmt.Sprintf("boot: resolve failed after 3 attempts: %v", last))
}

func MustListen(addr string) string {
	if addr == "" {
		addr = ":0"
	}
	return addr
}

func mustWrite(path string, b []byte) {
	_ = os.WriteFile(path, b, 0o644)
}
