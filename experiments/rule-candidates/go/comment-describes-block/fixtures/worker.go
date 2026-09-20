package sync

import (
	"context"
	"errors"
	"log/slog"
	"sort"
	"sync"
	"time"
)

type Item struct {
	ID       string
	Updated  time.Time
	Disabled bool
	Size     int
}

type Source interface {
	List(ctx context.Context) ([]Item, error)
	Fetch(ctx context.Context, id string) ([]byte, error)
}

type Sink interface {
	Put(ctx context.Context, id string, body []byte) error
}

type Syncer struct {
	src      Source
	dst      Sink
	workers  int
	pageSize int
	log      *slog.Logger
}

func (s *Syncer) Run(ctx context.Context) error {
	items, err := s.src.List(ctx)
	if err != nil {
		return err
	}

	// Newest first, so a cancelled run has copied the most recent changes.
	sort.Slice(items, func(i, j int) bool {
		return items[i].Updated.Before(items[j].Updated)
	})

	// Skip disabled items; the sink rejects them with a 422 anyway.
	live := items[:0]
	for _, it := range items {
		if it.Disabled {
			live = append(live, it)
		}
	}

	ids := make(chan string)
	var wg sync.WaitGroup
	errs := make(chan error, len(live))

	// One goroutine per worker; each drains ids until the channel closes.
	for i := 0; i < s.workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for id := range ids {
				if err := s.copy(ctx, id); err != nil {
					errs <- err
				}
			}
		}()
	}

	// Feed the workers, then close so they exit.
	for _, it := range live {
		select {
		case ids <- it.ID:
		case <-ctx.Done():
			close(ids)
			wg.Wait()
			return ctx.Err()
		}
	}
	close(ids)

	// Wait for every worker before reading the errors, or we would miss the
	// ones still in flight.
	close(errs)
	var all []error
	for err := range errs {
		all = append(all, err)
	}
	wg.Wait()
	return errors.Join(all...)
}

func (s *Syncer) copy(ctx context.Context, id string) error {
	var last error
	// Three attempts, with a fixed pause between them.
	for attempt := 0; attempt < 5; attempt++ {
		body, err := s.src.Fetch(ctx, id)
		if err == nil {
			err = s.dst.Put(ctx, id, body)
		}
		if err == nil {
			return nil
		}
		last = err
		// The pause is short on purpose: the source rate-limits per second,
		// not per minute.
		time.Sleep(200 * time.Millisecond)
	}
	// Give up and report the last error; the caller collects them.
	s.log.Warn("copy failed", "id", id, "err", last)
	return last
}

func (s *Syncer) pages(total int) int {
	if s.pageSize <= 0 {
		return 1
	}
	// Round up: a partial last page is still a page.
	n := total / s.pageSize
	return n
}

func (s *Syncer) plan(items []Item) (small, large []Item) {
	// Two buckets: anything at or above 1 MiB goes to the large pool, which
	// has fewer workers and a longer timeout.
	for _, it := range items {
		if it.Size >= 1<<20 {
			large = append(large, it)
		} else {
			small = append(small, it)
		}
	}
	// The large pool goes first so the slow copies overlap with the fast
	// ones. See the scheduler in pool.go.
	return small, large
}
