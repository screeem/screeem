/**
 * Organization CRUD routes
 */

import type { FastifyInstance } from 'fastify'
import { pool } from '../../config/database.js'
import {
  createOrganizationSchema,
  updateOrganizationSchema,
} from '@screeem/shared'
import {
  getUserOrganizations,
  getOrganizationById,
  getOrganizationBySlug,
  createOrganization,
  updateOrganization,
  deleteOrganization,
  checkUserOrgAccess,
  addOrganizationMember,
} from '../../db/organizations.js'

export async function registerOrganizationRoutes(fastify: FastifyInstance) {
  // List user's organizations
  fastify.get(
    '/api/organizations',
    {
      onRequest: [fastify.authenticate],
    },
    async (request, reply) => {
      const userId = request.supabaseUser!.id

      const organizations = await getUserOrganizations(pool, userId)

      return reply.send({
        organizations: organizations.map((org) => ({
          id: org.id,
          name: org.name,
          slug: org.slug,
          ownerId: org.owner_id,
          createdAt: org.created_at.toISOString(),
          updatedAt: org.updated_at.toISOString(),
        })),
      })
    }
  )

  // Get organization by ID
  fastify.get(
    '/api/organizations/:id',
    {
      onRequest: [fastify.authenticate],
    },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const userId = request.supabaseUser!.id

      const organization = await getOrganizationById(pool, id)

      if (!organization) {
        return reply.status(404).send({ error: 'Organization not found' })
      }

      // Check access
      const hasAccess = await checkUserOrgAccess(pool, id, userId)
      if (!hasAccess) {
        return reply.status(403).send({ error: 'Access denied' })
      }

      return reply.send({
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        ownerId: organization.owner_id,
        createdAt: organization.created_at.toISOString(),
        updatedAt: organization.updated_at.toISOString(),
      })
    }
  )

  // Create organization
  fastify.post(
    '/api/organizations',
    {
      onRequest: [fastify.authenticate],
    },
    async (request, reply) => {
      const userId = request.supabaseUser!.id

      // Validate request body
      const validation = createOrganizationSchema.safeParse(request.body)
      if (!validation.success) {
        return reply.status(400).send({
          error: 'Invalid request',
          details: validation.error.issues,
        })
      }

      const { name, slug } = validation.data

      // Check if slug is already taken
      const existing = await getOrganizationBySlug(pool, slug)
      if (existing) {
        return reply.status(409).send({ error: 'Slug already taken' })
      }

      // Create organization
      const organization = await createOrganization(pool, {
        name,
        slug,
        ownerId: userId,
      })

      // Add owner as member with 'owner' role
      await addOrganizationMember(pool, {
        organizationId: organization.id,
        userId,
        role: 'owner',
      })

      return reply.status(201).send({
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        ownerId: organization.owner_id,
        createdAt: organization.created_at.toISOString(),
        updatedAt: organization.updated_at.toISOString(),
      })
    }
  )

  // Update organization
  fastify.patch(
    '/api/organizations/:id',
    {
      onRequest: [fastify.authenticate],
    },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const userId = request.supabaseUser!.id

      const organization = await getOrganizationById(pool, id)

      if (!organization) {
        return reply.status(404).send({ error: 'Organization not found' })
      }

      // Only owner can update organization
      if (organization.owner_id !== userId) {
        return reply.status(403).send({ error: 'Only owner can update organization' })
      }

      // Validate request body
      const validation = updateOrganizationSchema.safeParse(request.body)
      if (!validation.success) {
        return reply.status(400).send({
          error: 'Invalid request',
          details: validation.error.issues,
        })
      }

      const { name, slug } = validation.data

      // Check if new slug is already taken
      if (slug && slug !== organization.slug) {
        const existing = await getOrganizationBySlug(pool, slug)
        if (existing) {
          return reply.status(409).send({ error: 'Slug already taken' })
        }
      }

      // Update organization
      const updated = await updateOrganization(pool, id, { name, slug })

      return reply.send({
        id: updated.id,
        name: updated.name,
        slug: updated.slug,
        ownerId: updated.owner_id,
        createdAt: updated.created_at.toISOString(),
        updatedAt: updated.updated_at.toISOString(),
      })
    }
  )

  // Delete organization
  fastify.delete(
    '/api/organizations/:id',
    {
      onRequest: [fastify.authenticate],
    },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const userId = request.supabaseUser!.id

      const organization = await getOrganizationById(pool, id)

      if (!organization) {
        return reply.status(404).send({ error: 'Organization not found' })
      }

      // Only owner can delete organization
      if (organization.owner_id !== userId) {
        return reply.status(403).send({ error: 'Only owner can delete organization' })
      }

      await deleteOrganization(pool, id)

      return reply.status(204).send()
    }
  )
}
