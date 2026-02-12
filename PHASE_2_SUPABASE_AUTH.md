# Phase 2: Supabase Authentication - Complete! ✅

## Overview

Phase 2 implements authentication using **Supabase Auth** instead of custom magic links. This provides:
- 🔐 Production-ready authentication
- 📧 Magic link email auth (handled by Supabase)
- 🔑 JWT token-based API authentication
- 👤 User profile management
- 🔄 Automatic user sync from Supabase to local database

## What's Been Built

### 1. Supabase Configuration
- **Client Setup**: Admin and regular Supabase clients (`src/config/supabase.ts`)
- **Environment**: Supabase URL, anon key, service role key, JWT secret
- **Dependencies**: `@supabase/supabase-js` and `@fastify/jwt`

### 2. JWT Authentication Middleware
- **Plugin**: `src/plugins/auth.ts`
- **Decorators**:
  - `fastify.authenticate` - Requires valid Supabase JWT
  - `fastify.optionalAuth` - Optionally attaches user if token present
- **User Attachment**: `request.supabaseUser` contains authenticated user

### 3. Database Schema Updates
- **Removed Tables**: `magic_links`, `sessions` (handled by Supabase)
- **Updated Users Table**: ID matches Supabase auth.users.id (UUID)
- **User Sync**: Local users table keeps minimal profile data

### 4. User Sync System
- **Webhook Handler**: `src/modules/auth/webhook.ts`
- **Automatic Sync**: Supabase webhooks keep local users in sync
- **Upsert Logic**: Creates/updates users on INSERT/UPDATE, deletes on DELETE

### 5. Authentication Endpoints
- `GET /api/auth/me` - Get current user (syncs to local DB)
- `PATCH /api/auth/me` - Update user profile (display name, avatar)
- `POST /api/webhooks/supabase/auth` - Supabase webhook receiver

### 6. Database Queries
- **File**: `src/db/users.ts`
- **Functions**: getUserById, getUserByEmail, createUser, updateUser, upsertUser, deleteUser

## Setup Guide

### 1. Create Supabase Project

