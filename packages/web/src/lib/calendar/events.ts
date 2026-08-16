export type CalendarTarget = "X" | "LinkedIn" | "Instagram"
export type CalendarEventType =
  | "post.created" | "title.changed" | "copy.changed" | "schedule.changed"
  | "colour.changed" | "target.added" | "target.removed" | "change.reverted"

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
  colour: string
  createdEventId: number
  activeEventIds: number[]
}

const targets = new Set<CalendarTarget>(["X", "LinkedIn", "Instagram"])

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
  for (const event of [...events].sort((a, b) => a.id - b.id)) {
    if (!active.has(event.id) || event.eventType === "change.reverted") continue
    const value = event.payload.value
    if (event.eventType === "post.created") {
      const payload = event.payload
      posts.set(event.aggregateId, {
        id: event.aggregateId,
        title: String(payload.title ?? ""), copy: String(payload.copy ?? ""),
        date: String(payload.date ?? ""), time: String(payload.time ?? ""),
        colour: String(payload.colour ?? "violet"),
        targets: Array.isArray(payload.targets)
          ? payload.targets.filter((target): target is CalendarTarget => targets.has(target as CalendarTarget))
          : [],
        createdEventId: event.id, activeEventIds: [event.id],
      })
      continue
    }
    const post = posts.get(event.aggregateId)
    if (!post) continue
    post.activeEventIds.push(event.id)
    if (event.eventType === "title.changed") post.title = String(value ?? "")
    if (event.eventType === "copy.changed") post.copy = String(value ?? "")
    if (event.eventType === "colour.changed") post.colour = String(value ?? "violet")
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
  }
  return [...posts.values()].filter((post) => active.has(post.createdEventId))
}
