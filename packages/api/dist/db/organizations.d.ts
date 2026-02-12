/**
 * Type-safe organization database queries
 */
import type { Pool, PoolClient } from 'pg';
import type { Organization, OrganizationMember, OrganizationMemberWithUser, Invitation } from './types.js';
export declare function getOrganizationById(client: Pool | PoolClient, id: string): Promise<Organization | null>;
export declare function getOrganizationBySlug(client: Pool | PoolClient, slug: string): Promise<Organization | null>;
export interface CreateOrganizationParams {
    name: string;
    slug: string;
    ownerId: string;
}
export declare function createOrganization(client: Pool | PoolClient, params: CreateOrganizationParams): Promise<Organization>;
export interface UpdateOrganizationParams {
    name?: string;
    slug?: string;
}
export declare function updateOrganization(client: Pool | PoolClient, id: string, params: UpdateOrganizationParams): Promise<Organization>;
export declare function deleteOrganization(client: Pool | PoolClient, id: string): Promise<void>;
export declare function getUserOrganizations(client: Pool | PoolClient, userId: string): Promise<Organization[]>;
export declare function getOrganizationMembers(client: Pool | PoolClient, organizationId: string): Promise<OrganizationMemberWithUser[]>;
export declare function getOrganizationMember(client: Pool | PoolClient, organizationId: string, userId: string): Promise<OrganizationMemberWithUser | null>;
export interface AddOrganizationMemberParams {
    organizationId: string;
    userId: string;
    role: string;
}
export declare function addOrganizationMember(client: Pool | PoolClient, params: AddOrganizationMemberParams): Promise<OrganizationMember>;
export declare function updateMemberRole(client: Pool | PoolClient, organizationId: string, userId: string, role: string): Promise<OrganizationMember>;
export declare function removeOrganizationMember(client: Pool | PoolClient, organizationId: string, userId: string): Promise<void>;
export declare function checkUserOrgAccess(client: Pool | PoolClient, organizationId: string, userId: string): Promise<boolean>;
export interface CreateInvitationParams {
    organizationId: string;
    email: string;
    role: string;
    token: string;
    invitedBy: string;
    expiresAt: Date;
}
export declare function createInvitation(client: Pool | PoolClient, params: CreateInvitationParams): Promise<Invitation>;
export declare function getInvitationByToken(client: Pool | PoolClient, token: string): Promise<Invitation | null>;
export declare function getOrganizationInvitations(client: Pool | PoolClient, organizationId: string): Promise<Invitation[]>;
export declare function markInvitationAccepted(client: Pool | PoolClient, id: string): Promise<void>;
export declare function deleteInvitation(client: Pool | PoolClient, id: string): Promise<void>;
export declare function deleteExpiredInvitations(client: Pool | PoolClient): Promise<void>;
//# sourceMappingURL=organizations.d.ts.map