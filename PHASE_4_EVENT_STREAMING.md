# Phase 4: Post Event Streaming - Complete! ✅

## Overview

Phase 4 implements **Event-Sourced Post Scheduling** with real-time SSE updates. This is the core of the platform where event sourcing provides:
- 📝 Complete audit trail of all post changes
- ⚡ Real-time updates via Server-Sent Events (SSE)
- 🔄 CQRS pattern (commands write events, queries read projections)
- 🎯 Optimistic concurrency control
- 📊 Event history with pagination

## What's Been Built

### 1. Post Timeline Aggregate (`src/domain/aggregates/post-timeline.ts`)

Event-sourced aggregate managing all posts for an organization.

**Commands:**
- `schedulePost()` - Create new scheduled post
- `updatePost()` - Update existing post
- `cancelPost()` - Cancel scheduled post

**Validation:**
- Content: 1-280 characters
- Scheduled time must be in future
- Max 4 media attachments
- Can only update/cancel scheduled posts

**State Management:**
- Loads state from event history
- Produces events for commands
- Maintains in-memory post collection

### 2. Command Handlers (`src/domain/commands/post-commands.ts`)

Handle commands with optimistic concurrency control:

```typescript
// Command flow:
1. Load aggregate from event store
2. Replay events to rebuild state
3. Execute command (produces events)
4. Persist events with version check
5. Events trigger projections via LISTEN/NOTIFY
6. Events stream to clients via SSE
```

**Handlers:**
- `handleSchedulePost()` - Returns `{postId, eventId}`
- `handleUpdatePost()` - Returns `{eventId}`
- `handleCancelPost()` - Returns `{eventId}`

### 3. Post Projection (`src/domain/projections/posts-projection.ts`)

Updates `scheduled_posts` table from events.

**Event Handlers:**
- `PostScheduled` → INSERT into scheduled_posts
- `PostUpdated` → UPDATE content and scheduled_for
- `PostCancelled` → UPDATE status to 'cancelled'

**Auto-start:**
- Subscribes to PostgreSQL LISTEN/NOTIFY
- Processes events in real-time
- Keeps read model in sync

### 4. SSE Event Stream (`src/modules/posts/events.ts`)

Real-time post event streaming.

**Endpoint:** `GET /api/organizations/:id/posts/events`

