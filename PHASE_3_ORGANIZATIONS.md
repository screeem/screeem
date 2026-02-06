# Phase 3: Organization CRUD - Complete! ✅

## Overview

Phase 3 implements complete **Organization Management** with traditional REST/CRUD endpoints. This includes:
- 🏢 Organization CRUD operations
- 👥 Member management (add, remove, update roles)
- ✉️ Invitation system (create, accept, revoke)
- 🔒 Role-based access control
- ✅ Full request validation with Zod

## What's Been Built

### 1. Database Queries (`src/db/organizations.ts`)
Type-safe PostgreSQL query functions for:

**Organizations:**
- `getOrganizationById` - Get org by ID
- `getOrganizationBySlug` - Get org by slug
- `createOrganization` - Create new org
- `updateOrganization` - Update org details
- `deleteOrganization` - Delete org
- `getUserOrganizations` - List user's orgs

**Members:**
- `getOrganizationMembers` - List all members
- `getOrganizationMember` - Get specific member
- `addOrganizationMember` - Add member
- `updateMemberRole` - Change member role
- `removeOrganizationMember` - Remove member
- `checkUserOrgAccess` - Verify user has access

**Invitations:**
- `createInvitation` - Create invite
- `getInvitationByToken` - Get invite by token
- `getOrganizationInvitations` - List pending invites
- `markInvitationAccepted` - Mark invite as accepted
- `deleteInvitation` - Delete/revoke invite

### 2. Organization Endpoints (`src/modules/organizations/routes.ts`)

#### `GET /api/organizations`
List all organizations the authenticated user belongs to.

**Response:**
```json
{
  "organizations": [
    {
      "id": "uuid",
      "name": "My Organization",
      "slug": "my-org",
      "ownerId": "uuid",
      "createdAt": "2024-02-05T12:00:00Z",
      "updatedAt": "2024-02-05T12:00:00Z"
    }
  ]
}
```

#### `GET /api/organizations/:id`
Get a specific organization.

**Auth:** Requires membership or ownership

#### `POST /api/organizations`
Create a new organization.

**Request:**
```json
{
  "name": "My Organization",
  "slug": "my-org"
}
```

**Response:** 201 Created with organization object

**Notes:**
- Slug must be unique across all organizations
- Creator is automatically added as owner
- Owner is added to members table with 'owner' role

#### `PATCH /api/organizations/:id`
Update organization details.

**Auth:** Owner only

**Request:**
```json
{
  "name": "Updated Name",
  "slug": "new-slug"
}
```

#### `DELETE /api/organizations/:id`
Delete an organization.

**Auth:** Owner only

**Response:** 204 No Content

### 3. Member Management (`src/modules/organizations/members.ts`)

#### `GET /api/organizations/:id/members`
List all organization members.

**Auth:** Any member can view

**Response:**
```json
{
  "members": [
    {
      "id": "uuid",
      "organizationId": "uuid",
      "userId": "uuid",
      "userEmail": "user@example.com",
      "userDisplayName": "John Doe",
      "role": "owner",
      "joinedAt": "2024-02-05T12:00:00Z"
    }
  ]
}
```

#### `POST /api/organizations/:id/members`
Add a member to the organization.

**Auth:** Owner or admin only

**Request:**
```json
{
  "userId": "uuid",
  "role": "member"
}
```

**Roles:** `owner`, `admin`, `member`

**Response:** 201 Created

#### `PATCH /api/organizations/:id/members/:userId`
Update a member's role.

**Auth:** Owner only

**Request:**
```json
{
  "role": "admin"
}
```

**Notes:**
- Cannot change owner's role
- Only owner can change roles

#### `DELETE /api/organizations/:id/members/:userId`
Remove a member from the organization.

**Auth:**
- Owner can remove anyone
- Members can remove themselves

**Notes:**
- Cannot remove the owner
- Removing yourself leaves the organization

**Response:** 204 No Content

### 4. Invitation System (`src/modules/organizations/invitations.ts`)

#### `POST /api/organizations/:id/invites`
Create an invitation to join the organization.

**Auth:** Owner or admin only

**Request:**
```json
{
  "email": "newuser@example.com",
  "role": "member"
}
```

**Response:**
```json
{
  "id": "uuid",
  "organizationId": "uuid",
  "email": "newuser@example.com",
  "role": "member",
  "expiresAt": "2024-02-12T12:00:00Z",
  "createdAt": "2024-02-05T12:00:00Z"
}
```

**Notes:**
- Invitations expire in 7 days
- Cannot invite existing members
- One pending invite per email

#### `GET /api/organizations/:id/invites`
List all pending invitations.

**Auth:** Any member can view

**Response:**
```json
{
  "invitations": [
    {
      "id": "uuid",
      "organizationId": "uuid",
      "email": "invited@example.com",
      "role": "member",
      "expiresAt": "2024-02-12T12:00:00Z",
      "createdAt": "2024-02-05T12:00:00Z"
    }
  ]
}
```

#### `POST /api/invites/:token/accept`
Accept an invitation to join an organization.

**Auth:** Authenticated user

**Response:**
```json
{
  "organizationId": "uuid",
  "role": "member"
}
```

**Notes:**
- Email must match invitation email
- User is automatically added to organization
- Invitation is marked as accepted

#### `DELETE /api/organizations/:id/invites/:inviteId`
Revoke/delete a pending invitation.

**Auth:** Owner or admin only

**Response:** 204 No Content

## Role-Based Access Control

### Roles

| Role | Can Do |
|------|--------|
| **Owner** | Everything (CRUD org, manage all members, manage invites) |
| **Admin** | Manage members, manage invites, view organization |
| **Member** | View organization, view members, leave organization |

