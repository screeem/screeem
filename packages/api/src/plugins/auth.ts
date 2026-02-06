/**
 * Supabase JWT authentication plugin for Fastify
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import fp from 'fastify-plugin'
import jwt from '@fastify/jwt'
import { env } from '../config/env.js'
import { supabaseAdmin } from '../config/supabase.js'

// Extend Fastify to include auth decorators
declare module 'fastify' {
  interface FastifyRequest {
    supabaseUser?: {
      id: string
      email: string
      role?: string
    }
  }

  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
    optionalAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
}

async function authPlugin(fastify: FastifyInstance) {
  // Register JWT plugin with Supabase JWT secret
  await fastify.register(jwt, {
    secret: env.SUPABASE_JWT_SECRET,
    verify: {
      algorithms: ['HS256'],
    },
  })

  // Decorator to verify Supabase token
  fastify.decorate('authenticate', async function (
    request: FastifyRequest,
    reply: FastifyReply
  ) {
    try {
      // Get token from Authorization header
      const authorization = request.headers.authorization
      if (!authorization) {
        return reply.status(401).send({ error: 'Missing authorization header' })
      }

      const token = authorization.replace('Bearer ', '')
      if (!token) {
        return reply.status(401).send({ error: 'Missing token' })
      }

      // Verify token with Supabase
      const { data, error } = await supabaseAdmin.auth.getUser(token)

      if (error || !data.user) {
        return reply.status(401).send({ error: 'Invalid token' })
      }

      // Attach user to request
      request.supabaseUser = {
        id: data.user.id,
        email: data.user.email!,
        role: data.user.role,
      }
    } catch (error) {
      fastify.log.error(error, 'Authentication error')
      return reply.status(401).send({ error: 'Authentication failed' })
    }
  })

  // Optional authentication decorator (doesn't fail if no token)
  fastify.decorate('optionalAuth', async function (
    request: FastifyRequest,
    _reply: FastifyReply
  ) {
    try {
      const authorization = request.headers.authorization
      if (!authorization) {
        return
      }

      const token = authorization.replace('Bearer ', '')
      if (!token) {
        return
      }

      const { data, error } = await supabaseAdmin.auth.getUser(token)

      if (!error && data.user) {
        request.supabaseUser = {
          id: data.user.id,
          email: data.user.email!,
          role: data.user.role,
        }
      }
    } catch (error) {
      // Silently fail for optional auth
      fastify.log.debug(error, 'Optional authentication failed')
    }
  })
}

export default fp(authPlugin, {
  name: 'auth',
})
