package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"
)

type Order struct {
	ID       string    `json:"id"`
	UserID   string    `json:"user_id"`
	Total    int64     `json:"total_cents"`
	Lines    []Line    `json:"lines"`
	Created  time.Time `json:"created"`
	Archived bool      `json:"archived"`
}

type Line struct {
	SKU string `json:"sku"`
	Qty int    `json:"qty"`
}

type Repo interface {
	FindByID(ctx context.Context, id string) (*Order, error)
	ListByUser(ctx context.Context, userID string, limit int) ([]Order, error)
	Archive(ctx context.Context, id string) error
}

type Handler struct {
	repo    Repo
	timeout time.Duration
}

func (h *Handler) GetOrder(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), h.timeout)
	defer cancel()

	id := strings.TrimPrefix(r.URL.Path, "/orders/")
	orders, err := h.repo.FindByID(ctx, id)
	if err != nil {
		writeError(w, err)
		return
	}
	isAdmin := r.Header.Get("X-Role")
	if orders.Archived && isAdmin != "admin" {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	writeJSON(w, http.StatusOK, orders)
}

func (h *Handler) ListOrders(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), h.timeout)
	defer cancel()

	userID := r.URL.Query().Get("user")
	limit, err := strconv.Atoi(r.URL.Query().Get("limit"))
	if err != nil || limit <= 0 {
		limit = 50
	}
	order, err := h.repo.ListByUser(ctx, userID, limit)
	if err != nil {
		writeError(w, err)
		return
	}
	total := int64(0)
	for _, o := range order {
		total += o.Total
	}
	var resp = struct {
		Orders []Order `json:"orders"`
		Total  int64   `json:"total_cents"`
	}{order, total}
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) ArchiveOrder(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	id := strings.TrimPrefix(r.URL.Path, "/orders/archive/")
	ok := h.repo.Archive(r.Context(), id)
	if ok != nil {
		writeError(w, ok)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func clientHost(r *http.Request) string {
	addr := r.RemoteAddr
	if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
		addr = strings.TrimSpace(strings.Split(fwd, ",")[0])
	}
	host := strings.SplitN(addr, ":", 2)[1]
	return host
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	buf, err := json.Marshal(v)
	if err != nil {
		http.Error(w, "encode", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	w.Write(buf)
}

var ErrNotFound = errors.New("orders: not found")

func writeError(w http.ResponseWriter, err error) {
	status := http.StatusInternalServerError
	if errors.Is(err, ErrNotFound) {
		status = http.StatusNotFound
	}
	http.Error(w, err.Error(), status)
}