### Permission Matrix

| Action | Owner | Admin | Member |
|--------|-------|-------|--------|
| View organization | ✅ | ✅ | ✅ |
| Update organization | ✅ | ❌ | ❌ |
| Delete organization | ✅ | ❌ | ❌ |
| View members | ✅ | ✅ | ✅ |
| Add members | ✅ | ✅ | ❌ |
| Remove members | ✅ | ❌ | ❌ (self only) |
| Change member roles | ✅ | ❌ | ❌ |
| Create invites | ✅ | ✅ | ❌ |
| View invites | ✅ | ✅ | ✅ |
| Revoke invites | ✅ | ✅ | ❌ |

## API Usage Examples

### Create Organization

```bash
TOKEN="your-supabase-jwt"

curl -X POST http://localhost:3000/api/organizations \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Acme Corp",
    "slug": "acme-corp"
  }'
```

### List Organizations

```bash
curl http://localhost:3000/api/organizations \
  -H "Authorization: Bearer $TOKEN"
```

### Add Member

```bash
curl -X POST http://localhost:3000/api/organizations/ORG_ID/members \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "USER_UUID",
    "role": "admin"
  }'
```

### Create Invitation

```bash
curl -X POST http://localhost:3000/api/organizations/ORG_ID/invites \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "newuser@example.com",
    "role": "member"
  }'
```

### Accept Invitation

```bash
curl -X POST http://localhost:3000/api/invites/INVITE_TOKEN/accept \
  -H "Authorization: Bearer $TOKEN"
```

## Validation

All endpoints use Zod schemas from `@screeem/shared`:

- `createOrganizationSchema` - Validates name and slug
- `updateOrganizationSchema` - Validates optional updates
- `addMemberSchema` - Validates userId and role
- `createInvitationSchema` - Validates email and role
- `memberRoleSchema` - Enum validation for roles

**Example validation error:**
```json
{
  "error": "Invalid request",
  "details": [
    {
      "code": "too_small",
      "minimum": 1,
      "type": "string",
      "path": ["name"],
      "message": "String must contain at least 1 character(s)"
    }
  ]
}
```

## Error Responses

| Status | Error | Description |
|--------|-------|-------------|
| 400 | Invalid request | Request body validation failed |
| 401 | Unauthorized | Missing or invalid authentication token |
| 403 | Access denied / Forbidden | User lacks permission for action |
| 404 | Not found | Organization, member, or invitation not found |
| 409 | Conflict | Slug taken, user already member, duplicate invite |

## Database Schema

```sql
-- Organizations (traditional CRUD)
organizations {
  id UUID PRIMARY KEY
  name VARCHAR(255)
  slug VARCHAR(255) UNIQUE
  owner_id UUID REFERENCES users(id)
  created_at TIMESTAMP
  updated_at TIMESTAMP
  version INTEGER  -- For optimistic locking
}

-- Members
organization_members {
  id UUID PRIMARY KEY
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE
  user_id UUID REFERENCES users(id) ON DELETE CASCADE
  role VARCHAR(50)  -- 'owner', 'admin', 'member'
  joined_at TIMESTAMP
  UNIQUE(organization_id, user_id)
}

-- Invitations
invitations {
  id UUID PRIMARY KEY
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE
  email VARCHAR(255)
  role VARCHAR(50)
  token TEXT UNIQUE
  invited_by UUID REFERENCES users(id)
  expires_at TIMESTAMP
  accepted_at TIMESTAMP NULL
  created_at TIMESTAMP
}
```

## Key Files

```
packages/api/src/
├── db/
│   └── organizations.ts         # Database queries
├── modules/
│   └── organizations/
│       ├── routes.ts            # Organization CRUD
│       ├── members.ts           # Member management
│       └── invitations.ts       # Invitation system
└── index.ts                     # Route registration
```

## Testing Checklist

- [ ] Create organization with valid data
- [ ] Create organization with duplicate slug (should fail)
- [ ] List user's organizations
- [ ] Get organization by ID
- [ ] Update organization (owner only)
- [ ] Delete organization (owner only)
- [ ] List organization members
- [ ] Add member to organization
- [ ] Add duplicate member (should fail)
- [ ] Update member role (owner only)
- [ ] Remove member (owner or self)
- [ ] Cannot remove owner
- [ ] Create invitation
- [ ] Create duplicate invitation (should fail)
- [ ] List invitations
- [ ] Accept invitation
- [ ] Accept invitation with wrong email (should fail)
- [ ] Revoke invitation
- [ ] Non-member cannot access organization

## Security Notes

⚠️ **Important:**

1. **Slug validation**: Slugs must be URL-safe (lowercase, numbers, hyphens only)
2. **Owner protection**: Owner cannot be removed or have role changed
3. **Cascade deletes**: Deleting org removes all members and invitations
4. **Email verification**: Invitation acceptance verifies email match
5. **Token security**: Use nanoid(32) for secure, unpredictable tokens
6. **Expiration**: Invitations expire in 7 days (configurable)

## Future Enhancements

- [ ] Email notifications for invitations
- [ ] Organization avatars/logos
- [ ] Billing/subscription per organization
- [ ] Audit log for organization changes
- [ ] Transfer ownership
- [ ] Organization settings (privacy, features)
- [ ] Member activity tracking

## Next Steps

With organizations complete, you can now:
- **Phase 4**: Implement SSE event streaming (org-scoped)
- **Phase 5**: Build frontend with organization selector
- **Phase 6**: Event-sourced post scheduling (per-organization)
- **Phase 7**: Twitter account connection (per-organization)
