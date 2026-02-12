/**
 * Supabase webhook handler for user sync
 *
 * Handles auth.users changes from Supabase webhooks:
 * - user.created: Create local user record
 * - user.updated: Update local user record
 * - user.deleted: Delete local user record
 */

import type { FastifyInstance } from 'fastify'
import { pool } from '../../config/database.js'
import { createUser, updateUser, deleteUser, upsertUser } from '../../db/users.js'

interface SupabaseWebhookPayload {
  type: 'INSERT' | 'UPDATE' | 'DELETE'
  table: string
  schema: string
  record?: {
    id: string
    email?: string
    raw_user_meta_data?: {
      name?: string
      avatar_url?: string
      display_name?: string
    }
  }
  old_record?: {
    id: string
  }
}

export async function registerWebhookRoutes(fastify: FastifyInstance) {
  // Webhook endpoint for Supabase database changes
  fastify.post('/api/webhooks/supabase/auth', async (request, reply) => {
    try {
      const payload = request.body as SupabaseWebhookPayload

      fastify.log.info({ payload }, 'Received Supabase webhook')

      // Only process auth.users table events
      if (payload.schema !== 'auth' || payload.table !== 'users') {
        return reply.status(400).send({ error: 'Invalid webhook payload' })
      }

      switch (payload.type) {
        case 'INSERT':
        case 'UPDATE': {
          if (!payload.record) {
            return reply.status(400).send({ error: 'Missing record in payload' })
          }

          const metadata = payload.record.raw_user_meta_data || {}

          await upsertUser(pool, {
            id: payload.record.id,
            email: payload.record.email!,
            displayName: metadata.display_name || metadata.name || null,
            avatarUrl: metadata.avatar_url || null,
          })

          fastify.log.info({ userId: payload.record.id }, 'User synced successfully')
          break
        }

        case 'DELETE': {
          if (!payload.old_record) {
            return reply.status(400).send({ error: 'Missing old_record in payload' })
          }

          await deleteUser(pool, payload.old_record.id)
          fastify.log.info({ userId: payload.old_record.id }, 'User deleted successfully')
          break
        }
      }

      return reply.status(200).send({ success: true })
    } catch (error) {
      fastify.log.error(error, 'Webhook processing error')
      return reply.status(500).send({ error: 'Internal server error' })
    }
  })
}
