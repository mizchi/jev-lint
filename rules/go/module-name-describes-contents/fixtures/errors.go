package server

import (
	"errors"
	"fmt"
	"net/http"
)

var (
	ErrNotFound     = errors.New("not found")
	ErrUnauthorized = errors.New("unauthorized")
	ErrConflict     = errors.New("conflict")
)

type StatusError struct {
	Status int
	Err    error
}

func (e *StatusError) Error() string { return fmt.Sprintf("%d: %v", e.Status, e.Err) }

func (e *StatusError) Unwrap() error { return e.Err }

func StatusOf(err error) int {
	var se *StatusError
	switch {
	case errors.As(err, &se):
		return se.Status
	case errors.Is(err, ErrNotFound):
		return http.StatusNotFound
	case errors.Is(err, ErrUnauthorized):
		return http.StatusUnauthorized
	case errors.Is(err, ErrConflict):
		return http.StatusConflict
	}
	return http.StatusInternalServerError
}
