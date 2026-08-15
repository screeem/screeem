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
vi.mock("@/lib/teams/server", () => ({ getMembership: mocks.getMembership }))

import { GET } from "../src/app/api/teams/[teamId]/calendar/events/route"

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
