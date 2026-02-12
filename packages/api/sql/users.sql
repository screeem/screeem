-- User queries

-- name: GetUserByID :one
SELECT * FROM users WHERE id = $1;

-- name: GetUserByEmail :one
SELECT * FROM users WHERE email = $1;

-- name: CreateUser :one
INSERT INTO users (email, email_verified, display_name, avatar_url)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: UpdateUser :one
UPDATE users
SET display_name = COALESCE($2, display_name),
    avatar_url = COALESCE($3, avatar_url),
    updated_at = NOW()
WHERE id = $1
RETURNING *;

-- name: VerifyUserEmail :one
UPDATE users
SET email_verified = true, updated_at = NOW()
WHERE id = $1
RETURNING *;

-- Magic link queries

-- name: CreateMagicLink :one
INSERT INTO magic_links (email, token, expires_at)
VALUES ($1, $2, $3)
RETURNING *;

-- name: GetMagicLinkByToken :one
SELECT * FROM magic_links
WHERE token = $1 AND used_at IS NULL AND expires_at > NOW();

-- name: MarkMagicLinkUsed :exec
UPDATE magic_links
SET used_at = NOW()
WHERE id = $1;

-- name: DeleteExpiredMagicLinks :exec
DELETE FROM magic_links
WHERE expires_at < NOW();

-- Session queries

-- name: CreateSession :one
INSERT INTO sessions (id, user_id, expires_at)
VALUES ($1, $2, $3)
RETURNING *;

-- name: GetSessionByID :one
SELECT s.*, u.email, u.display_name, u.avatar_url
FROM sessions s
JOIN users u ON s.user_id = u.id
WHERE s.id = $1 AND s.expires_at > NOW();

-- name: DeleteSession :exec
DELETE FROM sessions WHERE id = $1;

-- name: DeleteExpiredSessions :exec
DELETE FROM sessions WHERE expires_at < NOW();
