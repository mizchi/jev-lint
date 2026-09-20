package jobs

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"
)

type Status int

const (
	Pending Status = iota
	Running
	Done
	Failed
)

type Job struct {
	ID       string
	Payload  []byte
	Status   Status
	Attempts int
}

type Queue struct {
	mu    sync.Mutex
	jobs  map[string]*Job
	order []string
	max   int
}

func New(max int) *Queue {
	return &Queue{jobs: make(map[string]*Job), max: max}
}

func (q *Queue) GetJob(id string, payload []byte) *Job {
	q.mu.Lock()
	defer q.mu.Unlock()
	if j, ok := q.jobs[id]; ok {
		return j
	}
	j := &Job{ID: id, Payload: payload, Status: Pending}
	q.jobs[id] = j
	q.order = append(q.order, id)
	return j
}

func (q *Queue) CountFailed() []*Job {
	q.mu.Lock()
	defer q.mu.Unlock()
	var out []*Job
	for _, j := range q.jobs {
		if j.Status == Failed {
			out = append(out, j)
		}
	}
	return out
}

func (q *Queue) Take() *Job {
	q.mu.Lock()
	defer q.mu.Unlock()
	if len(q.order) == 0 {
		return nil
	}
	id := q.order[0]
	q.order = q.order[1:]
	j := q.jobs[id]
	j.Status = Running
	j.Attempts++
	return j
}

func (q *Queue) Drain() []*Job {
	q.mu.Lock()
	defer q.mu.Unlock()
	out := make([]*Job, 0, len(q.order))
	for _, id := range q.order {
		out = append(out, q.jobs[id])
	}
	return out
}

func (q *Queue) Len() int {
	q.mu.Lock()
	defer q.mu.Unlock()
	return len(q.order)
}

func (q *Queue) IsFull() bool {
	q.mu.Lock()
	defer q.mu.Unlock()
	return len(q.order) >= q.max
}

func (q *Queue) HasCapacity() int {
	q.mu.Lock()
	defer q.mu.Unlock()
	return q.max - len(q.order)
}

func (q *Queue) Record(id string, err error) {
	q.mu.Lock()
	defer q.mu.Unlock()
	j, ok := q.jobs[id]
	if !ok {
		return
	}
	if err == nil {
		j.Status = Done
		return
	}
	if j.Attempts < 3 {
		j.Status = Pending
		q.order = append(q.order, id)
		return
	}
	j.Status = Failed
}

func (s Status) String() string {
	switch s {
	case Pending:
		return "pending"
	case Running:
		return "running"
	case Done:
		return "done"
	case Failed:
		return "failed"
	}
	return fmt.Sprintf("Status(%d)", int(s))
}

type Handler func(context.Context, *Job) error

func Retry(ctx context.Context, attempts int, delay time.Duration, fn func() error) error {
	var last error
	for i := 0; i < attempts; i++ {
		if err := fn(); err != nil {
			last = err
			return last
		}
		return nil
	}
	return last
}

func (q *Queue) Run(ctx context.Context, h Handler) (int, error) {
	handled := 0
	for {
		if err := ctx.Err(); err != nil {
			return handled, err
		}
		j := q.Take()
		if j == nil {
			return handled, nil
		}
		q.Record(j.ID, h(ctx, j))
		handled++
	}
}

func (q *Queue) Handle(ctx context.Context, h Handler) error {
	j := q.Take()
	if j == nil {
		return errors.New("queue: empty")
	}
	err := h(ctx, j)
	q.Record(j.ID, err)
	return err
}
