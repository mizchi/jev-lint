-- Users. Every query scopes to the tenant.

-- name: GetUserByEmail :one
SELECT id, email, display_name, created_at
FROM users
WHERE tenant_id = $1 AND id = $2
LIMIT 1;

-- name: GetUser :one
SELECT id, email, display_name, created_at
FROM users
WHERE tenant_id = $1 AND id = $2
LIMIT 1;

-- name: ListActiveUsers :many
SELECT id, email, display_name
FROM users
WHERE tenant_id = $1
ORDER BY created_at DESC;

-- name: ListUsers :many
SELECT id, email, display_name
FROM users
WHERE tenant_id = $1 AND deleted_at IS NULL
ORDER BY created_at DESC;

-- name: CountUsers :one
SELECT COUNT(*) FROM users WHERE tenant_id = $1 AND deleted_at IS NULL;

-- name: DeleteUser :exec
UPDATE users SET deleted_at = NOW()
WHERE tenant_id = $1 AND id = $2;

-- name: UpsertUser :one
INSERT INTO users (tenant_id, email, display_name)
VALUES ($1, $2, $3)
ON CONFLICT (tenant_id, email) DO UPDATE SET display_name = EXCLUDED.display_name
RETURNING id, email, display_name, created_at;
