package server

import (
	"encoding/json"
	"net/http"
	"strings"
)

type OrderService interface {
	Get(id string) (*Order, error)
	List(userID string) ([]Order, error)
	Cancel(id string) error
}

type Order struct {
	ID     string `json:"id"`
	UserID string `json:"user_id"`
	Status string `json:"status"`
}

type Handlers struct {
	orders OrderService
}

func (h *Handlers) GetOrder(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/orders/")
	o, err := h.orders.Get(id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	json.NewEncoder(w).Encode(o)
}

func (h *Handlers) ListOrders(w http.ResponseWriter, r *http.Request) {
	s, ok := SessionFrom(r.Context())
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	list, err := h.orders.List(s.UserID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(list)
}

func (h *Handlers) CancelOrder(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/orders/cancel/")
	if err := h.orders.Cancel(id); err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handlers) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /orders/", h.GetOrder)
	mux.HandleFunc("GET /orders", h.ListOrders)
	mux.HandleFunc("POST /orders/cancel/", h.CancelOrder)
}
