/**
 * Type-safe organization database queries
 */

import type { Pool, PoolClient } from 'pg'
import type { Organization, OrganizationMember, OrganizationMemberWithUser, Invitation } from './types.js'

// ============================================================================
// Organizations
// ============================================================================

export async function getOrganizationById(
  client: Pool | PoolClient,
  id: string
): Promise<Organization | null> {
  const result = await client.query<Organization>(
    `SELECT * FROM organizations WHERE id = $1`,
    [id]
  )
  return result.rows[0] || null
}

export async function getOrganizationBySlug(
  client: Pool | PoolClient,
  slug: string
): Promise<Organization | null> {
  const result = await client.query<Organization>(
    `SELECT * FROM organizations WHERE slug = $1`,
    [slug]
  )
  return result.rows[0] || null
}

export interface CreateOrganizationParams {
  name: string
  slug: string
  ownerId: string
}

export async function createOrganization(
  client: Pool | PoolClient,
  params: CreateOrganizationParams
): Promise<Organization> {
  const result = await client.query<Organization>(
    `INSERT INTO organizations (name, slug, owner_id)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [params.name, params.slug, params.ownerId]
  )
  return result.rows[0]
}

export interface UpdateOrganizationParams {
  name?: string
  slug?: string
}

export async function updateOrganization(
  client: Pool | PoolClient,
  id: string,
  params: UpdateOrganizationParams
): Promise<Organization> {
  const result = await client.query<Organization>(
    `UPDATE organizations
     SET name = COALESCE($2, name),
         slug = COALESCE($3, slug),
         updated_at = NOW(),
         version = version + 1
     WHERE id = $1
     RETURNING *`,
    [id, params.name, params.slug]
  )
  return result.rows[0]
}

export async function deleteOrganization(
  client: Pool | PoolClient,
  id: string
): Promise<void> {
  await client.query(`DELETE FROM organizations WHERE id = $1`, [id])
}

export async function getUserOrganizations(
  client: Pool | PoolClient,
  userId: string
): Promise<Organization[]> {
  const result = await client.query<Organization>(
    `SELECT DISTINCT o.*
     FROM organizations o
     LEFT JOIN organization_members om ON o.id = om.organization_id
     WHERE o.owner_id = $1 OR om.user_id = $1
     ORDER BY o.created_at DESC`,
    [userId]
  )
  return result.rows
}

// ============================================================================
// Members
// ============================================================================

export async function getOrganizationMembers(
  client: Pool | PoolClient,
  organizationId: string
): Promise<OrganizationMemberWithUser[]> {
  const result = await client.query<OrganizationMemberWithUser>(
    `SELECT om.*, u.email, u.display_name, u.avatar_url
     FROM organization_members om
     JOIN users u ON om.user_id = u.id
     WHERE om.organization_id = $1
     ORDER BY om.joined_at ASC`,
    [organizationId]
  )
  return result.rows
}

export async function getOrganizationMember(
  client: Pool | PoolClient,
  organizationId: string,
  userId: string
): Promise<OrganizationMemberWithUser | null> {
  const result = await client.query<OrganizationMemberWithUser>(
    `SELECT om.*, u.email, u.display_name, u.avatar_url
     FROM organization_members om
     JOIN users u ON om.user_id = u.id
     WHERE om.organization_id = $1 AND om.user_id = $2`,
    [organizationId, userId]
  )
  return result.rows[0] || null
}

export interface AddOrganizationMemberParams {
  organizationId: string
  userId: string
  role: string
}

export async function addOrganizationMember(
  client: Pool | PoolClient,
  params: AddOrganizationMemberParams
): Promise<OrganizationMember> {
  const result = await client.query<OrganizationMember>(
    `INSERT INTO organization_members (organization_id, user_id, role)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [params.organizationId, params.userId, params.role]
  )
  return result.rows[0]
}

export async function updateMemberRole(
  client: Pool | PoolClient,
  organizationId: string,
  userId: string,
  role: string
): Promise<OrganizationMember> {
  const result = await client.query<OrganizationMember>(
    `UPDATE organization_members
     SET role = $3
     WHERE organization_id = $1 AND user_id = $2
     RETURNING *`,
    [organizationId, userId, role]
  )
  return result.rows[0]
}

export async function removeOrganizationMember(
  client: Pool | PoolClient,
  organizationId: string,
  userId: string
): Promise<void> {
  await client.query(
    `DELETE FROM organization_members
     WHERE organization_id = $1 AND user_id = $2`,
    [organizationId, userId]
  )
}

export async function checkUserOrgAccess(
  client: Pool | PoolClient,
  organizationId: string,
  userId: string
): Promise<boolean> {
  const result = await client.query<{ has_access: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM organization_members
       WHERE organization_id = $1 AND user_id = $2
     ) OR EXISTS (
       SELECT 1 FROM organizations
       WHERE id = $1 AND owner_id = $2
     ) AS has_access`,
    [organizationId, userId]
  )
  return result.rows[0]?.has_access || false
}

// ============================================================================
// Invitations
// ============================================================================

export interface CreateInvitationParams {
  organizationId: string
  email: string
  role: string
  token: string
  invitedBy: string
  expiresAt: Date
}

export async function createInvitation(
  client: Pool | PoolClient,
  params: CreateInvitationParams
): Promise<Invitation> {
  const result = await client.query<Invitation>(
    `INSERT INTO invitations (organization_id, email, role, token, invited_by, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      params.organizationId,
      params.email,
      params.role,
      params.token,
      params.invitedBy,
      params.expiresAt,
    ]
  )
  return result.rows[0]
}

export async function getInvitationByToken(
  client: Pool | PoolClient,
  token: string
): Promise<Invitation | null> {
  const result = await client.query<Invitation>(
    `SELECT * FROM invitations
     WHERE token = $1 AND accepted_at IS NULL AND expires_at > NOW()`,
    [token]
  )
  return result.rows[0] || null
}

export async function getOrganizationInvitations(
  client: Pool | PoolClient,
  organizationId: string
): Promise<Invitation[]> {
  const result = await client.query<Invitation>(
    `SELECT * FROM invitations
     WHERE organization_id = $1 AND accepted_at IS NULL
     ORDER BY created_at DESC`,
    [organizationId]
  )
  return result.rows
}

export async function markInvitationAccepted(
  client: Pool | PoolClient,
  id: string
): Promise<void> {
  await client.query(
    `UPDATE invitations
     SET accepted_at = NOW()
     WHERE id = $1`,
    [id]
  )
}

export async function deleteInvitation(
  client: Pool | PoolClient,
  id: string
): Promise<void> {
  await client.query(`DELETE FROM invitations WHERE id = $1`, [id])
}

export async function deleteExpiredInvitations(
  client: Pool | PoolClient
): Promise<void> {
  await client.query(
    `DELETE FROM invitations WHERE expires_at < NOW() AND accepted_at IS NULL`
  )
}
