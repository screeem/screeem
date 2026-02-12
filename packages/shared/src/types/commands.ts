/**
 * Command types for event-sourced domains
 * Commands represent user intent and produce events
 */

// Post scheduling commands
export interface SchedulePostCommand {
  organizationId: string
  userId: string
  content: string
  scheduledFor: Date
  mediaUrls?: string[]
}

export interface UpdatePostCommand {
  organizationId: string
  userId: string
  postId: string
  content: string
  scheduledFor: Date
}

export interface CancelPostCommand {
  organizationId: string
  userId: string
  postId: string
  reason: string
}

export interface PublishPostCommand {
  organizationId: string
  postId: string
}

// Command result
export interface CommandResult {
  success: boolean
  eventId?: string
  error?: string
}
