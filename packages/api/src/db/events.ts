/**
 * Type-safe event store database queries
 */

import type { Pool, PoolClient } from 'pg'
import type { Event } from './types.js'

export interface AppendEventParams {
  id: string
  streamId: string
  streamType: string
  eventType: string
  eventVersion: number
  payload: unknown
  metadata: unknown
  streamSequence: number
  createdAt: Date
}

export async function getEventsByStream(
  client: Pool | PoolClient,
  streamId: string
): Promise<Event[]> {
  const result = await client.query<Event>(
    `SELECT * FROM events
     WHERE stream_id = $1
     ORDER BY stream_sequence ASC`,
    [streamId]
  )
  return result.rows
}

export async function getEventsByStreamFromSequence(
  client: Pool | PoolClient,
  streamId: string,
  fromSequence: number
): Promise<Event[]> {
  const result = await client.query<Event>(
    `SELECT * FROM events
     WHERE stream_id = $1 AND stream_sequence >= $2
     ORDER BY stream_sequence ASC`,
    [streamId, fromSequence]
  )
  return result.rows
}

export async function getMaxStreamSequence(
  client: Pool | PoolClient,
  streamId: string
): Promise<number> {
  const result = await client.query<{ max_sequence: number | null }>(
    `SELECT COALESCE(MAX(stream_sequence), 0) as max_sequence
     FROM events
     WHERE stream_id = $1`,
    [streamId]
  )
  return result.rows[0]?.max_sequence ?? 0
}

export async function appendEvent(
  client: Pool | PoolClient,
  params: AppendEventParams
): Promise<Event> {
  const result = await client.query<Event>(
    `INSERT INTO events (
      id, stream_id, stream_type, event_type,
      event_version, payload, metadata,
      stream_sequence, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING *`,
    [
      params.id,
      params.streamId,
      params.streamType,
      params.eventType,
      params.eventVersion,
      params.payload,
      params.metadata,
      params.streamSequence,
      params.createdAt,
    ]
  )
  return result.rows[0]
}

export async function getEventHistory(
  client: Pool | PoolClient,
  streamId: string,
  limit: number,
  offset: number
): Promise<Event[]> {
  const result = await client.query<Event>(
    `SELECT * FROM events
     WHERE stream_id = $1
     ORDER BY stream_sequence DESC
     LIMIT $2 OFFSET $3`,
    [streamId, limit, offset]
  )
  return result.rows
}

export async function countEventsByStream(
  client: Pool | PoolClient,
  streamId: string
): Promise<number> {
  const result = await client.query<{ total: string }>(
    `SELECT COUNT(*) as total
     FROM events
     WHERE stream_id = $1`,
    [streamId]
  )
  return parseInt(result.rows[0].total, 10)
}
