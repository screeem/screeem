/**
 * Event sourcing type definitions
 */

import type { StoredEvent, EventMetadata } from '@screeem/shared'

// Event store interface
export interface IEventStore {
  /**
   * Append events to a stream with optimistic concurrency control
   */
  append(
    streamId: string,
    streamType: string,
    events: Array<{ type: string; payload: unknown }>,
    expectedVersion: number,
    metadata: EventMetadata
  ): Promise<StoredEvent[]>

  /**
   * Get all events for a stream
   */
  getStream(streamId: string): Promise<StoredEvent[]>

  /**
   * Get events from a specific sequence number
   */
  getStreamFromSequence(streamId: string, fromSequence: number): Promise<StoredEvent[]>

  /**
   * Subscribe to new events (using PostgreSQL LISTEN/NOTIFY)
   */
  subscribe(callback: (event: StoredEvent) => void): Promise<() => void>

  /**
   * Get event history with pagination
   */
  getEventHistory(
    streamId: string,
    options?: { page?: number; pageSize?: number }
  ): Promise<{ events: StoredEvent[]; total: number }>
}

// Aggregate interface
export interface IAggregate {
  readonly id: string
  readonly version: number

  /**
   * Load aggregate state from event history
   */
  loadFromHistory(events: StoredEvent[]): void

  /**
   * Get uncommitted events (events produced by commands not yet persisted)
   */
  getUncommittedEvents(): Array<{ type: string; payload: unknown }>

  /**
   * Mark all uncommitted events as committed
   */
  markEventsAsCommitted(): void
}

// Projection interface
export interface IProjection {
  /**
   * Handle a single event and update the read model
   */
  handle(event: StoredEvent): Promise<void>

  /**
   * Rebuild the projection from scratch (replay all events)
   */
  rebuild(events: StoredEvent[]): Promise<void>
}

// Event handler type
export type EventHandler<TPayload = unknown> = (
  payload: TPayload,
  metadata: EventMetadata
) => void

// Command handler result
export interface CommandResult {
  success: boolean
  eventId?: string
  error?: string
}
