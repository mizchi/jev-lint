-- Orders.

-- name: GetLatestOrder :one
SELECT id, user_id, total_cents, placed_at
FROM orders
WHERE user_id = $1
ORDER BY placed_at ASC
LIMIT 1;

-- name: GetNewestOrder :one
SELECT id, user_id, total_cents, placed_at
FROM orders
WHERE user_id = $1
ORDER BY placed_at DESC
LIMIT 1;

-- name: GetOrderTotal :one
SELECT total_cents, status
FROM orders
WHERE id = $1;

-- name: ListOrdersForUser :many
SELECT o.id, o.total_cents, o.placed_at, u.display_name
FROM orders o
JOIN users u ON u.id = o.user_id
WHERE o.user_id = $1
ORDER BY o.placed_at DESC;

-- name: GetUserAndOrders :one
SELECT u.id, u.email, o.id AS order_id, o.total_cents
FROM users u
JOIN orders o ON o.user_id = u.id
WHERE u.id = $1
LIMIT 1;

-- name: ListOrderNotes :many
SELECT id, order_id, note, created_at
FROM order_notes
WHERE order_id = $1
ORDER BY created_at DESC
LIMIT 1;

-- name: CountPendingOrders :many
SELECT id, user_id, total_cents
FROM orders
WHERE status = 'pending';

-- name: CountActiveOrders :one
SELECT COUNT(*)
FROM orders
WHERE status = 'pending';

-- name: GetOrder :one
DELETE FROM orders WHERE id = $1 RETURNING id, user_id, total_cents, placed_at;

-- name: TouchOrder :exec
UPDATE orders SET updated_at = NOW() WHERE id = $1;

-- name: GetOrderStatus :one
UPDATE orders SET status = 'shipped' WHERE id = $1 RETURNING id, status;

-- name: ListUnpaidInvoices :many
SELECT id, user_id, total_cents, placed_at
FROM orders
WHERE status = 'pending'
ORDER BY placed_at;

-- name: SumOrderTotals :one
SELECT COALESCE(SUM(total_cents), 0)::bigint AS total_cents
FROM orders
WHERE user_id = $1 AND status = 'paid';
