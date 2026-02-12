/**
 * Type-safe organization database queries
 */
// ============================================================================
// Organizations
// ============================================================================
export async function getOrganizationById(client, id) {
    const result = await client.query(`SELECT * FROM organizations WHERE id = $1`, [id]);
    return result.rows[0] || null;
}
export async function getOrganizationBySlug(client, slug) {
    const result = await client.query(`SELECT * FROM organizations WHERE slug = $1`, [slug]);
    return result.rows[0] || null;
}
export async function createOrganization(client, params) {
    const result = await client.query(`INSERT INTO organizations (name, slug, owner_id)
     VALUES ($1, $2, $3)
     RETURNING *`, [params.name, params.slug, params.ownerId]);
    return result.rows[0];
}
export async function updateOrganization(client, id, params) {
    const result = await client.query(`UPDATE organizations
     SET name = COALESCE($2, name),
         slug = COALESCE($3, slug),
         updated_at = NOW(),
         version = version + 1
     WHERE id = $1
     RETURNING *`, [id, params.name, params.slug]);
    return result.rows[0];
}
export async function deleteOrganization(client, id) {
    await client.query(`DELETE FROM organizations WHERE id = $1`, [id]);
}
export async function getUserOrganizations(client, userId) {
    const result = await client.query(`SELECT DISTINCT o.*
     FROM organizations o
     LEFT JOIN organization_members om ON o.id = om.organization_id
     WHERE o.owner_id = $1 OR om.user_id = $1
     ORDER BY o.created_at DESC`, [userId]);
    return result.rows;
}
// ============================================================================
// Members
// ============================================================================
export async function getOrganizationMembers(client, organizationId) {
    const result = await client.query(`SELECT om.*, u.email, u.display_name, u.avatar_url
     FROM organization_members om
     JOIN users u ON om.user_id = u.id
     WHERE om.organization_id = $1
     ORDER BY om.joined_at ASC`, [organizationId]);
    return result.rows;
}
export async function getOrganizationMember(client, organizationId, userId) {
    const result = await client.query(`SELECT om.*, u.email, u.display_name, u.avatar_url
     FROM organization_members om
     JOIN users u ON om.user_id = u.id
     WHERE om.organization_id = $1 AND om.user_id = $2`, [organizationId, userId]);
    return result.rows[0] || null;
}
export async function addOrganizationMember(client, params) {
    const result = await client.query(`INSERT INTO organization_members (organization_id, user_id, role)
     VALUES ($1, $2, $3)
     RETURNING *`, [params.organizationId, params.userId, params.role]);
    return result.rows[0];
}
export async function updateMemberRole(client, organizationId, userId, role) {
    const result = await client.query(`UPDATE organization_members
     SET role = $3
     WHERE organization_id = $1 AND user_id = $2
     RETURNING *`, [organizationId, userId, role]);
    return result.rows[0];
}
export async function removeOrganizationMember(client, organizationId, userId) {
    await client.query(`DELETE FROM organization_members
     WHERE organization_id = $1 AND user_id = $2`, [organizationId, userId]);
}
export async function checkUserOrgAccess(client, organizationId, userId) {
    const result = await client.query(`SELECT EXISTS (
       SELECT 1 FROM organization_members
       WHERE organization_id = $1 AND user_id = $2
     ) OR EXISTS (
       SELECT 1 FROM organizations
       WHERE id = $1 AND owner_id = $2
     ) AS has_access`, [organizationId, userId]);
    return result.rows[0]?.has_access || false;
}
export async function createInvitation(client, params) {
    const result = await client.query(`INSERT INTO invitations (organization_id, email, role, token, invited_by, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`, [
        params.organizationId,
        params.email,
        params.role,
        params.token,
        params.invitedBy,
        params.expiresAt,
    ]);
    return result.rows[0];
}
export async function getInvitationByToken(client, token) {
    const result = await client.query(`SELECT * FROM invitations
     WHERE token = $1 AND accepted_at IS NULL AND expires_at > NOW()`, [token]);
    return result.rows[0] || null;
}
export async function getOrganizationInvitations(client, organizationId) {
    const result = await client.query(`SELECT * FROM invitations
     WHERE organization_id = $1 AND accepted_at IS NULL
     ORDER BY created_at DESC`, [organizationId]);
    return result.rows;
}
export async function markInvitationAccepted(client, id) {
    await client.query(`UPDATE invitations
     SET accepted_at = NOW()
     WHERE id = $1`, [id]);
}
export async function deleteInvitation(client, id) {
    await client.query(`DELETE FROM invitations WHERE id = $1`, [id]);
}
export async function deleteExpiredInvitations(client) {
    await client.query(`DELETE FROM invitations WHERE expires_at < NOW() AND accepted_at IS NULL`);
}