**Features:**
- Server-Sent Events (SSE) protocol
- Organization-scoped (only see your org's events)
- Auto-reconnect support
- Event filtering by stream type

**SSE Format:**
```
id: event-uuid
event: PostScheduled
data: {"id":"...","type":"PostScheduled","payload":{...},"timestamp":"..."}

```

### 5. Post Endpoints (`src/modules/posts/routes.ts`)

#### Commands (Write Side)

**`POST /api/organizations/:id/posts`** - Schedule Post
```json
{
  "content": "Hello Twitter!",
  "scheduledFor": "2024-02-10T15:00:00Z",
  "mediaUrls": ["https://example.com/image.jpg"]
}
```

Response: `201 Created`
```json
{
  "postId": "uuid",
  "eventId": "uuid"
}
```

**`PATCH /api/organizations/:id/posts/:postId`** - Update Post
```json
{
  "content": "Updated content",
  "scheduledFor": "2024-02-10T16:00:00Z"
}
```

**`DELETE /api/organizations/:id/posts/:postId`** - Cancel Post
```json
{
  "reason": "Changed my mind"
}
```

#### Queries (Read Side)

**`GET /api/organizations/:id/posts`** - List Posts

Query params:
- `status` - Filter by status (scheduled, cancelled, published, failed)
- `page` - Page number (default: 1)
- `pageSize` - Items per page (default: 50, max: 100)

Response:
```json
{
  "posts": [{
    "id": "uuid",
    "organizationId": "uuid",
    "createdBy": "uuid",
    "createdByName": "John Doe",
    "content": "Hello Twitter!",
    "mediaUrls": [],
    "scheduledFor": "2024-02-10T15:00:00Z",
    "status": "scheduled",
    "publishedAt": null,
    "twitterResult": null,
    "createdAt": "2024-02-05T12:00:00Z",
    "updatedAt": "2024-02-05T12:00:00Z"
  }],
  "pagination": {
    "total": 42,
    "page": 1,
    "pageSize": 50,
    "totalPages": 1
  }
}
```

**`GET /api/organizations/:id/posts/:postId`** - Get Single Post

Returns single post object with same structure.

**`GET /api/organizations/:id/posts/events/history`** - Event History

Query params:
- `page` - Page number
- `pageSize` - Events per page (max: 100)

Response:
```json
{
  "events": [{
    "id": "uuid",
    "eventType": "PostScheduled",
    "payload": {...},
    "metadata": {
      "userId": "uuid",
      "timestamp": "2024-02-05T12:00:00Z"
    },
    "sequence": 1,
    "createdAt": "2024-02-05T12:00:00Z"
  }],
  "pagination": {
    "total": 100,
    "page": 1,
    "pageSize": 50,
    "totalPages": 2
  }
}
```

## Event Sourcing Architecture

### Event Types

```typescript
// Defined in @screeem/shared/types/events.ts
POST_EVENT_TYPES = {
  POST_SCHEDULED: 'PostScheduled',
  POST_UPDATED: 'PostUpdated',
  POST_CANCELLED: 'PostCancelled',
  POST_PUBLISHING: 'PostPublishing',  // Phase 7
  POST_PUBLISHED: 'PostPublished',    // Phase 7
  POST_FAILED: 'PostFailed',          // Phase 7
}
```

### Event Flow

```
┌─────────┐    Command    ┌───────────┐    Events    ┌──────────┐
│ Client  │──────────────>│ Aggregate │─────────────>│   Event  │
│         │               │           │              │  Store   │
└─────────┘               └───────────┘              └────┬─────┘
     │                                                     │
     │                                   ┌─────────────────┴──────────┐
     │                                   │                            │
     │        SSE Stream           ┌─────▼─────┐             ┌───────▼────────┐
     │<────────────────────────────│ LISTEN/   │             │   Projection   │
     │                             │  NOTIFY   │             │   (Read Model) │
     │                             └───────────┘             └───────┬────────┘
     │                                                                │
     │        Query                                            ┌──────▼────────┐
     │<────────────────────────────────────────────────────────│scheduled_posts│
     │                                                         └───────────────┘
```

### Stream Structure

- **Stream ID**: Organization ID
- **Stream Type**: `post-timeline`
- **Events**: Append-only log of all post actions
- **Sequence**: Per-stream ordering (1, 2, 3...)

### Optimistic Concurrency

```typescript
// Version check on append
aggregate.version = 5  // Current version after loading events

aggregate.schedulePost(...)  // Produces event #6

await eventStore.append(
  organizationId,
  'post-timeline',
  [newEvent],
  5  // Expected version - fails if != current version
)
```

If another process appended events in the meantime, this fails with concurrency error.

## API Usage Examples

### Schedule a Post

```bash
TOKEN="your-supabase-jwt"
ORG_ID="your-org-id"

curl -X POST http://localhost:3000/api/organizations/$ORG_ID/posts \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Check out our new feature!",
    "scheduledFor": "2024-02-10T15:00:00Z",
    "mediaUrls": ["https://example.com/image.jpg"]
  }'
```

### Update a Post

```bash
POST_ID="post-uuid"

curl -X PATCH http://localhost:3000/api/organizations/$ORG_ID/posts/$POST_ID \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Updated content!",
    "scheduledFor": "2024-02-10T16:00:00Z"
  }'
```

### Cancel a Post

```bash
curl -X DELETE http://localhost:3000/api/organizations/$ORG_ID/posts/$POST_ID \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "reason": "Plans changed"
  }'
```

### List Posts

```bash
# All posts
curl http://localhost:3000/api/organizations/$ORG_ID/posts \
  -H "Authorization: Bearer $TOKEN"

# Filter by status
curl "http://localhost:3000/api/organizations/$ORG_ID/posts?status=scheduled" \
  -H "Authorization: Bearer $TOKEN"

# Pagination
curl "http://localhost:3000/api/organizations/$ORG_ID/posts?page=2&pageSize=20" \
  -H "Authorization: Bearer $TOKEN"
```

### SSE Event Stream (JavaScript)

```javascript
const eventSource = new EventSource(
  `http://localhost:3000/api/organizations/${orgId}/posts/events`,
  {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  }
)

eventSource.addEventListener('PostScheduled', (e) => {
  const event = JSON.parse(e.data)
  console.log('Post scheduled:', event.payload)
})

eventSource.addEventListener('PostUpdated', (e) => {
  const event = JSON.parse(e.data)
  console.log('Post updated:', event.payload)
})

