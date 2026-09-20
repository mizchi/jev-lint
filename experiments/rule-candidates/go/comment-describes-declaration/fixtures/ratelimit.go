package ratelimit

import (
	"context"
	"errors"
	"net/http"
	"sync"
	"time"
)

// ErrLimited is returned by Wait when the context ends before a token is
// available.
var ErrLimited = errors.New("ratelimit: limited")

// Limiter is a token bucket. It is safe for concurrent use.
type Limiter struct {
	mu       sync.Mutex
	tokens   float64
	burst    float64
	rate     float64 // tokens per second
	last     time.Time
	now      func() time.Time
	rejected int
}

// New returns a Limiter that refills at rate tokens per second up to burst.
// The bucket starts full.
func New(rate float64, burst int) *Limiter {
	return &Limiter{
		tokens: float64(burst),
		burst:  float64(burst),
		rate:   rate,
		last:   time.Now(),
		now:    time.Now,
	}
}

// refill adds the tokens earned since the last call. Callers must hold mu.
func (l *Limiter) refill() {
	now := l.now()
	elapsed := now.Sub(l.last).Seconds()
	l.tokens += elapsed * l.rate
	if l.tokens > l.burst {
		l.tokens = l.burst
	}
	l.last = now
}

// Allow reports whether a request may proceed right now, without consuming
// a token; call Take to consume one.
func (l *Limiter) Allow() bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.refill()
	if l.tokens < 1 {
		l.rejected++
		return false
	}
	l.tokens--
	return true
}

// Take consumes one token and reports whether one was available.
func (l *Limiter) Take() bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.refill()
	if l.tokens < 1 {
		l.rejected++
		return false
	}
	l.tokens--
	return true
}

// Wait blocks until a token is available or ctx is done. It polls at most
// once every 10ms.
func (l *Limiter) Wait(ctx context.Context) error {
	for {
		if l.Take() {
			return nil
		}
		select {
		case <-ctx.Done():
			return ErrLimited
		case <-time.After(100 * time.Millisecond):
		}
	}
}

// Rejected returns how many calls have been refused since the limiter was
// created.
func (l *Limiter) Rejected() int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.rejected
}

// Reset empties the bucket so the next call must wait for a refill.
func (l *Limiter) Reset() {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.tokens = l.burst
	l.last = l.now()
}

// Middleware wraps next so that requests refused by l get a 429.
func Middleware(l *Limiter, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !l.Take() {
			w.Header().Set("Retry-After", "1")
			http.Error(w, "too many requests", http.StatusTooManyRequests)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// --- helpers ---

func (l *Limiter) full() bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.tokens >= l.burst
}

// Hot: called once per request under load, so keep it allocation-free.
func (l *Limiter) tokensLeft() int {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.refill()
	return int(l.tokens)
}
