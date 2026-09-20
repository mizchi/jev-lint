package server

import (
	"sync"
	"time"
)

type Limiter struct {
	mu     sync.Mutex
	tokens float64
	burst  float64
	rate   float64
	last   time.Time
}

func NewLimiter(rate float64, burst int) *Limiter {
	return &Limiter{tokens: float64(burst), burst: float64(burst), rate: rate, last: time.Now()}
}

func (l *Limiter) Allow() bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	l.tokens += now.Sub(l.last).Seconds() * l.rate
	if l.tokens > l.burst {
		l.tokens = l.burst
	}
	l.last = now
	if l.tokens < 1 {
		return false
	}
	l.tokens--
	return true
}

func (l *Limiter) Wait(d time.Duration) bool {
	deadline := time.Now().Add(d)
	for time.Now().Before(deadline) {
		if l.Allow() {
			return true
		}
		time.Sleep(10 * time.Millisecond)
	}
	return false
}
