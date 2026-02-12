-- Organization queries

-- name: GetOrganizationByID :one
SELECT * FROM organizations WHERE id = $1;

-- name: GetOrganizationBySlug :one
SELECT * FROM organizations WHERE slug = $1;

-- name: CreateOrganization :one
INSERT INTO organizations (name, slug, owner_id)
VALUES ($1, $2, $3)
RETURNING *;

-- name: UpdateOrganization :one
UPDATE organizations
SET name = COALESCE($2, name),
    slug = COALESCE($3, slug),
    updated_at = NOW(),
    version = version + 1
WHERE id = $1
RETURNING *;

-- name: DeleteOrganization :exec
DELETE FROM organizations WHERE id = $1;

-- name: GetUserOrganizations :many
SELECT DISTINCT o.*
FROM organizations o
LEFT JOIN organization_members om ON o.id = om.organization_id
WHERE o.owner_id = $1 OR om.user_id = $1
ORDER BY o.created_at DESC;

-- Organization member queries

-- name: GetOrganizationMembers :many
SELECT om.*, u.email, u.display_name, u.avatar_url
FROM organization_members om
JOIN users u ON om.user_id = u.id
WHERE om.organization_id = $1
ORDER BY om.joined_at ASC;

-- name: GetOrganizationMember :one
SELECT om.*, u.email, u.display_name, u.avatar_url
FROM organization_members om
JOIN users u ON om.user_id = u.id
WHERE om.organization_id = $1 AND om.user_id = $2;

-- name: AddOrganizationMember :one
INSERT INTO organization_members (organization_id, user_id, role)
VALUES ($1, $2, $3)
RETURNING *;

-- name: UpdateMemberRole :one
UPDATE organization_members
SET role = $3
WHERE organization_id = $1 AND user_id = $2
RETURNING *;

-- name: RemoveOrganizationMember :exec
DELETE FROM organization_members
WHERE organization_id = $1 AND user_id = $2;

-- name: CheckUserOrgAccess :one
SELECT EXISTS (
  SELECT 1 FROM organization_members
  WHERE organization_id = $1 AND user_id = $2
) OR EXISTS (
  SELECT 1 FROM organizations
  WHERE id = $1 AND owner_id = $2
) AS has_access;

-- Invitation queries

-- name: CreateInvitation :one
INSERT INTO invitations (organization_id, email, role, token, invited_by, expires_at)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: GetInvitationByToken :one
SELECT * FROM invitations
WHERE token = $1 AND accepted_at IS NULL AND expires_at > NOW();

-- name: GetOrganizationInvitations :many
SELECT * FROM invitations
WHERE organization_id = $1 AND accepted_at IS NULL
ORDER BY created_at DESC;

-- name: MarkInvitationAccepted :exec
UPDATE invitations
SET accepted_at = NOW()
WHERE id = $1;

-- name: DeleteInvitation :exec
DELETE FROM invitations WHERE id = $1;

-- name: DeleteExpiredInvitations :exec
DELETE FROM invitations WHERE expires_at < NOW() AND accepted_at IS NULL;
