export type CalendarTarget = "X" | "LinkedIn" | "Instagram"
export type CalendarApprovalStatus = "draft" | "in_review" | "changes_requested" | "approved"
export type CalendarEventType =
  | "post.created" | "title.changed" | "copy.changed" | "schedule.changed"
  | "tag.added" | "tag.removed" | "target.added" | "target.removed" | "change.reverted"
  | "instagram.target.configured"
  | "colour.changed"
  | "approval.requested" | "approval.granted" | "approval.changes_requested"
  | "approval.withdrawn"

export const CALENDAR_TAG_LIMIT = 10
export const CALENDAR_TAG_MAX_LENGTH = 30

export type CalendarActor = {
  id: string
  email: string | null
  displayName: string
}

export type CalendarEvent = {
  id: number
  aggregateId: string
  eventType: CalendarEventType
  payload: Record<string, unknown>
  revertsEventId: number | null
  actorId: string
  actor: CalendarActor
  createdAt: string
}
export type CalendarPost = {
  id: string
  title: string
  copy: string
  date: string
  time: string
  targets: CalendarTarget[]
  tags: string[]
  createdEventId: number
  activeEventIds: number[]
  revision: number
  approval: {
    status: CalendarApprovalStatus
    reviewRevision: number | null
    requestedBy: string | null
    comment: string
  }
}

const targets = new Set<CalendarTarget>(["X", "LinkedIn", "Instagram"])
const contentEventTypes = new Set<CalendarEventType>([
  "post.created", "title.changed", "copy.changed", "schedule.changed",
  "tag.added", "tag.removed", "target.added", "target.removed", "change.reverted",
  "instagram.target.configured",
  // Kept for replaying the immutable history written before tags replaced colours.
  "colour.changed",
])

export const approvalEventTypes = new Set<CalendarEventType>([
  "approval.requested", "approval.granted", "approval.changes_requested", "approval.withdrawn",
])

export function isApprovalEventType(type: CalendarEventType) {
  return approvalEventTypes.has(type)
}

function draftApproval(): CalendarPost["approval"] {
  return { status: "draft", reviewRevision: null, requestedBy: null, comment: "" }
}

export function normalizeCalendarTag(value: string) {
  return value.trim()
}

export function isValidCalendarTag(value: unknown): value is string {
  return typeof value === "string"
    && value === normalizeCalendarTag(value)
    && value.length > 0
    && value.length <= CALENDAR_TAG_MAX_LENGTH
}

export function isValidCalendarTags(value: unknown): value is string[] {
  if (!Array.isArray(value) || value.length > CALENDAR_TAG_LIMIT
    || !value.every(isValidCalendarTag)) return false
  return new Set(value.map((tag) => tag.toLowerCase())).size === value.length
}

function replayTags(value: unknown) {
  if (!Array.isArray(value)) return []
  const tags: string[] = []
  for (const item of value) {
    if (typeof item !== "string") continue
    const tag = normalizeCalendarTag(item)
    if (!tag || tag.length > CALENDAR_TAG_MAX_LENGTH
      || tags.some((candidate) => candidate.toLowerCase() === tag.toLowerCase())) continue
    tags.push(tag)
    if (tags.length === CALENDAR_TAG_LIMIT) break
  }
  return tags
}

export function activeCalendarEventIds(events: CalendarEvent[]) {
  const active = new Set<number>()
  const reverted = new Set<number>()
  for (const event of [...events].sort((a, b) => b.id - a.id)) {
    if (reverted.has(event.id)) continue
    active.add(event.id)
    if (event.eventType === "change.reverted" && event.revertsEventId !== null) {
      reverted.add(event.revertsEventId)
    }
  }
  return active
}

