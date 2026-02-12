import { create } from 'zustand'
import type { StoredEvent } from '@screeem/shared/types/events'
import type {
  PostScheduledPayload,
  PostUpdatedPayload,
  PostCancelledPayload,
  PostPublishedPayload,
  PostFailedPayload,
} from '@screeem/shared/types/events'
import { POST_EVENT_TYPES } from '@screeem/shared/types/events'

export interface Post {
  id: string
  organizationId: string
  content: string
  mediaUrls: string[]
  scheduledFor: string
  status: 'scheduled' | 'publishing' | 'published' | 'failed' | 'cancelled'
  createdBy: string
  publishedAt?: string
  error?: string
  tweetId?: string
  createdAt: string
  updatedAt: string
  version: number
}

interface EventStoreState {
  // Events
  events: StoredEvent[]
  lastSequence: number

  // Projections
  posts: Map<string, Post>

  // Optimistic events (pending confirmation from backend)
  optimisticEvents: Map<string, StoredEvent>

  // Actions
  applyEvent: (event: StoredEvent) => void
  applyOptimisticEvent: (event: StoredEvent, optimisticId: string) => void
  confirmOptimisticEvent: (optimisticId: string, confirmedEvent: StoredEvent) => void
  rollbackOptimisticEvent: (optimisticId: string) => void
  clear: () => void
}

export const useEventStore = create<EventStoreState>((set, get) => ({
  events: [],
  lastSequence: 0,
  posts: new Map(),
  optimisticEvents: new Map(),

  applyEvent: (event: StoredEvent) => {
    const state = get()

    // Check if event is already applied
    if (state.events.some((e) => e.id === event.id)) {
      return
    }

    // Add event to log
    const newEvents = [...state.events, event]
    const newLastSequence = Math.max(state.lastSequence, event.sequence)

    // Apply event to projection
    const newPosts = new Map(state.posts)
    applyEventToProjection(newPosts, event)

    set({
      events: newEvents,
      lastSequence: newLastSequence,
      posts: newPosts,
    })
  },

  applyOptimisticEvent: (event: StoredEvent, optimisticId: string) => {
    const state = get()

    // Store optimistic event
    const newOptimisticEvents = new Map(state.optimisticEvents)
    newOptimisticEvents.set(optimisticId, event)

    // Apply to projection
    const newPosts = new Map(state.posts)
    applyEventToProjection(newPosts, event)

    set({
      optimisticEvents: newOptimisticEvents,
      posts: newPosts,
    })
  },

  confirmOptimisticEvent: (optimisticId: string, confirmedEvent: StoredEvent) => {
    const state = get()

    // Remove optimistic event
    const newOptimisticEvents = new Map(state.optimisticEvents)
    const optimisticEvent = newOptimisticEvents.get(optimisticId)
    newOptimisticEvents.delete(optimisticId)

    if (!optimisticEvent) {
      // Optimistic event not found, just apply the confirmed event
      get().applyEvent(confirmedEvent)
      return
    }

    // Add confirmed event to log
    const newEvents = [...state.events, confirmedEvent]
    const newLastSequence = Math.max(state.lastSequence, confirmedEvent.sequence)

    // Rebuild projection from scratch (to handle any differences between optimistic and confirmed)
    const newPosts = new Map()
    newEvents.forEach((e) => applyEventToProjection(newPosts, e))

    set({
      events: newEvents,
      lastSequence: newLastSequence,
      optimisticEvents: newOptimisticEvents,
      posts: newPosts,
    })
  },

  rollbackOptimisticEvent: (optimisticId: string) => {
    const state = get()

    // Remove optimistic event
    const newOptimisticEvents = new Map(state.optimisticEvents)
    newOptimisticEvents.delete(optimisticId)

    // Rebuild projection from confirmed events only
    const newPosts = new Map()
    state.events.forEach((e) => applyEventToProjection(newPosts, e))

    set({
      optimisticEvents: newOptimisticEvents,
      posts: newPosts,
    })
  },

  clear: () => {
    set({
      events: [],
      lastSequence: 0,
      posts: new Map(),
      optimisticEvents: new Map(),
    })
  },
}))

function applyEventToProjection(posts: Map<string, Post>, event: StoredEvent) {
  switch (event.eventType) {
    case POST_EVENT_TYPES.POST_SCHEDULED: {
      const payload = event.payload as PostScheduledPayload
      posts.set(payload.postId, {
        id: payload.postId,
        organizationId: event.streamId,
        content: payload.content,
        mediaUrls: payload.mediaUrls,
        scheduledFor: payload.scheduledFor,
        status: 'scheduled',
        createdBy: payload.createdBy,
        createdAt: event.createdAt.toISOString(),
        updatedAt: event.createdAt.toISOString(),
        version: event.streamSequence,
      })
      break
    }

    case POST_EVENT_TYPES.POST_UPDATED: {
      const payload = event.payload as PostUpdatedPayload
      const post = posts.get(payload.postId)
      if (post) {
        posts.set(payload.postId, {
          ...post,
          content: payload.content,
          scheduledFor: payload.scheduledFor,
          updatedAt: event.createdAt.toISOString(),
          version: event.streamSequence,
        })
      }
      break
    }

    case POST_EVENT_TYPES.POST_CANCELLED: {
      const payload = event.payload as PostCancelledPayload
      const post = posts.get(payload.postId)
      if (post) {
        posts.set(payload.postId, {
          ...post,
          status: 'cancelled',
          updatedAt: event.createdAt.toISOString(),
          version: event.streamSequence,
        })
      }
      break
    }

    case POST_EVENT_TYPES.POST_PUBLISHING: {
      const payload = event.payload as { postId: string }
      const post = posts.get(payload.postId)
      if (post) {
        posts.set(payload.postId, {
          ...post,
          status: 'publishing',
          updatedAt: event.createdAt.toISOString(),
          version: event.streamSequence,
        })
      }
      break
    }

    case POST_EVENT_TYPES.POST_PUBLISHED: {
      const payload = event.payload as PostPublishedPayload
      const post = posts.get(payload.postId)
      if (post) {
        posts.set(payload.postId, {
          ...post,
          status: 'published',
          publishedAt: payload.publishedAt,
          tweetId: payload.tweetId,
          updatedAt: event.createdAt.toISOString(),
          version: event.streamSequence,
        })
      }
      break
    }

    case POST_EVENT_TYPES.POST_FAILED: {
      const payload = event.payload as PostFailedPayload
      const post = posts.get(payload.postId)
      if (post) {
        posts.set(payload.postId, {
          ...post,
          status: 'failed',
          error: payload.error,
          updatedAt: event.createdAt.toISOString(),
          version: event.streamSequence,
        })
      }
      break
    }
  }
}
