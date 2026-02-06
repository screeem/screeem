-- Event store queries

-- name: GetEventsByStream :many
SELECT * FROM events
WHERE stream_id = $1
ORDER BY stream_sequence ASC;

-- name: GetEventsByStreamFromSequence :many
SELECT * FROM events
WHERE stream_id = $1 AND stream_sequence >= $2
ORDER BY stream_sequence ASC;

-- name: GetEventsByType :many
SELECT * FROM events
WHERE event_type = $1
ORDER BY created_at DESC
LIMIT $2 OFFSET $3;

-- name: GetMaxStreamSequence :one
SELECT COALESCE(MAX(stream_sequence), 0) as max_sequence
FROM events
WHERE stream_id = $1;

-- name: AppendEvent :one
INSERT INTO events (
  id, stream_id, stream_type, event_type,
  event_version, payload, metadata,
  stream_sequence, created_at
) VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8, $9
)
RETURNING *;

-- name: GetEventHistory :many
SELECT * FROM events
WHERE stream_id = $1
ORDER BY stream_sequence DESC
LIMIT $2 OFFSET $3;

-- name: CountEventsByStream :one
SELECT COUNT(*) as total
FROM events
WHERE stream_id = $1;
