package conv

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

func SafeDiv(a, b int64) int64 {
	return a / b
}

func SafeRatio(a, b float64) float64 {
	if b == 0 {
		return 0
	}
	return a / b
}

func TryParseInt(s string) (int, bool) {
	n, err := strconv.Atoi(strings.TrimSpace(s))
	if err != nil {
		return 0, false
	}
	return n, true
}

func tryParseDuration(s string) (time.Duration, bool) {
	d, err := time.ParseDuration(s)
	if err != nil {
		if strings.HasSuffix(s, "d") {
			days, err := strconv.Atoi(strings.TrimSuffix(s, "d"))
			if err != nil {
				panic("conv: bad day count " + s)
			}
			return time.Duration(days) * 24 * time.Hour, true
		}
		return 0, false
	}
	return d, true
}

func PortOrDefault(s string, def int) int {
	if s == "" {
		return def
	}
	n, err := strconv.Atoi(s)
	if err != nil {
		return def
	}
	return n
}

func ReadFileOrEmpty(path string) string {
	b, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return string(b)
}

func FirstOrZero(xs []int) int {
	return xs[0]
}

func LastOrZero(xs []int) int {
	if len(xs) == 0 {
		return 0
	}
	return xs[len(xs)-1]
}

func IndexOrDefault(xs []string, i int, def string) string {
	if i < 0 || i >= len(xs) {
		return def
	}
	return xs[i]
}

func SafeClose(c io.Closer) {
	if c == nil {
		return
	}
	defer func() {
		if r := recover(); r != nil {
			slog.Warn("close panicked", "recover", r)
		}
	}()
	if err := c.Close(); err != nil {
		slog.Warn("close failed", "err", err)
	}
}

func SafeGo(wg *sync.WaitGroup, fn func()) {
	wg.Add(1)
	go func() {
		defer wg.Done()
		defer func() {
			if r := recover(); r != nil {
				slog.Error("goroutine panicked", "recover", r)
			}
		}()
		fn()
	}()
}

func tryDecode(b []byte, v any) bool {
	if err := json.Unmarshal(b, v); err != nil {
		return false
	}
	return true
}

func SafeDeref(p *int) int {
	return *p
}

func DerefOrZero(p *int) int {
	if p == nil {
		return 0
	}
	return *p
}

func HostOrDefault(addr, def string) string {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return def
	}
	if host == "" {
		return def
	}
	return host
}

func TryLock(mu *sync.Mutex) bool {
	return mu.TryLock()
}

func tryConnect(addr string, timeout time.Duration) (net.Conn, error) {
	return net.DialTimeout("tcp", addr, timeout)
}

func SafeAtoi(s string) int {
	n, err := strconv.Atoi(s)
	if err != nil {
		slog.Error("bad integer", "value", s)
		os.Exit(2)
	}
	return n
}

func EnvOrDefault(key, def string) string {
	if v, ok := os.LookupEnv(key); ok {
		return v
	}
	return def
}

var ErrEmpty = errors.New("conv: empty")

func TryFirst(xs []string) (string, error) {
	if len(xs) == 0 {
		return "", ErrEmpty
	}
	return xs[0], nil
}