eventSource.onerror = (error) => {
  console.error('SSE error:', error)
  // EventSource will auto-reconnect
}
```

### Event History

```bash
curl "http://localhost:3000/api/organizations/$ORG_ID/posts/events/history?page=1&pageSize=20" \
  -H "Authorization: Bearer $TOKEN"
```

## Key Files

```
packages/api/src/
├── domain/
│   ├── aggregates/
│   │   └── post-timeline.ts     # Event-sourced aggregate
│   ├── commands/
│   │   └── post-commands.ts     # Command handlers
│   └── projections/
│       └── posts-projection.ts  # Read model projection
└── modules/
    └── posts/
        ├── routes.ts            # Command & query endpoints
        └── events.ts            # SSE streaming & history
```

## Database Schema

```sql
-- Events table (append-only)
events {
  id UUID
  stream_id UUID              -- Organization ID
  stream_type VARCHAR(50)     -- 'post-timeline'
  event_type VARCHAR(100)     -- 'PostScheduled', etc.
  payload JSONB               -- Event data
  metadata JSONB              -- userId, timestamp
  sequence BIGSERIAL          -- Global sequence
  stream_sequence INT         -- Per-stream sequence
  created_at TIMESTAMP
}

-- Read model (projected from events)
scheduled_posts {
  id UUID                     -- From PostScheduled.postId
  organization_id UUID
  created_by UUID
  content TEXT
  media_urls JSONB
  scheduled_for TIMESTAMP
  status VARCHAR(50)          -- scheduled, cancelled, published, failed
  published_at TIMESTAMP
  twitter_result JSONB
  created_at TIMESTAMP
  updated_at TIMESTAMP
  version INT                 -- For optimistic locking on read model
}
```

## Benefits of Event Sourcing

✅ **Complete Audit Trail**
- Every post change is recorded
- Can answer "who changed what when"
- Replay events to debug issues

✅ **Real-Time Updates**
- Events trigger SSE immediately
- All connected clients get updates
- No polling required

✅ **CQRS Pattern**
- Commands validated by aggregate
- Queries optimized for reads
- Scales independently

✅ **Time Travel**
- Rebuild state at any point
- Event history pagination
- Analytics from event stream

✅ **Concurrency Control**
- Optimistic locking prevents conflicts
- Multiple users can work safely
- Last-write-wins avoided

## Testing Checklist

- [ ] Schedule post with valid data
- [ ] Schedule post with content > 280 chars (should fail)
- [ ] Schedule post in the past (should fail)
- [ ] Schedule post with > 4 media (should fail)
- [ ] Update scheduled post
- [ ] Update non-existent post (should fail)
- [ ] Update cancelled post (should fail)
- [ ] Cancel scheduled post
- [ ] Cancel already cancelled post (should fail)
- [ ] List all posts with pagination
- [ ] Filter posts by status
- [ ] Get single post by ID
- [ ] SSE connection receives events in real-time
- [ ] SSE reconnects after disconnect
- [ ] Event history pagination
- [ ] Concurrent post updates (version conflict)
- [ ] Projection updates read model correctly

## Security Notes

⚠️ **Important:**

1. **Authentication**: All endpoints require valid Supabase JWT
2. **Authorization**: Users must be org members to access posts
3. **Input Validation**: Zod schemas validate all commands
4. **SSE Security**: CORS enforced, org-scoped events only
5. **Concurrency**: Version checks prevent race conditions

## Performance Considerations

**SSE Connections:**
- Each client has one long-lived connection
- Filtered server-side (only org's events sent)
- Automatic reconnection on disconnect
- Use connection pooling for scale

**Event Store:**
- Indexed by stream_id and stream_sequence
- Fast event replay for aggregates
- LISTEN/NOTIFY for real-time propagation
- Consider snapshots for very long streams (future)

**Projections:**
- Update synchronously on event
- Idempotent handlers (can replay safely)
- Read model optimized for queries
- Separate read/write scalability

## Next Steps

With event-sourced post scheduling complete:
- **Phase 5**: Frontend with SSE integration
- **Phase 6**: Advanced post features (recurring, drafts)
- **Phase 7**: Twitter integration & publishing
- **Phase 8**: Background job for auto-publishing

## Future Enhancements

- [ ] Post drafts (save without scheduling)
- [ ] Recurring posts (cron patterns)
- [ ] Post templates
- [ ] Bulk operations
- [ ] Advanced scheduling (threads, replies)
- [ ] Media upload service
- [ ] Post approval workflow
- [ ] Analytics from event stream
