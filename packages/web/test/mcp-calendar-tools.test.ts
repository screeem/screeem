import { describe, expect, it, vi } from "vitest"
import {
  CALENDAR_RESOURCE_URI,
  CalendarMcpError,
  calendarMcpToolDefinitions,
  createSupabaseCalendarMcpStore,
  executeCalendarMcpTool,
} from "../src/lib/calendar/mcp"
import type { CalendarEvent, CalendarEventType } from "../src/lib/calendar/events"
import type { CalendarMcpStore, PendingCalendarEvent } from "../src/lib/calendar/mcp"

const teamId = "91000000-0000-4000-8000-000000000001"
const userId = "92000000-0000-4000-8000-000000000001"

class MemoryCalendarStore implements CalendarMcpStore {
  events: CalendarEvent[] = []

  async load(requestedTeamId: string) {
    expect(requestedTeamId).toBe(teamId)
    return [...this.events]
  }

  async append(requestedTeamId: string, actorId: string, events: PendingCalendarEvent[]) {
    expect(requestedTeamId).toBe(teamId)
    for (const pending of events) {
      this.events.push(toEvent(this.events.length + 1, actorId, pending))
    }
  }
}

function toEvent(id: number, actorId: string, event: PendingCalendarEvent): CalendarEvent {
  return {
    id,
    aggregateId: event.aggregateId,
    eventType: event.eventType as CalendarEventType,
    payload: event.payload,
    revertsEventId: event.revertsEventId ?? null,
    actorId,
    actor: { id: actorId, email: null, displayName: "MCP user" },
    createdAt: `2026-08-18T09:${String(id).padStart(2, "0")}:00Z`,
  }
}

async function call(store: MemoryCalendarStore, name: string, args: Record<string, unknown> = {}) {
  return executeCalendarMcpTool(store, { teamId, userId }, name, args)
}

describe("calendar MCP tools", () => {
  it("publishes one UI entry point and headless calendar operations", () => {
    const open = calendarMcpToolDefinitions.find((tool) => tool.name === "open_calendar")
    const headless = calendarMcpToolDefinitions.filter((tool) => tool.name !== "open_calendar")

    expect(open?._meta?.["ui/resourceUri"]).toBe(CALENDAR_RESOURCE_URI)
    expect(headless.map((tool) => tool.name)).toEqual([
      "list_scheduled_posts",
      "schedule_post",
      "update_scheduled_post",
      "reschedule_post",
      "remove_scheduled_post",
    ])
    expect(headless.every((tool) => !("_meta" in tool))).toBe(true)
  })

  it("creates, edits, reschedules, filters, and removes scheduled posts", async () => {
    const store = new MemoryCalendarStore()
    const created = await call(store, "schedule_post", {
      title: "Launch",
      copy: "Ship it",
      date: "2026-08-20",
      time: "09:30",
      targets: ["X", "LinkedIn"],
      tags: ["campaign"],
    })
    const postId = created.structuredContent.changedPostId!

    expect(created.structuredContent.posts[0]).toMatchObject({
      id: postId,
      title: "Launch",
      date: "2026-08-20",
      tags: ["campaign"],
      revision: 1,
    })

    const updated = await call(store, "update_scheduled_post", {
      post_id: postId,
      expected_revision: 1,
      title: "Launch day",
      tags: ["campaign", "product"],
    })
    expect(updated.structuredContent.posts[0]).toMatchObject({
      title: "Launch day",
      tags: ["campaign", "product"],
      revision: 3,
    })

    const rescheduled = await call(store, "reschedule_post", {
      post_id: postId,
      expected_revision: 3,
      date: "2026-08-22",
      time: "14:15",
    })
    expect(rescheduled.structuredContent.posts[0]).toMatchObject({
      date: "2026-08-22",
      time: "14:15",
      revision: 4,
    })

    const filtered = await call(store, "list_scheduled_posts", {
      start_date: "2026-08-21",
      end_date: "2026-08-23",
      target: "LinkedIn",
      tag: "PRODUCT",
    })
    expect(filtered.structuredContent.posts).toHaveLength(1)

    const removed = await call(store, "remove_scheduled_post", {
      post_id: postId,
      expected_revision: 4,
    })
    expect(removed.structuredContent.posts).toEqual([])
    expect(store.events.at(-1)).toMatchObject({
      aggregateId: postId,
      eventType: "change.reverted",
      revertsEventId: 1,
    })
  })

  it("rejects stale revisions and invalid scheduling data", async () => {
    const store = new MemoryCalendarStore()
    const created = await call(store, "schedule_post", {
      title: "Launch",
      copy: "Ship it",
      date: "2026-08-20",
      time: "09:30",
      targets: ["X"],
    })
    const postId = created.structuredContent.changedPostId!

    await expect(call(store, "update_scheduled_post", {
      post_id: postId,
      expected_revision: 2,
      copy: "Stale edit",
    })).rejects.toThrow(CalendarMcpError)
    await expect(call(store, "reschedule_post", {
      post_id: postId,
      date: "2026-02-30",
      time: "25:00",
    })).rejects.toThrow("valid date")
    await expect(call(store, "update_scheduled_post", {
      post_id: postId,
      tags: ["Launch", "launch"],
    })).rejects.toThrow("unique")
  })

  it("maps Supabase event rows and appends actor-scoped calendar events", async () => {
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      order: vi.fn(() => query),
      limit: vi.fn(async () => ({
        data: [{
          id: 1,
          aggregate_id: "93000000-0000-4000-8000-000000000001",
          event_type: "post.created",
          payload: { title: "Launch", targets: ["X"], tags: [] },
          reverts_event_id: null,
          actor_id: userId,
          created_at: "2026-08-18T09:00:00Z",
        }],
        error: null,
      })),
    }
    const upsert = vi.fn(async () => ({ error: null }))
    const client = {
      from: vi.fn()
        .mockReturnValueOnce(query)
        .mockReturnValueOnce({ upsert }),
    }
    const store = createSupabaseCalendarMcpStore(
      client as unknown as Parameters<typeof createSupabaseCalendarMcpStore>[0],
    )

    const events = await store.load(teamId)
    await store.append(teamId, userId, [{
      aggregateId: "93000000-0000-4000-8000-000000000001",
      eventType: "title.changed",
      payload: { value: "Launch day" },
    }])

    expect(events[0]).toMatchObject({
      id: 1,
      aggregateId: "93000000-0000-4000-8000-000000000001",
      eventType: "post.created",
      actorId: userId,
    })
    expect(query.eq).toHaveBeenCalledWith("team_id", teamId)
    expect(upsert).toHaveBeenCalledWith([
      expect.objectContaining({
        team_id: teamId,
        actor_id: userId,
        event_type: "title.changed",
      }),
    ], { onConflict: "team_id,client_event_id", ignoreDuplicates: true })
  })
})
