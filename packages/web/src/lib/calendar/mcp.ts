import type { SupabaseClient } from "@supabase/supabase-js"
import {
  CALENDAR_TAG_LIMIT,
  CALENDAR_TAG_MAX_LENGTH,
  isValidCalendarTags,
  replayCalendar,
} from "./events"
import type { CalendarEvent, CalendarEventType, CalendarPost, CalendarTarget } from "./events"

export const CALENDAR_RESOURCE_URI = "ui://screeem/calendar"

const targets = new Set<CalendarTarget>(["X", "LinkedIn", "Instagram"])
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const datePattern = /^\d{4}-\d{2}-\d{2}$/
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/

const postProperties = {
  post_id: { type: "string", format: "uuid", description: "Scheduled post ID" },
  expected_revision: {
    type: "integer", minimum: 1,
    description: "Optional current revision used to reject edits based on stale calendar data",
  },
} as const

const editableProperties = {
  title: { type: "string", minLength: 1, maxLength: 160 },
  copy: { type: "string", maxLength: 10000 },
  date: { type: "string", format: "date", description: "Scheduled date in YYYY-MM-DD format" },
  time: { type: "string", pattern: "^(?:[01]\\d|2[0-3]):[0-5]\\d$", description: "Scheduled time in HH:mm format" },
  targets: {
    type: "array", minItems: 1, uniqueItems: true,
    items: { type: "string", enum: ["X", "LinkedIn", "Instagram"] },
  },
  tags: {
    type: "array", maxItems: CALENDAR_TAG_LIMIT, uniqueItems: true,
    items: { type: "string", minLength: 1, maxLength: CALENDAR_TAG_MAX_LENGTH },
  },
} as const

