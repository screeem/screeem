/**
 * Organization member management routes
 */

import type { FastifyInstance } from 'fastify'
import { pool } from '../../config/database.js'
import { addMemberSchema } from '@screeem/shared'
import {
  getOrganizationById,
  getOrganizationMembers,
  getOrganizationMember,
  addOrganizationMember,
  updateMemberRole,
  removeOrganizationMember,
  checkUserOrgAccess,
} from '../../db/organizations.js'
import { getUserByEmail } from '../../db/users.js'

export async function registerMemberRoutes(fastify: FastifyInstance) {
  // List organization members
  fastify.get(
    '/api/organizations/:id/members',
    {
      onRequest: [fastify.authenticate],
    },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const userId = request.supabaseUser!.id

      // Check access
      const hasAccess = await checkUserOrgAccess(pool, id, userId)
      if (!hasAccess) {
        return reply.status(403).send({ error: 'Access denied' })
      }

      const members = await getOrganizationMembers(pool, id)

      return reply.send({
        members: members.map((member) => ({
          id: member.id,
          organizationId: member.organization_id,
          userId: member.user_id,
          userEmail: member.email,
          userDisplayName: member.display_name,
          role: member.role,
          joinedAt: member.joined_at.toISOString(),
        })),
      })
    }
  )

  // Add member to organization
  fastify.post(
    '/api/organizations/:id/members',
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

      // Check if user is owner or admin
      const currentMember = await getOrganizationMember(pool, id, userId)
      const isOwner = organization.owner_id === userId
      const isAdmin = currentMember?.role === 'admin'

      if (!isOwner && !isAdmin) {
        return reply.status(403).send({ error: 'Only owner or admin can add members' })
      }

      // Validate request body
      const validation = addMemberSchema.safeParse(request.body)
      if (!validation.success) {
        return reply.status(400).send({
          error: 'Invalid request',
          details: validation.error.issues,
        })
      }

      const { userId: newUserId, role } = validation.data

      // Check if user exists
      const newUser = await pool.query(
        `SELECT * FROM users WHERE id = $1`,
        [newUserId]
      )

      if (newUser.rows.length === 0) {
        return reply.status(404).send({ error: 'User not found' })
      }

      // Check if already a member
      const existingMember = await getOrganizationMember(pool, id, newUserId)
      if (existingMember) {
        return reply.status(409).send({ error: 'User is already a member' })
      }

      // Add member
      const member = await addOrganizationMember(pool, {
        organizationId: id,
        userId: newUserId,
        role,
      })

      return reply.status(201).send({
        id: member.id,
        organizationId: member.organization_id,
        userId: member.user_id,
        role: member.role,
        joinedAt: member.joined_at.toISOString(),
      })
    }
  )

  // Update member role
  fastify.patch(
    '/api/organizations/:id/members/:userId',
    {
      onRequest: [fastify.authenticate],
    },
    async (request, reply) => {
      const { id, userId: targetUserId } = request.params as { id: string; userId: string }
      const userId = request.supabaseUser!.id
      const { role } = request.body as { role: string }

      const organization = await getOrganizationById(pool, id)

      if (!organization) {
        return reply.status(404).send({ error: 'Organization not found' })
      }

      // Only owner can change roles
      if (organization.owner_id !== userId) {
        return reply.status(403).send({ error: 'Only owner can change member roles' })
      }

      // Can't change owner's role
      if (targetUserId === organization.owner_id) {
        return reply.status(400).send({ error: 'Cannot change owner role' })
      }

      const member = await updateMemberRole(pool, id, targetUserId, role)

      return reply.send({
        id: member.id,
        organizationId: member.organization_id,
        userId: member.user_id,
        role: member.role,
        joinedAt: member.joined_at.toISOString(),
      })
    }
  )

  // Remove member from organization
  fastify.delete(
    '/api/organizations/:id/members/:userId',
    {
      onRequest: [fastify.authenticate],
    },
    async (request, reply) => {
      const { id, userId: targetUserId } = request.params as { id: string; userId: string }
      const userId = request.supabaseUser!.id

      const organization = await getOrganizationById(pool, id)

      if (!organization) {
        return reply.status(404).send({ error: 'Organization not found' })
      }

      // Owner can remove anyone, members can remove themselves
      const isOwner = organization.owner_id === userId
      const isSelf = targetUserId === userId

      if (!isOwner && !isSelf) {
        return reply.status(403).send({ error: 'Cannot remove other members' })
      }

      // Can't remove owner
      if (targetUserId === organization.owner_id) {
        return reply.status(400).send({ error: 'Cannot remove owner' })
      }

      await removeOrganizationMember(pool, id, targetUserId)

      return reply.status(204).send()
    }
  )
}
