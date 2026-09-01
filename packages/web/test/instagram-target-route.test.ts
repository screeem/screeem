import { NextRequest } from "next/server"
import { Effect } from "effect"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  authorizeTeam: vi.fn(),
  createApprovedTarget: vi.fn(),
}))

vi.mock("server-only", () => ({}))
vi.mock("@/lib/teams/authorization", () => ({
  authorizeTeam: mocks.authorizeTeam,
}))
vi.mock("@/lib/integrations/social/instagram-scheduling", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../src/lib/integrations/social/instagram-scheduling")
  >()
  return {
    ...actual,
    PostgresInstagramSchedulingStore: class {
      createApprovedTarget = mocks.createApprovedTarget
    },
  }
})

import {
  InstagramSchedulingAuthorizationError,
  InstagramSchedulingPersistenceError,
  InstagramSchedulingRequestError,
  InstagramSchedulingStateError,
} from "../src/lib/integrations/social/instagram-scheduling"
import { POST } from "../src/app/api/teams/[teamId]/calendar/[postId]/targets/instagram/route"

const teamId = "81000000-0000-4000-8000-000000000001"
const postId = "81000000-0000-4000-8000-000000000002"
const actorId = "81000000-0000-4000-8000-000000000003"
const requestId = "81000000-0000-4000-8000-000000000004"
const context = { params: Promise.resolve({ teamId, postId }) }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.authorizeTeam.mockResolvedValue({ user: { id: actorId }, membership: { role: "member" } })
})

describe("Instagram target API", () => {
  it("creates a target from the approved calendar revision", async () => {
    mocks.createApprovedTarget.mockReturnValue(Effect.succeed({ id: "target-1" }))

    const response = await POST(request({
      expectedCalendarRevision: 4,
      requestId,
    }), context)

    expect(response.status).toBe(201)
    expect(mocks.createApprovedTarget).toHaveBeenCalledWith({
      teamId,
      calendarPostId: postId,
      expectedCalendarRevision: 4,
      requestId,
      actorId,
    })
    await expect(response.json()).resolves.toEqual({ id: "target-1" })
  })

  it("reports a stale approved revision", async () => {
    mocks.createApprovedTarget.mockReturnValue(Effect.fail(
      new InstagramSchedulingStateError({ reason: "revision_conflict" }),
    ))

    const response = await POST(request({
      expectedCalendarRevision: 3,
      requestId,
    }), context)

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: "The calendar post changed. Refresh before scheduling.",
    })
  })

  it("rejects extra request fields before calling the store", async () => {
    const response = await POST(request({
      expectedCalendarRevision: 4,
      requestId,
      connectionId: "browser-controlled",
    }), context)

    expect(response.status).toBe(400)
    expect(mocks.createApprovedTarget).not.toHaveBeenCalled()
  })

  it("stops when team authorization fails", async () => {
    mocks.authorizeTeam.mockResolvedValue({
      error: new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
    })

    const response = await POST(request({ expectedCalendarRevision: 4, requestId }), context)

    expect(response.status).toBe(403)
    expect(mocks.createApprovedTarget).not.toHaveBeenCalled()
  })

  it("rejects an oversized request before calling the store", async () => {
    const response = await POST(request({ padding: "x".repeat(5_000) }), context)

    expect(response.status).toBe(413)
    expect(mocks.createApprovedTarget).not.toHaveBeenCalled()
  })

  it("maps store request and membership failures", async () => {
    mocks.createApprovedTarget.mockReturnValueOnce(Effect.fail(
      new InstagramSchedulingRequestError({ reason: "invalid" }),
    ))
    const invalid = await POST(request({ expectedCalendarRevision: 4, requestId }), context)
    expect(invalid.status).toBe(400)

    mocks.createApprovedTarget.mockReturnValueOnce(Effect.fail(
      new InstagramSchedulingAuthorizationError({ reason: "forbidden" }),
    ))
    const forbidden = await POST(request({ expectedCalendarRevision: 4, requestId }), context)
    expect(forbidden.status).toBe(403)
  })

  it.each([
    ["asset_unavailable", "One or more Instagram media files are not ready."],
    ["connection_unavailable", "Connect Instagram before scheduling."],
    ["integration_disabled", "Team integrations are disabled."],
  ] as const)("maps %s without exposing store details", async (reason, message) => {
    mocks.createApprovedTarget.mockReturnValue(Effect.fail(
      new InstagramSchedulingStateError({ reason }),
    ))

    const response = await POST(request({ expectedCalendarRevision: 4, requestId }), context)

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: message })
  })

  it("returns a generic server error for a corrupt persisted target", async () => {
    mocks.createApprovedTarget.mockReturnValue(Effect.fail(
      new InstagramSchedulingPersistenceError({ operation: "load" }),
    ))

    const response = await POST(request({ expectedCalendarRevision: 4, requestId }), context)

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: "Unable to schedule the Instagram target",
    })
  })
})

function request(body: unknown) {
  return new NextRequest(
    `http://localhost/api/teams/${teamId}/calendar/${postId}/targets/instagram`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  )
}