export function replayCalendar(events: CalendarEvent[]): CalendarPost[] {
  const active = activeCalendarEventIds(events)
  const posts = new Map<string, CalendarPost>()
  const revisions = new Map<string, number>()
  for (const event of [...events].sort((a, b) => a.id - b.id)) {
    if (contentEventTypes.has(event.eventType)) {
      revisions.set(event.aggregateId, (revisions.get(event.aggregateId) ?? 0) + 1)
    }
    if (!active.has(event.id)) continue
    if (event.eventType === "change.reverted") {
      const post = posts.get(event.aggregateId)
      if (post) post.approval = draftApproval()
      continue
    }
    const value = event.payload.value
    if (event.eventType === "post.created") {
      const payload = event.payload
      posts.set(event.aggregateId, {
        id: event.aggregateId,
        title: String(payload.title ?? ""), copy: String(payload.copy ?? ""),
        date: String(payload.date ?? ""), time: String(payload.time ?? ""),
        tags: replayTags(payload.tags),
        targets: Array.isArray(payload.targets)
          ? payload.targets.filter((target): target is CalendarTarget => targets.has(target as CalendarTarget))
          : [],
        createdEventId: event.id, activeEventIds: [event.id], revision: 1,
        approval: draftApproval(),
      })
      continue
    }
    const post = posts.get(event.aggregateId)
    if (!post) continue
    post.activeEventIds.push(event.id)
    if (contentEventTypes.has(event.eventType)) post.approval = draftApproval()
    if (event.eventType === "title.changed") post.title = String(value ?? "")
    if (event.eventType === "copy.changed") post.copy = String(value ?? "")
    if (event.eventType === "schedule.changed") {
      post.date = String(event.payload.date ?? "")
      post.time = String(event.payload.time ?? "")
    }
    if (event.eventType === "target.added" && targets.has(value as CalendarTarget)) {
      if (!post.targets.includes(value as CalendarTarget)) post.targets.push(value as CalendarTarget)
    }
    if (event.eventType === "target.removed") {
      post.targets = post.targets.filter((target) => target !== value)
    }
    if (event.eventType === "tag.added" && typeof value === "string") {
      const tag = normalizeCalendarTag(value)
      if (tag && tag.length <= CALENDAR_TAG_MAX_LENGTH && post.tags.length < CALENDAR_TAG_LIMIT
        && !post.tags.some((candidate) => candidate.toLowerCase() === tag.toLowerCase())) {
        post.tags.push(tag)
      }
    }
    if (event.eventType === "tag.removed" && typeof value === "string") {
      const tag = normalizeCalendarTag(value).toLowerCase()
      post.tags = post.tags.filter((candidate) => candidate.toLowerCase() !== tag)
    }
    const revision = Number(event.payload.revision)
    const comment = typeof event.payload.comment === "string" ? event.payload.comment : ""
    if (event.eventType === "approval.requested") {
      post.approval = {
        status: "in_review", reviewRevision: revision,
        requestedBy: event.actorId, comment,
      }
    }
    if (event.eventType === "approval.granted") {
      post.approval = { ...post.approval, status: "approved", reviewRevision: revision, comment }
    }
    if (event.eventType === "approval.changes_requested") {
      post.approval = { ...post.approval, status: "changes_requested", reviewRevision: revision, comment }
    }
    if (event.eventType === "approval.withdrawn") post.approval = draftApproval()
  }
  return [...posts.values()].filter((post) => active.has(post.createdEventId)).map((post) => {
    post.revision = revisions.get(post.id) ?? 1
    if ((post.approval.status === "in_review" || post.approval.status === "approved")
      && post.approval.reviewRevision !== post.revision) {
      post.approval = draftApproval()
    }
    return post
  })
}

export function validateApprovalTransition(
  post: CalendarPost,
  eventType: CalendarEventType,
  revision: number,
  actorId: string,
  canApprove: boolean,
) {
  if (!isApprovalEventType(eventType)) return "Not an approval event"
  if (!Number.isSafeInteger(revision) || revision !== post.revision) {
    return "This post changed since it was loaded. Refresh before continuing."
  }
  if (eventType === "approval.requested") {
    if (post.approval.status !== "draft" && post.approval.status !== "changes_requested") {
      return "Only draft posts can be submitted for approval."
    }
    return null
  }
  if (eventType === "approval.withdrawn") {
    if (post.approval.status !== "in_review") return "This post is not awaiting approval."
    if (!canApprove && post.approval.requestedBy !== actorId) {
      return "Only the requester or a team manager can withdraw this review."
    }
    return null
  }
  if (!canApprove) return "Only team owners and admins can review posts."
  if (post.approval.status !== "in_review" || post.approval.reviewRevision !== revision) {
    return "This post is not awaiting approval for the current revision."
  }
  return null
}
