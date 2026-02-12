/**
 * Event types for event-sourced domains
 * Only post scheduling is event-sourced in this system
 */

// Base event metadata
export interface EventMetadata {
  userId: string
  timestamp: string
  correlationId?: string
  causationId?: string
}

// Post timeline events (the only event-sourced domain)
export const POST_EVENT_TYPES = {
  POST_SCHEDULED: 'PostScheduled',
  POST_UPDATED: 'PostUpdated',
  POST_CANCELLED: 'PostCancelled',
  POST_PUBLISHING: 'PostPublishing',
  POST_PUBLISHED: 'PostPublished',
  POST_FAILED: 'PostFailed',
} as const

export type PostEventType = typeof POST_EVENT_TYPES[keyof typeof POST_EVENT_TYPES]

// Event payloads
export interface PostScheduledPayload {
  postId: string
  content: string
  mediaUrls: string[]
  scheduledFor: string // ISO 8601
  createdBy: string
}

export interface PostUpdatedPayload {
  postId: string
  content: string
  scheduledFor: string // ISO 8601
}

export interface PostCancelledPayload {
  postId: string
  reason: string
}

export interface PostPublishingPayload {
  postId: string
}

export interface PostPublishedPayload {
  postId: string
  tweetId: string
  publishedAt: string // ISO 8601
}

export interface PostFailedPayload {
  postId: string
  error: string
}

// Discriminated union of all post events
export type PostEvent =
  | { type: typeof POST_EVENT_TYPES.POST_SCHEDULED; payload: PostScheduledPayload }
  | { type: typeof POST_EVENT_TYPES.POST_UPDATED; payload: PostUpdatedPayload }
  | { type: typeof POST_EVENT_TYPES.POST_CANCELLED; payload: PostCancelledPayload }
  | { type: typeof POST_EVENT_TYPES.POST_PUBLISHING; payload: PostPublishingPayload }
  | { type: typeof POST_EVENT_TYPES.POST_PUBLISHED; payload: PostPublishedPayload }
  | { type: typeof POST_EVENT_TYPES.POST_FAILED; payload: PostFailedPayload }

// Generic event envelope (as stored in the events table)
export interface StoredEvent<T = unknown> {
  id: string
  streamId: string
  streamType: string
  eventType: string
  eventVersion: number
  payload: T
  metadata: EventMetadata
  sequence: number
  streamSequence: number
  createdAt: Date
}

// Stream types
export const STREAM_TYPES = {
  POST_TIMELINE: 'post-timeline',
} as const

export type StreamType = typeof STREAM_TYPES[keyof typeof STREAM_TYPES]
