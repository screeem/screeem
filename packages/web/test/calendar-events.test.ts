import { describe, expect, it } from "vitest"
import {
  activeCalendarEventIds,
  isValidCalendarTags,
  replayCalendar,
  validateApprovalTransition,
  type CalendarEvent,
} from "../src/lib/calendar/events"

const event = (id: number, eventType: CalendarEvent["eventType"], payload = {}, revertsEventId: number | null = null): CalendarEvent => ({
  id, eventType, payload, revertsEventId, aggregateId: "post-1", actorId: "user-1", actor: { id: "user-1", email: "ada@example.com", displayName: "Ada" }, createdAt: "2026-08-14T00:00:00Z",
})

describe("calendar event replay", () => {
  it("derives a post from incremental changes", () => {
    const posts = replayCalendar([
      event(1, "post.created", { title: "First", copy: "", date: "2026-08-14", time: "09:00", tags: ["launch"], targets: ["X"] }),
      event(2, "title.changed", { value: "Second" }),
      event(3, "target.added", { value: "LinkedIn" }),
    ])
    expect(posts[0]).toMatchObject({ title: "Second", tags: ["launch"], targets: ["X", "LinkedIn"] })
  })

  it("adds and removes tags without case-insensitive duplicates", () => {
    const post = replayCalendar([
      event(1, "post.created", { title: "First", tags: ["Launch"], targets: ["X"] }),
      event(2, "tag.added", { value: "Product" }),
      event(3, "tag.added", { value: "product" }),
      event(4, "tag.removed", { value: "LAUNCH" }),
    ])[0]

    expect(post.tags).toEqual(["Product"])
  })

  it("validates tag limits, whitespace, and uniqueness", () => {
    expect(isValidCalendarTags(["Launch", "Product update"])).toBe(true)
    expect(isValidCalendarTags(["Launch", "launch"])).toBe(false)
    expect(isValidCalendarTags([" needs-trimming"])).toBe(false)
    expect(isValidCalendarTags(Array.from({ length: 11 }, (_, index) => `tag-${index}`))).toBe(false)
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

  it("approves only the revision that was submitted", () => {
    const events = [
      event(1, "post.created", { title: "First", targets: ["X"] }),
      event(2, "approval.requested", { revision: 1, comment: "Ready for review" }),
      event(3, "approval.granted", { revision: 1, comment: "Looks good" }),
    ]

    expect(replayCalendar(events)[0]).toMatchObject({
      revision: 1,
      approval: {
        status: "approved",
        reviewRevision: 1,
        requestedBy: "user-1",
        comment: "Looks good",
      },
    })
  })

  it("returns an approved post to draft when its content changes", () => {
    const post = replayCalendar([
      event(1, "post.created", { title: "First", targets: ["X"] }),
      event(2, "approval.requested", { revision: 1 }),
      event(3, "approval.granted", { revision: 1 }),
      event(4, "copy.changed", { value: "Updated after approval" }),
    ])[0]

    expect(post.revision).toBe(2)
    expect(post.approval.status).toBe("draft")
  })

  it("includes Instagram target configuration in the approved revision", () => {
    const post = replayCalendar([
      event(1, "post.created", { title: "First", targets: ["Instagram"] }),
      event(2, "approval.requested", { revision: 1 }),
      event(3, "approval.granted", { revision: 1 }),
      event(4, "instagram.target.configured", { input: {} }),
    ])[0]

    expect(post.revision).toBe(2)
    expect(post.approval.status).toBe("draft")
  })

  it("rejects stale and unauthorized approval transitions", () => {
    const post = replayCalendar([
      event(1, "post.created", { title: "First", targets: ["X"] }),
      event(2, "approval.requested", { revision: 1 }),
    ])[0]

    expect(validateApprovalTransition(post, "approval.granted", 0, "user-2", true))
      .toContain("changed since")
    expect(validateApprovalTransition(post, "approval.granted", 1, "user-2", false))
      .toContain("owners and admins")
    expect(validateApprovalTransition(post, "approval.granted", 1, "user-2", true)).toBeNull()
  })
})