1. Go to [supabase.com](https://supabase.com) and create a new project
2. Wait for project to be provisioned
3. Go to Project Settings > API

### 2. Configure Environment Variables

Update `packages/api/.env`:

```bash
# Supabase Auth
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_ANON_KEY=your-anon-key-here
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
SUPABASE_JWT_SECRET=your-jwt-secret-here
```

**Where to find these values:**
- **SUPABASE_URL**: Project Settings > API > Project URL
- **SUPABASE_ANON_KEY**: Project Settings > API > Project API keys > `anon` `public`
- **SUPABASE_SERVICE_ROLE_KEY**: Project Settings > API > Project API keys > `service_role` `secret`
- **SUPABASE_JWT_SECRET**: Project Settings > API > JWT Settings > JWT Secret

### 3. Configure Supabase Webhook (Optional)

To automatically sync Supabase users to your local database:

1. Go to Database > Webhooks in Supabase dashboard
2. Create new webhook:
   - **Name**: Sync users to API
   - **Table**: `auth.users`
   - **Events**: INSERT, UPDATE, DELETE
   - **Type**: HTTP Request
   - **Method**: POST
   - **URL**: `https://your-api-domain.com/api/webhooks/supabase/auth`
   - **Headers**: (none required for now)

**Note**: Users are also automatically synced when they call `/api/auth/me`

### 4. Enable Email Auth in Supabase

1. Go to Authentication > Providers
2. Enable **Email** provider
3. Configure email templates (optional):
   - Authentication > Email Templates
   - Customize magic link email template

## API Usage

### Frontend Authentication Flow

```typescript
// 1. User requests magic link
import { supabase } from './supabase-client'

const { error } = await supabase.auth.signInWithOtp({
  email: 'user@example.com',
  options: {
    emailRedirectTo: 'http://localhost:5173/auth/callback'
  }
})

// 2. User clicks link in email, gets redirected with token
// Supabase automatically handles the token exchange

// 3. Get session and JWT token
const { data: { session } } = await supabase.auth.getSession()
const token = session?.access_token

// 4. Use token for API requests
fetch('http://localhost:3000/api/auth/me', {
  headers: {
    'Authorization': `Bearer ${token}`
  }
})
```

### Protected Routes Example

```typescript
// In your API route
fastify.get(
  '/api/organizations',
  {
    onRequest: [fastify.authenticate] // Requires auth
  },
  async (request, reply) => {
    const userId = request.supabaseUser!.id
    // ... your logic
  }
)
```

### Testing with cURL

```bash
# Get your token from Supabase (after signing in via frontend)
TOKEN="your-jwt-token"

# Get current user
curl http://localhost:3000/api/auth/me \
  -H "Authorization: Bearer $TOKEN"

# Update profile
curl -X PATCH http://localhost:3000/api/auth/me \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"displayName":"John Doe","avatarUrl":"https://example.com/avatar.jpg"}'
```

## Architecture

### Authentication Flow

```
┌─────────┐         ┌──────────┐         ┌─────────┐
│ Frontend│         │ Supabase │         │   API   │
└────┬────┘         └────┬─────┘         └────┬────┘
     │                   │                    │
     │ 1. signInWithOtp  │                    │
     ├──────────────────>│                    │
     │                   │ 2. Send magic link │
     │                   │  ───────>          │
     │ 3. Click link     │                    │
     ├──────────────────>│                    │
     │<──────────────────┤ 4. Return JWT      │
     │    JWT token      │                    │
     │                   │                    │
     │ 5. API Request with Bearer token       │
     ├───────────────────────────────────────>│
     │                   │ 6. Verify JWT      │
     │                   │<───────────────────┤
     │                   │ 7. User data       │
     │                   ├───────────────────>│
     │                   │                    │
     │<───────────────────────────────────────┤
     │              8. API Response           │
```

### User Sync Flow

```
┌──────────┐         ┌──────────────┐         ┌─────────┐
│ Supabase │         │ Auth Webhook │         │Local DB │
└────┬─────┘         └──────┬───────┘         └────┬────┘
     │                      │                      │
     │ User signs up        │                      │
     │ (auth.users INSERT)  │                      │
     ├─────────────────────>│                      │
     │                      │ Upsert user          │
     │                      ├─────────────────────>│
     │                      │                      │
     │ User updates profile │                      │
     │ (auth.users UPDATE)  │                      │
     ├─────────────────────>│                      │
     │                      │ Upsert user          │
     │                      ├─────────────────────>│
```

## Key Files

```
packages/api/src/
├── config/
│   └── supabase.ts              # Supabase client setup
├── plugins/
│   └── auth.ts                  # JWT authentication middleware
├── modules/
│   └── auth/
│       ├── routes.ts            # /api/auth/* endpoints
│       └── webhook.ts           # Supabase webhook handler
├── db/
│   └── users.ts                 # User database queries
└── index.ts                     # Route registration
```

## Security Notes

⚠️ **Important Security Considerations:**

1. **Never expose service role key** on frontend - it bypasses RLS
2. **Use anon key** for frontend Supabase client
3. **JWT secret** must match between Supabase and API
4. **Webhook endpoint** should validate requests (add signature verification in production)
5. **HTTPS only** in production for auth endpoints

## Benefits of Supabase Auth

✅ **vs Custom Magic Links:**
- Email delivery handled by Supabase
- Email templates with customization
- Rate limiting built-in
- Production-ready infrastructure
- OAuth providers ready (Google, GitHub, etc.)
- User management dashboard
- Audit logs

## Next Steps

With authentication complete, you can now:
1. **Phase 3**: Build organization CRUD endpoints (uses authenticated user)
2. **Phase 4**: Implement SSE event streaming (requires auth)
3. **Phase 5**: Build frontend with Supabase Auth UI
4. **Phase 6**: Event-sourced post scheduling

## Troubleshooting

**"Invalid token" error:**
- Check JWT secret matches Supabase project
- Verify token hasn't expired (default 1 hour)
- Ensure token is sent in `Authorization: Bearer <token>` header

**Webhook not syncing users:**
- Verify webhook URL is publicly accessible
- Check API logs for webhook errors
- Test webhook manually with curl

**User not found in local database:**
- Webhook might not be configured
- User will be auto-created on first `/api/auth/me` call

## Testing Checklist

- [ ] User can request magic link via Supabase
- [ ] User receives email with magic link
- [ ] Magic link redirects and provides JWT
- [ ] JWT token validates on `/api/auth/me`
- [ ] User syncs to local database
- [ ] Profile update works via `/api/auth/me`
- [ ] Webhook syncs new users
- [ ] Protected routes reject requests without token
- [ ] Protected routes reject invalid tokens
