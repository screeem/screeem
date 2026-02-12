/**
 * Base Projection class for building read models from events
 */

import type { StoredEvent } from '@screeem/shared'
import type { IProjection } from './types.js'

export abstract class Projection implements IProjection {
  protected eventHandlers: Map<string, (event: StoredEvent) => Promise<void>> = new Map()

  /**
   * Handle a single event and update the read model
   */
  public async handle(event: StoredEvent): Promise<void> {
    const handler = this.eventHandlers.get(event.eventType)
    if (handler) {
      await handler(event)
    }
  }

  /**
   * Rebuild the projection from scratch (replay all events)
   */
  public async rebuild(events: StoredEvent[]): Promise<void> {
    await this.clear()
    for (const event of events) {
      await this.handle(event)
    }
  }

  /**
   * Clear the projection (to be implemented by subclasses)
   */
  protected abstract clear(): Promise<void>

  /**
   * Register an event handler for a specific event type
   */
  protected registerHandler(
    eventType: string,
    handler: (event: StoredEvent) => Promise<void>
  ): void {
    this.eventHandlers.set(eventType, handler)
  }
}
