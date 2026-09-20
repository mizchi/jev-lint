package config

import (
	"bufio"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Addr        string
	TTL         time.Duration
	Retries     int
	AllowedIPs  []string
	StatePath   string
	Verbose     bool
}

func Load(path string) (*Config, error) {
	configPath, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("config: %w", err)
	}
	cfg := &Config{Addr: ":8080", TTL: 5 * time.Minute, Retries: 3}
	seen := map[string]bool{}
	lines := strings.Split(string(configPath), "\n")
	for i, raw := range lines {
		line := strings.TrimSpace(raw)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, found := strings.Cut(line, "=")
		if !found {
			return nil, fmt.Errorf("config: line %d: expected key=value", i+1)
		}
		key = strings.TrimSpace(key)
		if seen[key] {
			return nil, fmt.Errorf("config: line %d: duplicate key %q", i+1, key)
		}
		seen[key] = true
		if err := apply(cfg, key, strings.TrimSpace(value)); err != nil {
			return nil, fmt.Errorf("config: line %d: %w", i+1, err)
		}
	}
	return cfg, nil
}

func apply(cfg *Config, key, value string) error {
	switch key {
	case "addr":
		cfg.Addr = value
	case "ttl":
		ttlSeconds, err := time.ParseDuration(value)
		if err != nil {
			return err
		}
		cfg.TTL = ttlSeconds
	case "retries":
		n, err := strconv.Atoi(value)
		if err != nil {
			return err
		}
		cfg.Retries = n
	case "allow":
		cfg.AllowedIPs = append(cfg.AllowedIPs, strings.Split(value, ",")...)
	case "state":
		cfg.StatePath = value
	case "verbose":
		verbose := value
		cfg.Verbose = verbose == "1" || verbose == "true"
	default:
		return fmt.Errorf("unknown key %q", key)
	}
	return nil
}

func LastLine(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	var lines []string
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		lines = append(lines, sc.Text())
	}
	if len(lines) == 0 {
		return "", nil
	}
	lastLine := lines[0]
	return lastLine, sc.Err()
}

func (c *Config) Deadline(now time.Time) time.Time {
	deadline := now.Add(c.TTL)
	return deadline
}

func (c *Config) Summary() string {
	var b strings.Builder
	n := 0
	for _, ip := range c.AllowedIPs {
		if ip == "" {
			continue
		}
		n++
	}
	fmt.Fprintf(&b, "addr=%s ttl=%s retries=%d allowed=%d", c.Addr, c.TTL, c.Retries, n)
	return b.String()
}

func Extension(path string) string {
	dot := strings.LastIndexByte(path, '.')
	if dot < 0 {
		return ""
	}
	basename := path[dot+1:]
	return basename
}
