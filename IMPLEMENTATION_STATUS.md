# Screeem Implementation Status

## Phase 1: Foundation ✅ COMPLETED

### What's Been Built

#### 1. Monorepo Structure
- **packages/shared** - Shared types and validators
  - Domain types (User, Organization, Post, etc.)
  - Event types (PostScheduled, PostUpdated, etc.)
  - Command types (SchedulePostCommand, etc.)
  - API request/response types
  - Zod validators for all inputs

- **packages/event-sourcing** - Event sourcing library
  - `Aggregate` base class for event-sourced aggregates
  - `Projection` base class for building read models
  - `PostgreSQLEventStore` implementation with LISTEN/NOTIFY
  - Type-safe event store interface

- **packages/api** - Backend API server
  - Fastify server setup with CORS and cookies
  - Environment variable validation with Zod
  - PostgreSQL connection pool
  - SQL migration system (simple, file-based)
  - Type-safe database query layer
  - Event store integration

#### 2. Database Schema
- SQL migrations in `/packages/api/migrations/001_initial_schema.sql`
- Tables created:
  - **Event Store**: `events`, `snapshots`
  - **Users**: `users`, `magic_links`, `sessions`
  - **Organizations**: `organizations`, `organization_members`, `invitations`
  - **Twitter**: `twitter_accounts`
  - **Posts**: `scheduled_posts` (read model)

#### 3. SQL Queries
Defined in `/packages/api/sql/`:
- `events.sql` - Event store queries
- `users.sql` - User, magic link, and session queries
- `organizations.sql` - Organization and member management
- `posts.sql` - Post projections and Twitter accounts

#### 4. Type-Safe Database Layer
Manual type-safe query functions in `/packages/api/src/db/`:
- `types.ts` - Database row types
- `events.ts` - Event store query functions

## Getting Started

### Prerequisites
- Node.js 18+ (managed by nvm)
- PostgreSQL 16+
- pnpm 10+

### 1. Start PostgreSQL
```bash
docker-compose up -d
```

This starts PostgreSQL on `localhost:5432` with:
- Database: `screeem`
- User: `screeem`
- Password: `screeem_dev_password`

### 2. Configure Environment
```bash
cp .env.example packages/api/.env
# Edit packages/api/.env with your settings
```

### 3. Run Database Migrations
```bash
cd packages/api
pnpm migrate
```

This will:
- Create all database tables
- Set up indexes
- Track applied migrations

### 4. Start the API Server
```bash
cd packages/api
pnpm dev
```

The server will start on `http://localhost:3000` with:
- `/health` - Health check endpoint
- `/` - API info endpoint

### 5. Type Check
```bash
# Check all packages
pnpm -r type-check

# Or individually
cd packages/shared && pnpm type-check
cd packages/event-sourcing && pnpm type-check
cd packages/api && pnpm type-check
```

## Architecture Highlights

### Event Sourcing (Post Scheduling Only)
- **Event Store**: PostgreSQL table with append-only events
- **Stream ID**: Organization ID (each org has its own post timeline)
- **Stream Type**: `post-timeline`
- **Events**: PostScheduled, PostUpdated, PostCancelled, PostPublishing, PostPublished, PostFailed
- **LISTEN/NOTIFY**: Real-time event propagation via PostgreSQL
- **Projections**: `scheduled_posts` table updated by event handlers

### Traditional CRUD (Everything Else)
- Users, sessions, magic links
- Organizations and memberships
- Invitations
- Twitter accounts

### Key Design Decisions

1. **Hybrid Approach**: Event sourcing for posts (complex, needs history), CRUD for everything else (simpler, no need for full audit trail)

2. **SQL Migrations**: Using simple SQL files instead of JavaScript migrations for clarity and portability

3. **Manual Type-Safe Queries**: Instead of sqlc (which has limited TypeScript support), using hand-written type-safe query functions for better control and TypeScript integration

4. **PostgreSQL LISTEN/NOTIFY**: For real-time event propagation to SSE clients without polling

## Project Structure

```
packages/
├── shared/
│   ├── src/
│   │   ├── types/
│   │   │   ├── domain.ts        # Domain entities
│   │   │   ├── events.ts        # Event definitions
│   │   │   ├── commands.ts      # Command definitions
│   │   │   └── api.ts           # API types
│   │   └── validators/
│   │       ├── commands.ts      # Command validators
│   │       └── api.ts           # API validators
│   └── package.json
│
├── event-sourcing/
│   ├── src/
│   │   ├── types.ts             # Core ES types
│   │   ├── aggregate.ts         # Base aggregate class
│   │   ├── projection.ts        # Base projection class
│   │   ├── event-store.ts       # PostgreSQL implementation
│   │   └── index.ts
│   └── package.json
│
└── api/
    ├── src/
    │   ├── index.ts             # Fastify server
    │   ├── config/
    │   │   ├── env.ts           # Environment validation
    │   │   └── database.ts      # PostgreSQL pool
    │   ├── db/
    │   │   ├── types.ts         # Database types
    │   │   └── events.ts        # Event queries
    │   ├── infrastructure/
    │   │   └── event-store/
    │   │       └── index.ts     # Event store instance
    │   └── scripts/
    │       └── migrate.ts       # Migration runner
    ├── migrations/
    │   └── 001_initial_schema.sql
    ├── sql/
    │   ├── schema.sql           # Full schema reference
    │   ├── events.sql           # Event queries
    │   ├── users.sql            # User queries
    │   ├── organizations.sql    # Org queries
    │   └── posts.sql            # Post queries
    └── package.json
```

