/**
 * Post scheduling routes (commands and queries)
 */

import type { FastifyInstance } from 'fastify'
import { pool } from '../../config/database.js'
import {
  schedulePostSchema,
  updatePostSchema,
  cancelPostSchema,
} from '@screeem/shared'
import { checkUserOrgAccess } from '../../db/organizations.js'
import {
  handleSchedulePost,
  handleUpdatePost,
  handleCancelPost,
} from '../../domain/commands/post-commands.js'

export async function registerPostRoutes(fastify: FastifyInstance) {
  /**
   * Schedule a new post (Command)
   * POST /api/organizations/:id/posts
   */
  fastify.post(
    '/api/organizations/:id/posts',
    {
      onRequest: [fastify.authenticate],
    },
    async (request, reply) => {
      const { id: organizationId } = request.params as { id: string }
      const userId = request.supabaseUser!.id

      // Check access
      const hasAccess = await checkUserOrgAccess(pool, organizationId, userId)
      if (!hasAccess) {
        return reply.status(403).send({ error: 'Access denied' })
      }

      // Validate request
      const validation = schedulePostSchema.safeParse(request.body)
      if (!validation.success) {
        return reply.status(400).send({
          error: 'Invalid request',
          details: validation.error.issues,
        })
      }

      const { content, scheduledFor, mediaUrls } = validation.data

      try {
        // Handle command
        const result = await handleSchedulePost({
          organizationId,
          userId,
          content,
          scheduledFor: new Date(scheduledFor),
          mediaUrls,
        })

        return reply.status(201).send({
          postId: result.postId,
          eventId: result.eventId,
        })
      } catch (error) {
        fastify.log.error(error)
        return reply.status(400).send({
          error: error instanceof Error ? error.message : 'Failed to schedule post',
        })
      }
    }
  )

  /**
   * Update a scheduled post (Command)
   * PATCH /api/organizations/:id/posts/:postId
   */
  fastify.patch(
    '/api/organizations/:id/posts/:postId',
    {
      onRequest: [fastify.authenticate],
    },
    async (request, reply) => {
      const { id: organizationId, postId } = request.params as {
        id: string
        postId: string
      }
      const userId = request.supabaseUser!.id

      // Check access
      const hasAccess = await checkUserOrgAccess(pool, organizationId, userId)
      if (!hasAccess) {
        return reply.status(403).send({ error: 'Access denied' })
      }

      // Validate request
      const validation = updatePostSchema.safeParse(request.body)
      if (!validation.success) {
        return reply.status(400).send({
          error: 'Invalid request',
          details: validation.error.issues,
        })
      }

      const { content, scheduledFor } = validation.data

      try {
        // Handle command
        const result = await handleUpdatePost({
          organizationId,
          userId,
          postId,
          content,
          scheduledFor: new Date(scheduledFor),
        })

        return reply.send({
          postId,
          eventId: result.eventId,
        })
      } catch (error) {
        fastify.log.error(error)
        return reply.status(400).send({
          error: error instanceof Error ? error.message : 'Failed to update post',
        })
      }
    }
  )

  /**
   * Cancel a scheduled post (Command)
   * DELETE /api/organizations/:id/posts/:postId
   */
  fastify.delete(
    '/api/organizations/:id/posts/:postId',
    {
      onRequest: [fastify.authenticate],
    },
    async (request, reply) => {
      const { id: organizationId, postId } = request.params as {
        id: string
        postId: string
      }
      const userId = request.supabaseUser!.id

      // Check access
      const hasAccess = await checkUserOrgAccess(pool, organizationId, userId)
      if (!hasAccess) {
        return reply.status(403).send({ error: 'Access denied' })
      }

      // Validate request
      const validation = cancelPostSchema.safeParse(request.body)
      if (!validation.success) {
        return reply.status(400).send({
          error: 'Invalid request',
          details: validation.error.issues,
        })
      }

      const { reason } = validation.data

      try {
        // Handle command
        const result = await handleCancelPost({
          organizationId,
          userId,
          postId,
          reason,
        })

        return reply.send({
          postId,
          eventId: result.eventId,
        })
      } catch (error) {
        fastify.log.error(error)
        return reply.status(400).send({
          error: error instanceof Error ? error.message : 'Failed to cancel post',
        })
      }
    }
  )

  /**
   * Get posts for organization (Query from read model)
   * GET /api/organizations/:id/posts
   */
  fastify.get(
    '/api/organizations/:id/posts',
    {
      onRequest: [fastify.authenticate],
    },
    async (request, reply) => {
      const { id: organizationId } = request.params as { id: string }
      const userId = request.supabaseUser!.id
      const {
        status,
        page = 1,
        pageSize = 50,
      } = request.query as {
        status?: string
        page?: number
        pageSize?: number
      }

      // Check access
      const hasAccess = await checkUserOrgAccess(pool, organizationId, userId)
      if (!hasAccess) {
        return reply.status(403).send({ error: 'Access denied' })
      }

      const validatedPage = Math.max(1, Number(page))
      const validatedPageSize = Math.min(100, Math.max(1, Number(pageSize)))
      const offset = (validatedPage - 1) * validatedPageSize

      let query: string
      let params: unknown[]

      if (status) {
        query = `
          SELECT sp.*, u.display_name as created_by_name
          FROM scheduled_posts sp
          JOIN users u ON sp.created_by = u.id
          WHERE sp.organization_id = $1 AND sp.status = $2
          ORDER BY sp.scheduled_for ASC
          LIMIT $3 OFFSET $4
        `
        params = [organizationId, status, validatedPageSize, offset]
      } else {
        query = `
          SELECT sp.*, u.display_name as created_by_name
          FROM scheduled_posts sp
          JOIN users u ON sp.created_by = u.id
          WHERE sp.organization_id = $1
          ORDER BY sp.scheduled_for DESC
          LIMIT $2 OFFSET $3
        `
        params = [organizationId, validatedPageSize, offset]
      }

      const result = await pool.query(query, params)

      // Get total count
      const countQuery = status
        ? `SELECT COUNT(*) as total FROM scheduled_posts WHERE organization_id = $1 AND status = $2`
        : `SELECT COUNT(*) as total FROM scheduled_posts WHERE organization_id = $1`
      const countParams = status ? [organizationId, status] : [organizationId]
      const countResult = await pool.query<{ total: string }>(countQuery, countParams)
      const total = parseInt(countResult.rows[0]?.total || '0', 10)

      return reply.send({
        posts: result.rows.map((row) => ({
          id: row.id,
          organizationId: row.organization_id,
          createdBy: row.created_by,
          createdByName: row.created_by_name,
          content: row.content,
          mediaUrls: row.media_urls,
          scheduledFor: row.scheduled_for.toISOString(),
          status: row.status,
          publishedAt: row.published_at?.toISOString() || null,
          twitterResult: row.twitter_result || null,
          createdAt: row.created_at.toISOString(),
          updatedAt: row.updated_at.toISOString(),
        })),
        pagination: {
          total,
          page: validatedPage,
          pageSize: validatedPageSize,
          totalPages: Math.ceil(total / validatedPageSize),
        },
      })
    }
  )

  /**
   * Get a specific post (Query from read model)
   * GET /api/organizations/:id/posts/:postId
   */
  fastify.get(
    '/api/organizations/:id/posts/:postId',
    {
      onRequest: [fastify.authenticate],
    },
    async (request, reply) => {
      const { id: organizationId, postId } = request.params as {
        id: string
        postId: string
      }
      const userId = request.supabaseUser!.id

      // Check access
      const hasAccess = await checkUserOrgAccess(pool, organizationId, userId)
      if (!hasAccess) {
        return reply.status(403).send({ error: 'Access denied' })
      }

      const result = await pool.query(
        `SELECT sp.*, u.display_name as created_by_name
         FROM scheduled_posts sp
         JOIN users u ON sp.created_by = u.id
         WHERE sp.id = $1 AND sp.organization_id = $2`,
        [postId, organizationId]
      )

      if (result.rows.length === 0) {
        return reply.status(404).send({ error: 'Post not found' })
      }

      const post = result.rows[0]

      return reply.send({
        id: post.id,
        organizationId: post.organization_id,
        createdBy: post.created_by,
        createdByName: post.created_by_name,
        content: post.content,
        mediaUrls: post.media_urls,
        scheduledFor: post.scheduled_for.toISOString(),
        status: post.status,
        publishedAt: post.published_at?.toISOString() || null,
        twitterResult: post.twitter_result || null,
        createdAt: post.created_at.toISOString(),
        updatedAt: post.updated_at.toISOString(),
      })
    }
  )
}
