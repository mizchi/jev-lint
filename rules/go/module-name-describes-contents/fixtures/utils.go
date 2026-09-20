package server

import (
	"context"
	"errors"
	"math/rand"
	"time"
)

var ErrRetriesExhausted = errors.New("retries exhausted")

type BackoffPolicy struct {
	Base   time.Duration
	Max    time.Duration
	Jitter float64
}

func (p BackoffPolicy) Delay(attempt int) time.Duration {
	d := p.Base << attempt
	if d > p.Max {
		d = p.Max
	}
	if p.Jitter > 0 {
		d += time.Duration(rand.Float64() * p.Jitter * float64(d))
	}
	return d
}

func Retry(ctx context.Context, attempts int, p BackoffPolicy, fn func() error) error {
	var last error
	for i := 0; i < attempts; i++ {
		if err := fn(); err == nil {
			return nil
		} else {
			last = err
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(p.Delay(i)):
		}
	}
	return errors.Join(ErrRetriesExhausted, last)
}

func IsRetryable(err error) bool {
	var t interface{ Temporary() bool }
	return errors.As(err, &t) && t.Temporary()
}
