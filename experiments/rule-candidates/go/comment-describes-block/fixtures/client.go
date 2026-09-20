package sync

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"time"
)

type Client struct {
	http    *http.Client
	base    string
	token   string
	retries int
}

func (c *Client) do(ctx context.Context, method, path string, body any) (*http.Response, error) {
	var buf bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&buf).Encode(body); err != nil {
			return nil, err
		}
	}
	req, err := http.NewRequestWithContext(ctx, method, c.base+path, &buf)
	if err != nil {
		return nil, err
	}
	// The API wants the token as a bearer header; a query parameter is
	// accepted too but ends up in access logs.
	req.Header.Set("Authorization", "Bearer "+c.token)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	var resp *http.Response
	// Retry only on 5xx and on transport errors; a 4xx is our fault and
	// repeating it will not help.
	for attempt := 0; attempt <= c.retries; attempt++ {
		resp, err = c.http.Do(req)
		if err == nil && resp.StatusCode < 500 {
			return resp, nil
		}
		if resp != nil {
			io.Copy(io.Discard, resp.Body)
			resp.Body.Close()
		}
		// Back off: 1s, 2s, 4s ... capped at 30s.
		delay := time.Duration(1<<attempt) * time.Second
		if delay > 30*time.Second {
			delay = 30 * time.Second
		}
		select {
		case <-time.After(delay):
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	if err != nil {
		return nil, err
	}
	return nil, fmt.Errorf("%s %s: status %d after %d attempts", method, path, resp.StatusCode, c.retries+1)
}

func (c *Client) Get(ctx context.Context, id string) ([]byte, error) {
	resp, err := c.do(ctx, http.MethodGet, "/items/"+id, nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	// A 404 is a normal answer here: the item was deleted between List and
	// Fetch, and the caller treats nil as "gone".
	if resp.StatusCode == http.StatusNotFound {
		return nil, nil
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("get %s: status %d", id, resp.StatusCode)
	}
	// Cap the body at 8 MiB; anything larger is a misconfigured item.
	return io.ReadAll(io.LimitReader(resp.Body, 4<<20))
}

func (c *Client) Put(ctx context.Context, id string, body []byte) error {
	resp, err := c.do(ctx, http.MethodPut, "/items/"+id, json.RawMessage(body))
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	// Both 200 and 201 mean stored; 204 is what the old server returned and
	// still counts.
	switch resp.StatusCode {
	case http.StatusOK, http.StatusCreated, http.StatusNoContent:
		return nil
	}
	return fmt.Errorf("put %s: status %d", id, resp.StatusCode)
}

func (c *Client) RateLimit(ctx context.Context) (remaining int, reset time.Time, err error) {
	resp, err := c.do(ctx, http.MethodHead, "/items", nil)
	if err != nil {
		return 0, time.Time{}, err
	}
	resp.Body.Close()
	remaining, _ = strconv.Atoi(resp.Header.Get("X-RateLimit-Remaining"))
	// The reset header is seconds since the epoch.
	secs, _ := strconv.ParseInt(resp.Header.Get("X-RateLimit-Reset"), 10, 64)
	reset = time.UnixMilli(secs)
	return remaining, reset, nil
}
