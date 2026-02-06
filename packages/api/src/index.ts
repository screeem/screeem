/**
 * Main API server entry point
 */

import Fastify from 'fastify'
import cors from '@fastify/cors'
import cookie from '@fastify/cookie'
import rateLimit from '@fastify/rate-limit'
import { env } from './config/env.js'
import { pool, closeDatabasePool } from './config/database.js'
import authPlugin from './plugins/auth.js'
import { registerAuthRoutes } from './modules/auth/routes.js'
import { registerWebhookRoutes } from './modules/auth/webhook.js'
import { registerOrganizationRoutes } from './modules/organizations/routes.js'
import { registerMemberRoutes } from './modules/organizations/members.js'
import { registerInvitationRoutes } from './modules/organizations/invitations.js'
import { registerPostRoutes } from './modules/posts/routes.js'
import { registerEventRoutes } from './modules/posts/events.js'
import { twitterRoutes } from './modules/twitter/routes.js'
import { postsProjection } from './domain/projections/posts-projection.js'
import { postPublisher } from './infrastructure/twitter/publisher.js'

const fastify = Fastify({
  logger: {
    level: env.NODE_ENV === 'development' ? 'debug' : 'info',
    transport:
      env.NODE_ENV === 'development'
        ? {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'HH:MM:ss Z',
              ignore: 'pid,hostname',
            },
          }
        : undefined,
  },
})

// Register plugins
await fastify.register(cors, {
  origin: env.FRONTEND_URL,
  credentials: true,
})

await fastify.register(cookie)

// Register rate limiting
await fastify.register(rateLimit, {
  max: 100, // 100 requests
  timeWindow: '1 minute', // per minute
  errorResponseBuilder: () => ({
    statusCode: 429,
    error: 'Too Many Requests',
    message: 'Rate limit exceeded. Please try again later.',
  }),
  // Skip rate limiting for health check
  allowList: (request) => request.url === '/health',
})

// Register auth plugin
await fastify.register(authPlugin)

// Register routes
await registerAuthRoutes(fastify)
await registerWebhookRoutes(fastify)
await registerOrganizationRoutes(fastify)
await registerMemberRoutes(fastify)
await registerInvitationRoutes(fastify)
await registerPostRoutes(fastify)
await registerEventRoutes(fastify)
await fastify.register(twitterRoutes)

// Start projections
await postsProjection.start()
fastify.log.info('📊 Post projection started')

// Start post publisher background job
postPublisher.start(60000) // Check every minute
fastify.log.info('📤 Post publisher started')

// Health check endpoint
fastify.get('/health', async () => {
  try {
    await pool.query('SELECT 1')
    return { status: 'ok', database: 'connected' }
  } catch (error) {
    fastify.log.error(error)
    return { status: 'error', database: 'disconnected' }
  }
})

// Root endpoint
fastify.get('/', async () => {
  return {
    name: 'Screeem API',
    version: '0.1.0',
    environment: env.NODE_ENV,
  }
})

// Graceful shutdown
process.on('SIGINT', async () => {
  fastify.log.info('SIGINT received, shutting down gracefully...')
  postPublisher.stop()
  await fastify.close()
  await closeDatabasePool()
  process.exit(0)
})

process.on('SIGTERM', async () => {
  fastify.log.info('SIGTERM received, shutting down gracefully...')
  postPublisher.stop()
  await fastify.close()
  await closeDatabasePool()
  process.exit(0)
})

// Start server
try {
  await fastify.listen({ port: env.PORT, host: '0.0.0.0' })
  fastify.log.info(`🚀 Server listening on port ${env.PORT}`)
  fastify.log.info(`📝 Environment: ${env.NODE_ENV}`)
} catch (err) {
  fastify.log.error(err)
  process.exit(1)
}
