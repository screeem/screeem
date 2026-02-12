import type { FastifyInstance } from 'fastify'
import { generateAuthUrl, handleCallback } from '../../infrastructure/twitter/oauth.js'
import { getTwitterAccountByOrg, createTwitterAccount, deleteTwitterAccount } from '../../db/twitter.js'
import { pool } from '../../config/database.js'
import { env } from '../../config/env.js'

/**
 * Twitter OAuth and account management routes
 */
export async function twitterRoutes(fastify: FastifyInstance) {
  /**
   * Initiate Twitter OAuth flow
   * GET /api/organizations/:id/twitter/auth
   */
  fastify.get<{
    Params: { id: string }
  }>(
    '/api/organizations/:id/twitter/auth',
    {
      onRequest: [fastify.authenticate],
    },
    async (request, reply) => {
      const { id: organizationId } = request.params
      const userId = request.supabaseUser!.id

      try {
        // Generate OAuth URL
        const authUrl = await generateAuthUrl({
          organizationId,
          userId,
          codeVerifier: '', // Will be filled by generateAuthUrl
        })

        return reply.send({ url: authUrl })
      } catch (error: any) {
        fastify.log.error(error)
        return reply.status(500).send({ error: error.message })
      }
    }
  )

  /**
   * Handle Twitter OAuth callback
   * GET /api/twitter/callback
   */
  fastify.get<{
    Querystring: { code: string; state: string }
  }>(
    '/api/twitter/callback',
    async (request, reply) => {
      const { code, state } = request.query

      if (!code || !state) {
        return reply.status(400).send({ error: 'Missing code or state' })
      }

      try {
        // Exchange code for tokens
        const { tokens, state: stateData, profile } = await handleCallback(code, state)

        // Store Twitter account in database
        await createTwitterAccount(pool, {
          organizationId: stateData.organizationId,
          accountName: profile.username,
          accountId: profile.id,
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresAt: tokens.expiresAt,
          connectedBy: stateData.userId,
        })

        // Redirect to frontend with success
        const redirectUrl = new URL('/app/settings/twitter', env.FRONTEND_URL)
        redirectUrl.searchParams.set('connected', 'true')

        return reply.redirect(redirectUrl.toString())
      } catch (error: any) {
        fastify.log.error(error)

        // Redirect to frontend with error
        const redirectUrl = new URL('/app/settings/twitter', env.FRONTEND_URL)
        redirectUrl.searchParams.set('error', error.message)

        return reply.redirect(redirectUrl.toString())
      }
    }
  )

  /**
   * Get connected Twitter account
   * GET /api/organizations/:id/twitter/account
   */
  fastify.get<{
    Params: { id: string }
  }>(
    '/api/organizations/:id/twitter/account',
    {
      onRequest: [fastify.authenticate],
    },
    async (request, reply) => {
      const { id: organizationId } = request.params

      try {
        const account = await getTwitterAccountByOrg(pool, organizationId)

        if (!account) {
          return reply.status(404).send({ error: 'No Twitter account connected' })
        }

        // Don't send tokens to frontend
        return reply.send({
          id: account.id,
          accountName: account.accountName,
          accountId: account.accountId,
          connectedAt: account.createdAt,
        })
      } catch (error: any) {
        fastify.log.error(error)
        return reply.status(500).send({ error: error.message })
      }
    }
  )

  /**
   * Disconnect Twitter account
   * DELETE /api/organizations/:id/twitter/account
   */
  fastify.delete<{
    Params: { id: string }
  }>(
    '/api/organizations/:id/twitter/account',
    {
      onRequest: [fastify.authenticate],
    },
    async (request, reply) => {
      const { id: organizationId } = request.params

      try {
        await deleteTwitterAccount(pool, organizationId)

        return reply.status(204).send()
      } catch (error: any) {
        fastify.log.error(error)
        return reply.status(500).send({ error: error.message })
      }
    }
  )
}
