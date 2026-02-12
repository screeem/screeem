-- Post queries (READ MODEL - projected from events)

-- name: GetPostByID :one
SELECT sp.*, u.display_name as created_by_name
FROM scheduled_posts sp
JOIN users u ON sp.created_by = u.id
WHERE sp.id = $1;

-- name: GetOrganizationPosts :many
SELECT sp.*, u.display_name as created_by_name
FROM scheduled_posts sp
JOIN users u ON sp.created_by = u.id
WHERE sp.organization_id = $1
ORDER BY sp.scheduled_for DESC
LIMIT $2 OFFSET $3;

-- name: GetPostsByStatus :many
SELECT sp.*, u.display_name as created_by_name
FROM scheduled_posts sp
JOIN users u ON sp.created_by = u.id
WHERE sp.organization_id = $1 AND sp.status = $2
ORDER BY sp.scheduled_for ASC
LIMIT $3 OFFSET $4;

-- name: CountOrganizationPosts :one
SELECT COUNT(*) as total
FROM scheduled_posts
WHERE organization_id = $1;

-- name: CountPostsByStatus :one
SELECT COUNT(*) as total
FROM scheduled_posts
WHERE organization_id = $1 AND status = $2;

-- name: GetPostsDueForPublishing :many
SELECT sp.*, u.display_name as created_by_name
FROM scheduled_posts sp
JOIN users u ON sp.created_by = u.id
WHERE sp.status = 'scheduled'
  AND sp.scheduled_for <= NOW()
ORDER BY sp.scheduled_for ASC
LIMIT $1;

-- Projection write operations (used by projection handlers)

-- name: InsertScheduledPost :exec
INSERT INTO scheduled_posts (
  id, organization_id, created_by, content, media_urls,
  scheduled_for, status
) VALUES (
  $1, $2, $3, $4, $5, $6, $7
);

-- name: UpdateScheduledPost :exec
UPDATE scheduled_posts
SET content = $2,
    scheduled_for = $3,
    updated_at = NOW(),
    version = version + 1
WHERE id = $1;

-- name: UpdatePostStatus :exec
UPDATE scheduled_posts
SET status = $2,
    updated_at = NOW(),
    version = version + 1
WHERE id = $1;

-- name: MarkPostPublished :exec
UPDATE scheduled_posts
SET status = 'published',
    published_at = $2,
    twitter_result = $3,
    updated_at = NOW(),
    version = version + 1
WHERE id = $1;

-- name: MarkPostFailed :exec
UPDATE scheduled_posts
SET status = 'failed',
    twitter_result = $2,
    updated_at = NOW(),
    version = version + 1
WHERE id = $1;

-- name: DeleteScheduledPost :exec
DELETE FROM scheduled_posts WHERE id = $1;

-- Twitter account queries

-- name: GetTwitterAccountByOrg :one
SELECT * FROM twitter_accounts WHERE organization_id = $1;

-- name: CreateTwitterAccount :one
INSERT INTO twitter_accounts (
  organization_id, account_name, account_id,
  access_token, refresh_token, expires_at, connected_by
) VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING *;

-- name: UpdateTwitterAccount :one
UPDATE twitter_accounts
SET access_token = $2,
    refresh_token = $3,
    expires_at = $4,
    updated_at = NOW()
WHERE id = $1
RETURNING *;

-- name: DeleteTwitterAccount :exec
DELETE FROM twitter_accounts WHERE id = $1;
