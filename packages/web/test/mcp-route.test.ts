import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ createAdminClient: vi.fn() }))

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock("@/lib/calendar/mcp", async () => import("../src/lib/calendar/mcp"))
vi.mock("@/lib/storage/social-avatars", () => ({
  socialAvatarDataUrl: vi.fn(async () => undefined),
}))

import { POST } from "../src/app/api/mcp/route"

function request(method: string, params?: unknown, token?: string) {
  return new NextRequest("http://localhost/api/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  })
}

beforeEach(() => vi.clearAllMocks())

describe("MCP route discovery", () => {
  it("advertises the interactive calendar and headless tools", async () => {
    const response = await POST(request("tools/list"))
    const body = await response.json()
    const tools = body.result.tools as Array<{ name: string; _meta?: Record<string, unknown> }>

    expect(tools.map((tool) => tool.name)).toEqual([
      "create_or_update_post",
      "open_calendar",
      "list_scheduled_posts",
      "schedule_post",
      "update_scheduled_post",
      "reschedule_post",
      "remove_scheduled_post",
    ])
    expect(tools.find((tool) => tool.name === "open_calendar")?._meta?.["ui/resourceUri"])
      .toBe("ui://screeem/calendar")
    expect(tools.find((tool) => tool.name === "schedule_post")?._meta).toBeUndefined()
  })

  it("advertises both MCP app resources", async () => {
    const response = await POST(request("resources/list"))

    await expect(response.json()).resolves.toMatchObject({
      result: {
        resources: [
          { uri: "ui://tweet-preview/app" },
          { uri: "ui://screeem/calendar" },
        ],
      },
    })
  })

  it("serves the bundled interactive calendar app", async () => {
    const response = await POST(request("resources/read", { uri: "ui://screeem/calendar" }))
    const body = await response.json()
    const resource = body.result.contents[0]

    expect(resource).toMatchObject({
      uri: "ui://screeem/calendar",
      mimeType: "text/html;profile=mcp-app",
    })
    expect(resource.text).toContain("reschedule_post")
    expect(resource.text).toContain("remove_scheduled_post")
  })

  it("scopes headless calendar reads to the API key team", async () => {
    const teamId = "94000000-0000-4000-8000-000000000001"
    const userId = "95000000-0000-4000-8000-000000000001"
    const apiKeyQuery = chainedQuery({ data: { user_id: userId, team_id: teamId } }, "single")
    const membershipQuery = chainedQuery({ data: { user_id: userId } }, "maybeSingle")
    const accountQuery = chainedQuery({ data: [] }, "order")
    const authClient = {
      from: vi.fn((table: string) => table === "api_keys" ? apiKeyQuery
        : table === "team_members" ? membershipQuery : accountQuery),
    }
    const calendarQuery = chainedQuery({
      data: [{
        id: 1,
        aggregate_id: "96000000-0000-4000-8000-000000000001",
        event_type: "post.created",
        payload: {
          title: "Launch", copy: "Ship it", date: "2026-08-20", time: "09:30",
          targets: ["X"], tags: ["campaign"],
        },
        reverts_event_id: null,
        actor_id: userId,
        created_at: "2026-08-18T09:00:00Z",
      }],
      error: null,
    }, "limit")
    mocks.createAdminClient
      .mockReturnValueOnce(authClient)
      .mockReturnValueOnce({ from: vi.fn(() => calendarQuery) })

    const response = await POST(request("tools/call", {
      name: "list_scheduled_posts",
      arguments: {},
    }, "secret-key"))
    const body = await response.json()

    expect(body.result.structuredContent.posts).toEqual([
      expect.objectContaining({ title: "Launch", tags: ["campaign"] }),
    ])
    expect(apiKeyQuery.eq).toHaveBeenCalledWith("key", "secret-key")
    expect(calendarQuery.eq).toHaveBeenCalledWith("team_id", teamId)
  })
})

function chainedQuery(result: unknown, terminal: "single" | "maybeSingle" | "order" | "limit") {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    single: vi.fn(() => terminal === "single" ? Promise.resolve(result) : query),
    maybeSingle: vi.fn(() => terminal === "maybeSingle" ? Promise.resolve(result) : query),
    order: vi.fn(() => terminal === "order" ? Promise.resolve(result) : query),
    limit: vi.fn(() => terminal === "limit" ? Promise.resolve(result) : query),
  }
  return query
}
