/**
 * PostgreSQL Event Store implementation
 */

import type { Pool } from 'pg'
import type { StoredEvent, EventMetadata } from '@screeem/shared'
import type { IEventStore } from './types.js'
import { randomUUID } from 'crypto'

export class PostgreSQLEventStore implements IEventStore {
  constructor(private pool: Pool) {}

  /**
   * Append events to a stream with optimistic concurrency control
   */
  async append(
    streamId: string,
    streamType: string,
    events: Array<{ type: string; payload: unknown }>,
    expectedVersion: number,
    metadata: EventMetadata
  ): Promise<StoredEvent[]> {
    const client = await this.pool.connect()
    const storedEvents: StoredEvent[] = []

    try {
      await client.query('BEGIN')

      // Get current stream version
      const versionResult = await client.query<{ max_sequence: number | null }>(
        `SELECT MAX(stream_sequence) as max_sequence
         FROM events
         WHERE stream_id = $1`,
        [streamId]
      )

      const currentVersion = versionResult.rows[0]?.max_sequence ?? 0

      // Check for concurrency conflicts
      if (currentVersion !== expectedVersion) {
        throw new Error(
          `Concurrency conflict: expected version ${expectedVersion}, but current version is ${currentVersion}`
        )
      }

      // Insert each event
      for (let i = 0; i < events.length; i++) {
        const event = events[i]
        const streamSequence = currentVersion + i + 1
        const eventId = randomUUID()

        const result = await client.query<StoredEvent>(
          `INSERT INTO events (
            id, stream_id, stream_type, event_type, event_version,
            payload, metadata, stream_sequence, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
          RETURNING
            id, stream_id, stream_type, event_type, event_version,
            payload, metadata, sequence, stream_sequence, created_at`,
          [
            eventId,
            streamId,
            streamType,
            event.type,
            1, // event_version
            JSON.stringify(event.payload),
            JSON.stringify(metadata),
            streamSequence,
          ]
        )

        const storedEvent = result.rows[0]
        // Parse JSON fields
        storedEvent.payload = JSON.parse(storedEvent.payload as unknown as string)
        storedEvent.metadata = JSON.parse(storedEvent.metadata as unknown as string)
        storedEvents.push(storedEvent)

        // Notify listeners
        await client.query(
          `NOTIFY events, '${JSON.stringify({
            eventId,
            streamId,
            streamType,
            eventType: event.type
          })}'`
        )
      }

      await client.query('COMMIT')
      return storedEvents
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  /**
   * Get all events for a stream
   */
  async getStream(streamId: string): Promise<StoredEvent[]> {
    const result = await this.pool.query<StoredEvent>(
      `SELECT
        id, stream_id, stream_type, event_type, event_version,
        payload, metadata, sequence, stream_sequence, created_at
      FROM events
      WHERE stream_id = $1
      ORDER BY stream_sequence ASC`,
      [streamId]
    )

    return result.rows.map(row => ({
      ...row,
      payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload,
      metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
    }))
  }

  /**
   * Get events from a specific sequence number
   */
  async getStreamFromSequence(streamId: string, fromSequence: number): Promise<StoredEvent[]> {
    const result = await this.pool.query<StoredEvent>(
      `SELECT
        id, stream_id, stream_type, event_type, event_version,
        payload, metadata, sequence, stream_sequence, created_at
      FROM events
      WHERE stream_id = $1 AND stream_sequence >= $2
      ORDER BY stream_sequence ASC`,
      [streamId, fromSequence]
    )

    return result.rows.map(row => ({
      ...row,
      payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload,
      metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
    }))
  }

  /**
   * Subscribe to new events (using PostgreSQL LISTEN/NOTIFY)
   */
  async subscribe(callback: (event: StoredEvent) => void): Promise<() => void> {
    const client = await this.pool.connect()

    await client.query('LISTEN events')

    client.on('notification', async (msg) => {
      if (msg.channel === 'events' && msg.payload) {
        try {
          const notification = JSON.parse(msg.payload)
          // Fetch the full event
          const result = await this.pool.query<StoredEvent>(
            `SELECT
              id, stream_id, stream_type, event_type, event_version,
              payload, metadata, sequence, stream_sequence, created_at
            FROM events
            WHERE id = $1`,
            [notification.eventId]
          )

          if (result.rows.length > 0) {
            const event = result.rows[0]
            event.payload = typeof event.payload === 'string' ? JSON.parse(event.payload) : event.payload
            event.metadata = typeof event.metadata === 'string' ? JSON.parse(event.metadata) : event.metadata
            callback(event)
          }
        } catch (error) {
          console.error('Error processing event notification:', error)
        }
      }
    })

    // Return unsubscribe function
    return async () => {
      await client.query('UNLISTEN events')
      client.release()
    }
  }

  /**
   * Get event history with pagination
   */
  async getEventHistory(
    streamId: string,
    options?: { page?: number; pageSize?: number }
  ): Promise<{ events: StoredEvent[]; total: number }> {
    const page = options?.page ?? 1
    const pageSize = options?.pageSize ?? 50
    const offset = (page - 1) * pageSize

    // Get total count
    const countResult = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM events WHERE stream_id = $1`,
      [streamId]
    )
    const total = parseInt(countResult.rows[0].count, 10)

    // Get paginated events
    const result = await this.pool.query<StoredEvent>(
      `SELECT
        id, stream_id, stream_type, event_type, event_version,
        payload, metadata, sequence, stream_sequence, created_at
      FROM events
      WHERE stream_id = $1
      ORDER BY stream_sequence DESC
      LIMIT $2 OFFSET $3`,
      [streamId, pageSize, offset]
    )

    const events = result.rows.map(row => ({
      ...row,
      payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload,
      metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
    }))

    return { events, total }
  }
}