export const calendarMcpToolDefinitions = [
  {
    name: "open_calendar",
    description: "Open an interactive calendar for viewing, scheduling, editing, rescheduling, tagging, and removing social posts.",
    inputSchema: {
      type: "object",
      properties: {
        start_date: { type: "string", format: "date", description: "Optional inclusive start date" },
        end_date: { type: "string", format: "date", description: "Optional inclusive end date" },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    _meta: {
      "ui/resourceUri": CALENDAR_RESOURCE_URI,
      ui: { resourceUri: CALENDAR_RESOURCE_URI, visibility: ["model"] },
    },
  },
  {
    name: "list_scheduled_posts",
    description: "List scheduled social posts. Optionally filter by date range, target network, or tag. This tool returns data without opening a UI.",
    inputSchema: {
      type: "object",
      properties: {
        start_date: { type: "string", format: "date", description: "Optional inclusive start date" },
        end_date: { type: "string", format: "date", description: "Optional inclusive end date" },
        target: { type: "string", enum: ["X", "LinkedIn", "Instagram"] },
        tag: { type: "string", minLength: 1, maxLength: CALENDAR_TAG_MAX_LENGTH },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "schedule_post",
    description: "Create a scheduled social post on the content calendar. This is a headless tool and does not open a UI.",
    inputSchema: {
      type: "object",
      properties: editableProperties,
      required: ["title", "copy", "date", "time", "targets"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: "update_scheduled_post",
    description: "Update the content, schedule, target networks, or tags of an existing scheduled post. Only supplied fields are changed.",
    inputSchema: {
      type: "object",
      properties: { ...postProperties, ...editableProperties },
      required: ["post_id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "reschedule_post",
    description: "Move an existing scheduled post to a new date and time without changing its content.",
    inputSchema: {
      type: "object",
      properties: {
        ...postProperties,
        date: editableProperties.date,
        time: editableProperties.time,
      },
      required: ["post_id", "date", "time"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "remove_scheduled_post",
    description: "Remove a scheduled post from the active calendar while retaining its immutable event history.",
    inputSchema: {
      type: "object",
      properties: postProperties,
      required: ["post_id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
] as const

const calendarToolNames = new Set(calendarMcpToolDefinitions.map((tool) => tool.name))

export function isCalendarMcpTool(name: string) {
  return calendarToolNames.has(name as (typeof calendarMcpToolDefinitions)[number]["name"])
}

export type PendingCalendarEvent = {
  aggregateId: string
  eventType: CalendarEventType
  payload: Record<string, unknown>
  revertsEventId?: number
}

export interface CalendarMcpStore {
  load(teamId: string): Promise<CalendarEvent[]>
  append(teamId: string, actorId: string, events: PendingCalendarEvent[]): Promise<void>
}

type CalendarEventRow = {
  id: unknown
  aggregate_id: unknown
  event_type: unknown
  payload: unknown
  reverts_event_id: unknown
  actor_id: unknown
  created_at: unknown
}

export function createSupabaseCalendarMcpStore(client: Pick<SupabaseClient, "from">): CalendarMcpStore {
  return {
    async load(teamId) {
      const { data, error } = await client.from("calendar_events")
        .select("id, aggregate_id, event_type, payload, reverts_event_id, actor_id, created_at")
        .eq("team_id", teamId).order("id").limit(5000)
      if (error) throw new Error(error.message)
      return ((data ?? []) as CalendarEventRow[]).map((row) => {
        const actorId = String(row.actor_id)
        return {
          id: Number(row.id),
          aggregateId: String(row.aggregate_id),
          eventType: String(row.event_type) as CalendarEventType,
          payload: row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
            ? row.payload as Record<string, unknown> : {},
          revertsEventId: row.reverts_event_id === null ? null : Number(row.reverts_event_id),
          actorId,
          actor: { id: actorId, email: null, displayName: `User ${actorId.slice(0, 8)}` },
          createdAt: String(row.created_at),
        }
      })
    },
    async append(teamId, actorId, events) {
      const rows = events.map((event) => ({
        team_id: teamId,
        aggregate_id: event.aggregateId,
        client_event_id: crypto.randomUUID(),
        event_type: event.eventType,
        payload: event.payload,
        reverts_event_id: event.revertsEventId ?? null,
        actor_id: actorId,
      }))
      const { error } = await client.from("calendar_events").upsert(rows, {
        onConflict: "team_id,client_event_id", ignoreDuplicates: true,
      })
      if (error) throw new Error(error.message)
    },
  }
}

export class CalendarMcpError extends Error {}

export type CalendarMcpPost = Pick<CalendarPost,
  "id" | "title" | "copy" | "date" | "time" | "targets" | "tags" | "revision" | "approval">

export type CalendarMcpPayload = {
  _type: "calendar"
  operation: "list" | "create" | "update" | "reschedule" | "remove"
  posts: CalendarMcpPost[]
  changedPostId?: string
}

export type CalendarMcpToolResult = {
  content: Array<{ type: "text"; text: string }>
  structuredContent: CalendarMcpPayload
}

export async function executeCalendarMcpTool(
  store: CalendarMcpStore,
  context: { teamId: string; userId: string },
  name: string,
  input: unknown,
): Promise<CalendarMcpToolResult> {
  const args = objectInput(input)
  if (name === "open_calendar" || name === "list_scheduled_posts") {
    const posts = filterPosts(replayCalendar(await store.load(context.teamId)), args)
    return result("list", posts)
  }
  if (name === "schedule_post") {
    const aggregateId = crypto.randomUUID()
    const post = parseNewPost(args)
    await store.append(context.teamId, context.userId, [{
      aggregateId,
      eventType: "post.created",
      payload: post,
    }])
    return result("create", replayCalendar(await store.load(context.teamId)), aggregateId)
  }

  const postId = requiredPostId(args)
  const posts = replayCalendar(await store.load(context.teamId))
  const post = posts.find((candidate) => candidate.id === postId)
  if (!post) throw new CalendarMcpError(`Scheduled post ${postId} was not found.`)
  validateExpectedRevision(args, post)

  if (name === "remove_scheduled_post") {
    await store.append(context.teamId, context.userId, [{
      aggregateId: postId,
      eventType: "change.reverted",
      payload: {},
      revertsEventId: post.createdEventId,
    }])
    return result("remove", replayCalendar(await store.load(context.teamId)), postId)
  }
  if (name === "reschedule_post") {
    const date = requiredDate(args, "date")
    const time = requiredTime(args, "time")
    if (post.date !== date || post.time !== time) {
      await store.append(context.teamId, context.userId, [{
        aggregateId: postId, eventType: "schedule.changed", payload: { date, time },
      }])
    }
    return result("reschedule", replayCalendar(await store.load(context.teamId)), postId)
  }
  if (name === "update_scheduled_post") {
    const changes = changedEvents(post, args)
    if (changes.length === 0 && !hasEditableField(args)) {
      throw new CalendarMcpError("Provide at least one post field to update.")
    }
    if (changes.length) await store.append(context.teamId, context.userId, changes)
    return result("update", replayCalendar(await store.load(context.teamId)), postId)
  }
  throw new CalendarMcpError(`Unknown calendar tool: ${name}`)
}

function objectInput(input: unknown) {
  if (input === undefined) return {} as Record<string, unknown>
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new CalendarMcpError("Tool arguments must be an object.")
  }
  return input as Record<string, unknown>
}

function parseNewPost(args: Record<string, unknown>) {
  return {
    title: requiredTitle(args),
    copy: requiredCopy(args),
    date: requiredDate(args, "date"),
    time: requiredTime(args, "time"),
    targets: requiredTargets(args),
    tags: args.tags === undefined ? [] : requiredTags(args),
  }
}

function requiredPostId(args: Record<string, unknown>) {
  const value = args.post_id
  if (typeof value !== "string" || !uuidPattern.test(value)) {
    throw new CalendarMcpError("post_id must be a valid UUID.")
  }
  return value
}

function requiredTitle(args: Record<string, unknown>) {
  if (typeof args.title !== "string") throw new CalendarMcpError("title is required.")
  const title = args.title.trim()
  if (!title || title.length > 160) throw new CalendarMcpError("title must contain between 1 and 160 characters.")
  return title
}

function requiredCopy(args: Record<string, unknown>) {
  if (typeof args.copy !== "string" || args.copy.length > 10000) {
    throw new CalendarMcpError("copy is required and must be at most 10,000 characters.")
  }
  return args.copy
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !datePattern.test(value)) return false
  const [year, month, day] = value.split("-").map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

function requiredDate(args: Record<string, unknown>, key: string) {
  const value = args[key]
  if (!validDate(value)) throw new CalendarMcpError(`${key} must be a valid date in YYYY-MM-DD format.`)
  return value
}

function requiredTime(args: Record<string, unknown>, key: string) {
  const value = args[key]
  if (typeof value !== "string" || !timePattern.test(value)) {
    throw new CalendarMcpError(`${key} must be a valid time in HH:mm format.`)
  }
  return value
}

function requiredTargets(args: Record<string, unknown>) {
  const value = args.targets
  if (!Array.isArray(value) || value.length === 0
    || new Set(value).size !== value.length
    || !value.every((target): target is CalendarTarget => targets.has(target as CalendarTarget))) {
    throw new CalendarMcpError("targets must contain one or more unique supported social networks.")
  }
  return value
}

function requiredTags(args: Record<string, unknown>) {
  if (!isValidCalendarTags(args.tags)) {
    throw new CalendarMcpError(`tags must contain at most ${CALENDAR_TAG_LIMIT} unique values of ${CALENDAR_TAG_MAX_LENGTH} characters or fewer.`)
  }
  return args.tags
}

function validateExpectedRevision(args: Record<string, unknown>, post: CalendarPost) {
  if (args.expected_revision === undefined) return
  if (!Number.isSafeInteger(args.expected_revision) || Number(args.expected_revision) !== post.revision) {
    throw new CalendarMcpError(`Post ${post.id} is now at revision ${post.revision}; refresh the calendar before editing it.`)
  }
}

function hasEditableField(args: Record<string, unknown>) {
  return ["title", "copy", "date", "time", "targets", "tags"].some((key) => key in args)
}

function changedEvents(post: CalendarPost, args: Record<string, unknown>): PendingCalendarEvent[] {
  const changes: PendingCalendarEvent[] = []
  const add = (eventType: CalendarEventType, payload: Record<string, unknown>) => {
    changes.push({ aggregateId: post.id, eventType, payload })
  }
  if ("title" in args) {
    const title = requiredTitle(args)
    if (title !== post.title) add("title.changed", { value: title })
  }
  if ("copy" in args) {
    const copy = requiredCopy(args)
    if (copy !== post.copy) add("copy.changed", { value: copy })
  }
  if ("date" in args || "time" in args) {
    const date = "date" in args ? requiredDate(args, "date") : post.date
    const time = "time" in args ? requiredTime(args, "time") : post.time
    if (date !== post.date || time !== post.time) add("schedule.changed", { date, time })
  }
  if ("targets" in args) {
    const nextTargets = requiredTargets(args)
    nextTargets.filter((target) => !post.targets.includes(target))
      .forEach((value) => add("target.added", { value }))
    post.targets.filter((target) => !nextTargets.includes(target))
      .forEach((value) => add("target.removed", { value }))
  }
  if ("tags" in args) {
    const nextTags = requiredTags(args)
    const currentKeys = new Set(post.tags.map((tag) => tag.toLowerCase()))
    const nextKeys = new Set(nextTags.map((tag) => tag.toLowerCase()))
    nextTags.filter((tag) => !currentKeys.has(tag.toLowerCase()))
      .forEach((value) => add("tag.added", { value }))
    post.tags.filter((tag) => !nextKeys.has(tag.toLowerCase()))
      .forEach((value) => add("tag.removed", { value }))
  }
  return changes
}

function filterPosts(posts: CalendarPost[], args: Record<string, unknown>) {
  const startDate = args.start_date === undefined ? null : requiredDate(args, "start_date")
  const endDate = args.end_date === undefined ? null : requiredDate(args, "end_date")
  if (startDate && endDate && startDate > endDate) {
    throw new CalendarMcpError("start_date must not be after end_date.")
  }
  const target = args.target
  if (target !== undefined && (typeof target !== "string" || !targets.has(target as CalendarTarget))) {
    throw new CalendarMcpError("target must be X, LinkedIn, or Instagram.")
  }
  const tag = args.tag
  if (tag !== undefined && (typeof tag !== "string" || !tag.trim() || tag.length > CALENDAR_TAG_MAX_LENGTH)) {
    throw new CalendarMcpError(`tag must contain between 1 and ${CALENDAR_TAG_MAX_LENGTH} characters.`)
  }
  return posts
    .filter((post) => !startDate || post.date >= startDate)
    .filter((post) => !endDate || post.date <= endDate)
    .filter((post) => !target || post.targets.includes(target as CalendarTarget))
    .filter((post) => !tag || post.tags.some((candidate) => candidate.toLowerCase() === tag.trim().toLowerCase()))
}

function publicPosts(posts: CalendarPost[]): CalendarMcpPost[] {
  return [...posts].sort((left, right) => `${left.date}T${left.time}`.localeCompare(`${right.date}T${right.time}`))
    .map(({ id, title, copy, date, time, targets: postTargets, tags, revision, approval }) => ({
      id, title, copy, date, time, targets: postTargets, tags, revision, approval,
    }))
}

function result(
  operation: CalendarMcpPayload["operation"],
  posts: CalendarPost[],
  changedPostId?: string,
): CalendarMcpToolResult {
  const payload: CalendarMcpPayload = {
    _type: "calendar",
    operation,
    posts: publicPosts(posts),
    ...(changedPostId ? { changedPostId } : {}),
  }
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    structuredContent: payload,
  }
}
