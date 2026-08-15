import { describe, expect, it } from "vitest"
import { activeCalendarEventIds, replayCalendar, type CalendarEvent } from "../src/lib/calendar/events"

const event = (id: number, eventType: CalendarEvent["eventType"], payload = {}, revertsEventId: number | null = null): CalendarEvent => ({
  id, eventType, payload, revertsEventId, aggregateId: "post-1", actorId: "user-1", actor: { id: "user-1", email: "ada@example.com", displayName: "Ada" }, createdAt: "2026-08-14T00:00:00Z",
})

describe("calendar event replay", () => {
  it("derives a post from incremental changes", () => {
    const posts = replayCalendar([
      event(1, "post.created", { title: "First", copy: "", date: "2026-08-14", time: "09:00", colour: "violet", targets: ["X"] }),
      event(2, "title.changed", { value: "Second" }),
      event(3, "target.added", { value: "LinkedIn" }),
    ])
    expect(posts[0]).toMatchObject({ title: "Second", targets: ["X", "LinkedIn"] })
  })

  it("reverts any change without deleting history", () => {
    const events = [
      event(1, "post.created", { title: "First", targets: ["X"] }),
      event(2, "title.changed", { value: "Second" }),
      event(3, "change.reverted", {}, 2),
    ]
    expect(replayCalendar(events)[0].title).toBe("First")
    expect(activeCalendarEventIds(events).has(2)).toBe(false)
    expect(events).toHaveLength(3)
  })

  it("can revert a revert", () => {
    const events = [
      event(1, "post.created", { title: "First", targets: ["X"] }),
      event(2, "title.changed", { value: "Second" }),
      event(3, "change.reverted", {}, 2),
      event(4, "change.reverted", {}, 3),
    ]
    expect(replayCalendar(events)[0].title).toBe("Second")
  })
})
