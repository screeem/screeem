/**
 * Type-safe event store database queries
 */
export async function getEventsByStream(client, streamId) {
    const result = await client.query(`SELECT * FROM events
     WHERE stream_id = $1
     ORDER BY stream_sequence ASC`, [streamId]);
    return result.rows;
}
export async function getEventsByStreamFromSequence(client, streamId, fromSequence) {
    const result = await client.query(`SELECT * FROM events
     WHERE stream_id = $1 AND stream_sequence >= $2
     ORDER BY stream_sequence ASC`, [streamId, fromSequence]);
    return result.rows;
}
export async function getMaxStreamSequence(client, streamId) {
    const result = await client.query(`SELECT COALESCE(MAX(stream_sequence), 0) as max_sequence
     FROM events
     WHERE stream_id = $1`, [streamId]);
    return result.rows[0]?.max_sequence ?? 0;
}
export async function appendEvent(client, params) {
    const result = await client.query(`INSERT INTO events (
      id, stream_id, stream_type, event_type,
      event_version, payload, metadata,
      stream_sequence, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING *`, [
        params.id,
        params.streamId,
        params.streamType,
        params.eventType,
        params.eventVersion,
        params.payload,
        params.metadata,
        params.streamSequence,
        params.createdAt,
    ]);
    return result.rows[0];
}
export async function getEventHistory(client, streamId, limit, offset) {
    const result = await client.query(`SELECT * FROM events
     WHERE stream_id = $1
     ORDER BY stream_sequence DESC
     LIMIT $2 OFFSET $3`, [streamId, limit, offset]);
    return result.rows;
}
export async function countEventsByStream(client, streamId) {
    const result = await client.query(`SELECT COUNT(*) as total
     FROM events
     WHERE stream_id = $1`, [streamId]);
    return parseInt(result.rows[0].total, 10);
}
