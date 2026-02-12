import { describe, it, expect, beforeEach } from 'vitest'
import { Aggregate } from './aggregate.js'
import type { StoredEvent, EventMetadata } from '@screeem/shared'

// Test aggregate implementation
class TestAggregate extends Aggregate {
  public name: string = ''
  public count: number = 0

  constructor(id: string) {
    super(id)
    this.registerHandler<{ name: string }>('NameSet', (payload) => {
      this.name = payload.name
    })
    this.registerHandler<{ amount: number }>('CountIncremented', (payload) => {
      this.count += payload.amount
    })
  }

  setName(name: string): void {
    if (!name) throw new Error('Name cannot be empty')
    this.raiseEvent('NameSet', { name })
  }

  incrementCount(amount: number): void {
    if (amount <= 0) throw new Error('Amount must be positive')
    this.raiseEvent('CountIncremented', { amount })
  }
}

describe('Aggregate', () => {
  let aggregate: TestAggregate

  beforeEach(() => {
    aggregate = new TestAggregate('test-1')
  })

  describe('constructor', () => {
    it('should initialize with correct id', () => {
      expect(aggregate.id).toBe('test-1')
    })

    it('should initialize with version 0', () => {
      expect(aggregate.version).toBe(0)
    })

    it('should start with no uncommitted events', () => {
      expect(aggregate.getUncommittedEvents()).toEqual([])
    })
  })

  describe('raiseEvent', () => {
    it('should add event to uncommitted events', () => {
      aggregate.setName('Test Name')

      const events = aggregate.getUncommittedEvents()
      expect(events).toHaveLength(1)
      expect(events[0]).toEqual({
        type: 'NameSet',
        payload: { name: 'Test Name' },
      })
    })

    it('should apply event to state immediately', () => {
      aggregate.setName('Test Name')
      expect(aggregate.name).toBe('Test Name')
    })

    it('should increment version', () => {
      aggregate.setName('Test')
      expect(aggregate.version).toBe(1)

      aggregate.incrementCount(5)
      expect(aggregate.version).toBe(2)
    })

    it('should accumulate multiple events', () => {
      aggregate.setName('Test')
      aggregate.incrementCount(5)
      aggregate.incrementCount(3)

      const events = aggregate.getUncommittedEvents()
      expect(events).toHaveLength(3)
      expect(aggregate.count).toBe(8)
    })
  })

  describe('markEventsAsCommitted', () => {
    it('should clear uncommitted events', () => {
      aggregate.setName('Test')
      aggregate.incrementCount(5)
      expect(aggregate.getUncommittedEvents()).toHaveLength(2)

      aggregate.markEventsAsCommitted()
      expect(aggregate.getUncommittedEvents()).toEqual([])
    })

    it('should preserve state after clearing events', () => {
      aggregate.setName('Test')
      aggregate.incrementCount(5)
      aggregate.markEventsAsCommitted()

      expect(aggregate.name).toBe('Test')
      expect(aggregate.count).toBe(5)
    })
  })

  describe('loadFromHistory', () => {
    it('should rebuild state from events', () => {
      const metadata: EventMetadata = {
        userId: 'user-1',
        timestamp: '2024-01-01T00:00:00Z',
      }

      const events: StoredEvent[] = [
        {
          id: 'evt-1',
          streamId: 'test-1',
          streamType: 'test',
          eventType: 'NameSet',
          eventVersion: 1,
          payload: { name: 'Historical Name' },
          metadata,
          sequence: 1,
          streamSequence: 1,
          createdAt: new Date(),
        },
        {
          id: 'evt-2',
          streamId: 'test-1',
          streamType: 'test',
          eventType: 'CountIncremented',
          eventVersion: 1,
          payload: { amount: 10 },
          metadata,
          sequence: 2,
          streamSequence: 2,
          createdAt: new Date(),
        },
        {
          id: 'evt-3',
          streamId: 'test-1',
          streamType: 'test',
          eventType: 'CountIncremented',
          eventVersion: 1,
          payload: { amount: 5 },
          metadata,
          sequence: 3,
          streamSequence: 3,
          createdAt: new Date(),
        },
      ]

      aggregate.loadFromHistory(events)

      expect(aggregate.name).toBe('Historical Name')
      expect(aggregate.count).toBe(15)
      expect(aggregate.version).toBe(3)
    })

    it('should not add to uncommitted events', () => {
      const events: StoredEvent[] = [
        {
          id: 'evt-1',
          streamId: 'test-1',
          streamType: 'test',
          eventType: 'NameSet',
          eventVersion: 1,
          payload: { name: 'Test' },
          metadata: { userId: 'user-1', timestamp: '2024-01-01T00:00:00Z' },
          sequence: 1,
          streamSequence: 1,
          createdAt: new Date(),
        },
      ]

      aggregate.loadFromHistory(events)
      expect(aggregate.getUncommittedEvents()).toEqual([])
    })

    it('should handle empty history', () => {
      aggregate.loadFromHistory([])

      expect(aggregate.name).toBe('')
      expect(aggregate.count).toBe(0)
      expect(aggregate.version).toBe(0)
    })
  })

  describe('getUncommittedEvents', () => {
    it('should return a copy of uncommitted events', () => {
      aggregate.setName('Test')

      const events1 = aggregate.getUncommittedEvents()
      const events2 = aggregate.getUncommittedEvents()

      expect(events1).toEqual(events2)
      expect(events1).not.toBe(events2) // Different array instances
    })
  })

  describe('command validation', () => {
    it('should throw on invalid setName', () => {
      expect(() => aggregate.setName('')).toThrow('Name cannot be empty')
    })

    it('should throw on invalid incrementCount', () => {
      expect(() => aggregate.incrementCount(0)).toThrow('Amount must be positive')
      expect(() => aggregate.incrementCount(-1)).toThrow('Amount must be positive')
    })

    it('should not produce events on validation failure', () => {
      try {
        aggregate.setName('')
      } catch {
        // Expected
      }
      expect(aggregate.getUncommittedEvents()).toEqual([])
    })
  })
})
