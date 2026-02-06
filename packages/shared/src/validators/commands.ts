/**
 * Zod validators for commands
 */

import { z } from 'zod'

export const schedulePostCommandSchema = z.object({
  organizationId: z.string().uuid(),
  userId: z.string().uuid(),
  content: z.string().min(1).max(280),
  scheduledFor: z.date().min(new Date(), 'Scheduled time must be in the future'),
  mediaUrls: z.array(z.string().url()).max(4).optional(),
})

export const updatePostCommandSchema = z.object({
  organizationId: z.string().uuid(),
  userId: z.string().uuid(),
  postId: z.string().uuid(),
  content: z.string().min(1).max(280),
  scheduledFor: z.date(),
})

export const cancelPostCommandSchema = z.object({
  organizationId: z.string().uuid(),
  userId: z.string().uuid(),
  postId: z.string().uuid(),
  reason: z.string().min(1).max(500),
})

export const publishPostCommandSchema = z.object({
  organizationId: z.string().uuid(),
  postId: z.string().uuid(),
})
