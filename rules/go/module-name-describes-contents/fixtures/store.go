package server

import (
	"context"
	"database/sql"
	"errors"
)

type Store struct {
	db *sql.DB
}

func NewStore(db *sql.DB) *Store { return &Store{db: db} }

func (s *Store) GetOrder(ctx context.Context, id string) (*Order, error) {
	var o Order
	err := s.db.QueryRowContext(ctx, `SELECT id, user_id, status FROM orders WHERE id = $1`, id).
		Scan(&o.ID, &o.UserID, &o.Status)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &o, nil
}

func (s *Store) ListOrders(ctx context.Context, userID string) ([]Order, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, user_id, status FROM orders WHERE user_id = $1`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Order
	for rows.Next() {
		var o Order
		if err := rows.Scan(&o.ID, &o.UserID, &o.Status); err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

func (s *Store) CancelOrder(ctx context.Context, id string) error {
	res, err := s.db.ExecContext(ctx, `UPDATE orders SET status = 'cancelled' WHERE id = $1 AND status = 'open'`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrConflict
	}
	return nil
}
