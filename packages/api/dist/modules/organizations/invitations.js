/**
 * Organization invitation routes
 */
import { nanoid } from 'nanoid';
import { pool } from '../../config/database.js';
import { createInvitationSchema } from '@screeem/shared';
import { getOrganizationById, getOrganizationMember, createInvitation, getInvitationByToken, getOrganizationInvitations, markInvitationAccepted, deleteInvitation, addOrganizationMember, checkUserOrgAccess, } from '../../db/organizations.js';
import { getUserByEmail, upsertUser } from '../../db/users.js';
export async function registerInvitationRoutes(fastify) {
    // Create invitation
    fastify.post('/api/organizations/:id/invites', {
        onRequest: [fastify.authenticate],
    }, async (request, reply) => {
        const { id } = request.params;
        const userId = request.supabaseUser.id;
        const organization = await getOrganizationById(pool, id);
        if (!organization) {
            return reply.status(404).send({ error: 'Organization not found' });
        }
        // Check if user is owner or admin
        const currentMember = await getOrganizationMember(pool, id, userId);
        const isOwner = organization.owner_id === userId;
        const isAdmin = currentMember?.role === 'admin';
        if (!isOwner && !isAdmin) {
            return reply.status(403).send({ error: 'Only owner or admin can invite members' });
        }
        // Validate request body
        const validation = createInvitationSchema.safeParse(request.body);
        if (!validation.success) {
            return reply.status(400).send({
                error: 'Invalid request',
                details: validation.error.issues,
            });
        }
        const { email, role } = validation.data;
        // Check if user with email already exists and is a member
        const existingUser = await getUserByEmail(pool, email);
        if (existingUser) {
            const existingMember = await getOrganizationMember(pool, id, existingUser.id);
            if (existingMember) {
                return reply.status(409).send({ error: 'User is already a member' });
            }
        }
        // Check for existing pending invitation
        const existingInvites = await getOrganizationInvitations(pool, id);
        const duplicateInvite = existingInvites.find((inv) => inv.email === email);
        if (duplicateInvite) {
            return reply.status(409).send({ error: 'Invitation already sent to this email' });
        }
        // Create invitation token
        const token = nanoid(32);
        // Set expiration to 7 days
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 7);
        const invitation = await createInvitation(pool, {
            organizationId: id,
            email,
            role,
            token,
            invitedBy: userId,
            expiresAt,
        });
        // TODO: Send invitation email with link
        // const inviteLink = `${env.FRONTEND_URL}/invites/${token}`
        // await sendInvitationEmail(email, organization.name, inviteLink)
        return reply.status(201).send({
            id: invitation.id,
            organizationId: invitation.organization_id,
            email: invitation.email,
            role: invitation.role,
            expiresAt: invitation.expires_at.toISOString(),
            createdAt: invitation.created_at.toISOString(),
        });
    });
    // List organization invitations
    fastify.get('/api/organizations/:id/invites', {
        onRequest: [fastify.authenticate],
    }, async (request, reply) => {
        const { id } = request.params;
        const userId = request.supabaseUser.id;
        // Check access
        const hasAccess = await checkUserOrgAccess(pool, id, userId);
        if (!hasAccess) {
            return reply.status(403).send({ error: 'Access denied' });
        }
        const invitations = await getOrganizationInvitations(pool, id);
        return reply.send({
            invitations: invitations.map((inv) => ({
                id: inv.id,
                organizationId: inv.organization_id,
                email: inv.email,
                role: inv.role,
                expiresAt: inv.expires_at.toISOString(),
                createdAt: inv.created_at.toISOString(),
            })),
        });
    });
    // Accept invitation
    fastify.post('/api/invites/:token/accept', {
        onRequest: [fastify.authenticate],
    }, async (request, reply) => {
        const { token } = request.params;
        const userId = request.supabaseUser.id;
        const userEmail = request.supabaseUser.email;
        const invitation = await getInvitationByToken(pool, token);
        if (!invitation) {
            return reply.status(404).send({ error: 'Invalid or expired invitation' });
        }
        // Verify email matches
        if (invitation.email !== userEmail) {
            return reply.status(403).send({
                error: 'This invitation was sent to a different email address',
            });
        }
        // Ensure user exists locally (sync from Supabase)
        await upsertUser(pool, {
            id: userId,
            email: userEmail,
            displayName: null,
            avatarUrl: null,
        });
        // Check if already a member
        const existingMember = await getOrganizationMember(pool, invitation.organization_id, userId);
        if (existingMember) {
            // Mark invitation as accepted anyway
            await markInvitationAccepted(pool, invitation.id);
            return reply.status(409).send({ error: 'You are already a member' });
        }
        // Add user to organization
        await addOrganizationMember(pool, {
            organizationId: invitation.organization_id,
            userId,
            role: invitation.role,
        });
        // Mark invitation as accepted
        await markInvitationAccepted(pool, invitation.id);
        return reply.send({
            organizationId: invitation.organization_id,
            role: invitation.role,
        });
    });
    // Delete/revoke invitation
    fastify.delete('/api/organizations/:id/invites/:inviteId', {
        onRequest: [fastify.authenticate],
    }, async (request, reply) => {
        const { id, inviteId } = request.params;
        const userId = request.supabaseUser.id;
        const organization = await getOrganizationById(pool, id);
        if (!organization) {
            return reply.status(404).send({ error: 'Organization not found' });
        }
        // Check if user is owner or admin
        const currentMember = await getOrganizationMember(pool, id, userId);
        const isOwner = organization.owner_id === userId;
        const isAdmin = currentMember?.role === 'admin';
        if (!isOwner && !isAdmin) {
            return reply.status(403).send({ error: 'Only owner or admin can revoke invitations' });
        }
        await deleteInvitation(pool, inviteId);
        return reply.status(204).send();
    });
}