## Phase 2: Authentication (Supabase) ✅ COMPLETED

**Using Supabase Auth instead of custom magic links!**

### What's Built
- [x] Supabase client configuration
- [x] JWT authentication middleware (fastify.authenticate)
- [x] User sync webhook handler
- [x] Auth endpoints (GET/PATCH /api/auth/me)
- [x] Database schema updated (removed magic_links, sessions)
- [x] Type-safe user database queries

See [PHASE_2_SUPABASE_AUTH.md](./PHASE_2_SUPABASE_AUTH.md) for complete documentation.

## Phase 3: Organization CRUD ✅ COMPLETED

**Traditional REST endpoints for organization management**

### What's Built
- [x] Type-safe database queries for orgs, members, invitations
- [x] Organization CRUD endpoints (create, read, update, delete)
- [x] Member management (add, remove, update roles)
- [x] Invitation system (create, accept, revoke)
- [x] Role-based access control (owner, admin, member)
- [x] Request validation with Zod schemas

**Endpoints:**
- Organizations: GET/POST/PATCH/DELETE `/api/organizations`
- Members: GET/POST/PATCH/DELETE `/api/organizations/:id/members`
- Invitations: GET/POST/DELETE `/api/organizations/:id/invites`, POST `/api/invites/:token/accept`

See [PHASE_3_ORGANIZATIONS.md](./PHASE_3_ORGANIZATIONS.md) for complete documentation.

## Phase 4: Post Event Streaming ✅ COMPLETED

**Event-sourced post scheduling with real-time SSE updates**

### What's Built
- [x] PostTimelineAggregate (event-sourced aggregate)
- [x] Command handlers (SchedulePost, UpdatePost, CancelPost)
- [x] Post projection (updates scheduled_posts read model)
- [x] SSE endpoint for real-time event streaming
- [x] Post query endpoints (list, get by ID)
- [x] Event history with pagination
- [x] Optimistic concurrency control
- [x] PostgreSQL LISTEN/NOTIFY integration

**Endpoints:**
- Commands: POST/PATCH/DELETE `/api/organizations/:id/posts`
- Queries: GET `/api/organizations/:id/posts`
- Events: GET `/api/organizations/:id/posts/events` (SSE)
- History: GET `/api/organizations/:id/posts/events/history`

See [PHASE_4_EVENT_STREAMING.md](./PHASE_4_EVENT_STREAMING.md) for complete documentation.

## Next Steps: Phase 5-9

### Phase 5: Frontend Foundation (Vite + React)
- [ ] Set up web package with Vite
- [ ] TanStack Router configuration
- [ ] Auth pages (magic link flow)
- [ ] API client with TanStack Query
- [ ] SSE client for events
- [ ] Zustand local event store

### Phase 6: Post Scheduling
- [ ] Post timeline aggregate
- [ ] Post command handlers
- [ ] Post projection handlers
- [ ] Post scheduling UI
- [ ] Optimistic updates

### Phase 7: Twitter Integration
- [ ] Twitter OAuth flow
- [ ] Twitter API client
- [ ] Background job for publishing
- [ ] Publish command handler
- [ ] Twitter account UI

### Phase 8: Polish & Docker
- [ ] Error handling
- [ ] Rate limiting
- [ ] Production Dockerfiles
- [ ] Health checks
- [ ] Deployment docs

### Phase 9: Testing
- [ ] Unit tests for aggregates
- [ ] Integration tests for event store
- [ ] API endpoint tests
- [ ] E2E tests (Playwright)

## Available Commands

### Root
```bash
pnpm install          # Install all dependencies
pnpm -r type-check    # Type check all packages
```

### API Package
```bash
cd packages/api
pnpm dev              # Start dev server (hot reload)
pnpm build            # Build for production
pnpm start            # Start production server
pnpm migrate          # Run SQL migrations
pnpm type-check       # TypeScript check
```

### Other Packages
```bash
cd packages/shared (or event-sourcing)
pnpm type-check       # TypeScript check
```

## Database Connection

The API connects to PostgreSQL using the `DATABASE_URL` environment variable:

```
postgresql://screeem:screeem_dev_password@localhost:5432/screeem
```

You can inspect the database with:
```bash
docker exec -it screeem-postgres psql -U screeem -d screeem
```

## Notes

- **No sqlc**: We opted for manual type-safe queries instead of sqlc-gen-typescript due to setup complexity and better TypeScript integration with hand-written code
- **SQL Migrations**: Simpler than node-pg-migrate JavaScript files; easier to read and version control
- **Event Sourcing Scope**: Only post scheduling uses event sourcing; everything else is traditional CRUD for simplicity
- **Real-time**: PostgreSQL LISTEN/NOTIFY provides real-time event propagation without needing Redis or external message brokers
