import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  getMembership: vi.fn(),
  createAdminClient: vi.fn(),
  getUserById: vi.fn(),
}))

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: mocks.getUser } }),
}))
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}))
vi.mock("@/lib/teams/server", () => ({
  canManage: (role: string) => role === "owner" || role === "admin",
  getMembership: mocks.getMembership,
}))
vi.mock("@/lib/calendar/events", async () => import("../src/lib/calendar/events"))

import { GET, POST } from "../src/app/api/teams/[teamId]/calendar/events/route"

const teamId = "72000000-0000-0000-0000-000000000001"
const actorId = "73000000-0000-0000-0000-000000000001"
const context = { params: Promise.resolve({ teamId }) }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getUser.mockResolvedValue({ data: { user: { id: actorId } } })
  mocks.getMembership.mockResolvedValue({ role: "member" })
  mocks.getUserById.mockResolvedValue({
    data: { user: { email: "ada@example.com", user_metadata: { full_name: "Ada Lovelace" } } },
  })
})

describe("calendar events API", () => {
  it("attaches actor identity to append-only calendar events", async () => {
    const calendarQuery = query({ data: [eventRow()], error: null })
    const from = vi.fn().mockReturnValue(calendarQuery)
    mocks.createAdminClient.mockReturnValue({ from, auth: { admin: { getUserById: mocks.getUserById } } })

    const response = await GET(request(), context)

    expect(response.status).toBe(200)
    expect(mocks.getUserById).toHaveBeenCalledWith(actorId)
    await expect(response.json()).resolves.toEqual({
      events: [{
        id: 1,
        aggregateId: "74000000-0000-0000-0000-000000000001",
        eventType: "title.changed",
        payload: { value: "Launch update" },
        revertsEventId: null,
        actorId,
        actor: { id: actorId, email: "ada@example.com", displayName: "Ada Lovelace" },
        createdAt: "2026-08-14T10:00:00.000Z",
      }],
    })
  })

  it("uses a stable actor fallback when auth metadata is unavailable", async () => {
    mocks.getUserById.mockResolvedValue({ data: { user: null } })
    mocks.createAdminClient.mockReturnValue({
      from: vi.fn().mockReturnValue(query({ data: [eventRow()], error: null })),
      auth: { admin: { getUserById: mocks.getUserById } },
    })

    const response = await GET(request(), context)

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.events[0].actor).toEqual({ id: actorId, email: null, displayName: "User 73000000" })
  })

  it("prevents ordinary members from approving a post", async () => {
    const aggregateQuery = query({ data: approvalHistory(), error: null })
    const from = vi.fn().mockReturnValueOnce(aggregateQuery)
    mocks.createAdminClient.mockReturnValue({ from, auth: { admin: { getUserById: mocks.getUserById } } })

    const response = await POST(approvalRequest("approval.granted", 1), context)

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: "Only team owners and admins can review posts.",
    })
  })

  it("rejects an approval for a stale revision", async () => {
    mocks.getMembership.mockResolvedValue({ role: "owner" })
    const aggregateQuery = query({ data: approvalHistory(), error: null })
    const from = vi.fn().mockReturnValueOnce(aggregateQuery)
    mocks.createAdminClient.mockReturnValue({ from, auth: { admin: { getUserById: mocks.getUserById } } })

    const response = await POST(approvalRequest("approval.granted", 2), context)

    expect(response.status).toBe(409)
    expect((await response.json()).error).toContain("changed since")
  })

  it.each([
    [[" launch"]],
    [["Launch", "launch"]],
    [Array.from({ length: 11 }, (_, index) => `tag-${index}`)],
  ])("rejects invalid post tags", async (tags) => {
    const response = await POST(postCreationRequest(tags), context)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: "Invalid calendar event" })
  })
})

function request() {
  return new NextRequest(`http://localhost/api/teams/${teamId}/calendar/events`)
}

function eventRow() {
  return {
    id: 1,
    aggregate_id: "74000000-0000-0000-0000-000000000001",
    event_type: "title.changed",
    payload: { value: "Launch update" },
    reverts_event_id: null,
    actor_id: actorId,
    created_at: "2026-08-14T10:00:00.000Z",
  }
}

function approvalHistory() {
  return [
    {
      id: 1,
      aggregate_id: "74000000-0000-4000-8000-000000000001",
      event_type: "post.created",
      payload: {
        title: "Launch", copy: "Hello", date: "2026-08-20", time: "09:00",
        tags: ["launch"], targets: ["X"],
      },
      reverts_event_id: null,
      actor_id: actorId,
      created_at: "2026-08-14T10:00:00.000Z",
    },
    {
      id: 2,
      aggregate_id: "74000000-0000-4000-8000-000000000001",
      event_type: "approval.requested",
      payload: { revision: 1 },
      reverts_event_id: null,
      actor_id: actorId,
      created_at: "2026-08-14T11:00:00.000Z",
    },
  ]
}

function postCreationRequest(tags: string[]) {
  return new NextRequest(`http://localhost/api/teams/${teamId}/calendar/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ events: [{
      aggregateId: "74000000-0000-4000-8000-000000000001",
      clientEventId: "75000000-0000-4000-8000-000000000001",
      eventType: "post.created",
      payload: {
        title: "Launch", copy: "Hello", date: "2026-08-20", time: "09:00",
        tags, targets: ["X"],
      },
    }] }),
  })
}

function approvalRequest(eventType: string, revision: number) {
  return new NextRequest(`http://localhost/api/teams/${teamId}/calendar/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ events: [{
      aggregateId: "74000000-0000-4000-8000-000000000001",
      clientEventId: "75000000-0000-4000-8000-000000000001",
      eventType,
      payload: { revision },
    }] }),
  })
}

function query(result: unknown) {
  const queryBuilder = {
    select: vi.fn(() => queryBuilder),
    eq: vi.fn(() => queryBuilder),
    gt: vi.fn(() => queryBuilder),
    order: vi.fn(() => queryBuilder),
    limit: vi.fn(() => Promise.resolve(result)),
  }
  return queryBuilder
}
