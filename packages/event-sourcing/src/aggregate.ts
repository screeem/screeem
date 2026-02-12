/**
 * Base Aggregate class for event-sourced aggregates
 */

import type { StoredEvent, EventMetadata } from '@screeem/shared'
import type { IAggregate, EventHandler } from './types.js'

export abstract class Aggregate implements IAggregate {
  public readonly id: string
  private _version: number = 0
  private _uncommittedEvents: Array<{ type: string; payload: unknown }> = []

  protected eventHandlers: Map<string, EventHandler> = new Map()

  constructor(id: string) {
    this.id = id
  }

  public get version(): number {
    return this._version
  }

  /**
   * Load aggregate state from event history
   */
  public loadFromHistory(events: StoredEvent[]): void {
    for (const event of events) {
      this.applyEvent(event.eventType, event.payload, event.metadata)
      this._version = event.streamSequence
    }
  }

  /**
   * Get uncommitted events (events produced by commands not yet persisted)
   */
  public getUncommittedEvents(): Array<{ type: string; payload: unknown }> {
    return [...this._uncommittedEvents]
  }

  /**
   * Mark all uncommitted events as committed
   */
  public markEventsAsCommitted(): void {
    this._uncommittedEvents = []
  }

  /**
   * Apply an event to the aggregate state
   */
  protected applyEvent(type: string, payload: unknown, metadata: EventMetadata): void {
    const handler = this.eventHandlers.get(type)
    if (handler) {
      handler(payload, metadata)
    }
  }

  /**
   * Raise a new event (to be persisted later)
   */
  protected raiseEvent(type: string, payload: unknown): void {
    this._uncommittedEvents.push({ type, payload })
    // Also apply to current state for optimistic updates
    this.applyEvent(type, payload, {
      userId: 'system',
      timestamp: new Date().toISOString(),
    })
    this._version++
  }

  /**
   * Register an event handler for a specific event type
   */
  protected registerHandler<TPayload>(
    eventType: string,
    handler: EventHandler<TPayload>
  ): void {
    this.eventHandlers.set(eventType, handler as EventHandler)
  }
}
