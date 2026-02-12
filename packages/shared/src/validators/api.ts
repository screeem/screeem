/**
 * Zod validators for API requests
 */

import { z } from 'zod'

// Authentication
export const requestMagicLinkSchema = z.object({
  email: z.string().email(),
})

// Organizations
export const createOrganizationSchema = z.object({
  name: z.string().min(1).max(255),
  slug: z.string().min(1).max(255).regex(/^[a-z0-9-]+$/, 'Slug must contain only lowercase letters, numbers, and hyphens'),
})

export const updateOrganizationSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  slug: z.string().min(1).max(255).regex(/^[a-z0-9-]+$/).optional(),
})

// Members
export const memberRoleSchema = z.enum(['owner', 'admin', 'member'])

export const addMemberSchema = z.object({
  userId: z.string().uuid(),
  role: memberRoleSchema,
})

// Invitations
export const createInvitationSchema = z.object({
  email: z.string().email(),
  role: memberRoleSchema,
})

// Posts
export const schedulePostSchema = z.object({
  content: z.string().min(1).max(280),
  scheduledFor: z.string().datetime(),
  mediaUrls: z.array(z.string().url()).max(4).optional(),
})

export const updatePostSchema = z.object({
  content: z.string().min(1).max(280),
  scheduledFor: z.string().datetime(),
})

export const cancelPostSchema = z.object({
  reason: z.string().min(1).max(500),
})

export const listPostsQuerySchema = z.object({
  status: z.enum(['scheduled', 'publishing', 'published', 'failed', 'cancelled']).optional(),
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
})

// Twitter
export const twitterPreviewSchema = z.object({
  content: z.string().min(1).max(280),
  mediaUrls: z.array(z.string().url()).max(4).optional(),
})
