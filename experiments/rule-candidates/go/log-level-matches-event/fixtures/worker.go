package service

import (
	"context"
	"errors"
	"time"

	"go.uber.org/zap"
)

type Job struct {
	ID      string
	Retries int
}

type Worker struct {
	sugar *zap.SugaredLogger
	queue interface {
		Next(ctx context.Context) (*Job, error)
		Ack(id string) error
		Nack(id string) error
	}
	run func(ctx context.Context, j *Job) error
}

var ErrPoison = errors.New("worker: poison job")

func (w *Worker) Loop(ctx context.Context) error {
	for {
		j, err := w.queue.Next(ctx)
		if errors.Is(err, context.Canceled) {
			w.sugar.Infow("worker stopping", "reason", "context canceled")
			return nil
		}
		if err != nil {
			w.sugar.Errorw("queue read failed", "err", err)
			return err
		}
		if j == nil {
			w.sugar.Debugw("queue empty, sleeping")
			time.Sleep(time.Second)
			continue
		}
		if err := w.run(ctx, j); err != nil {
			if j.Retries >= 3 {
				w.sugar.Debugw("job failed permanently, dropping", "id", j.ID, "err", err)
				_ = w.queue.Ack(j.ID)
				continue
			}
			w.sugar.Warnw("job failed, requeueing", "id", j.ID, "attempt", j.Retries+1, "err", err)
			_ = w.queue.Nack(j.ID)
			continue
		}
		if err := w.queue.Ack(j.ID); err != nil {
			w.sugar.Infow("ack failed; job will be redelivered", "id", j.ID, "err", err)
			return err
		}
		w.sugar.Debugw("job done", "id", j.ID)
	}
}

func (w *Worker) Drain(ctx context.Context) int {
	n := 0
	for {
		j, err := w.queue.Next(ctx)
		if err != nil || j == nil {
			w.sugar.Infow("drain complete", "acked", n)
			return n
		}
		if err := w.queue.Ack(j.ID); err != nil {
			w.sugar.Fatalw("ack failed during drain", "id", j.ID, "err", err)
		}
		n++
	}
}
