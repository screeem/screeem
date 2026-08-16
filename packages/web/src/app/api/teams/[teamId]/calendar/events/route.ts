import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { getMembership } from "@/lib/teams/server"
import type { CalendarActor, CalendarEventType, CalendarTarget } from "@/lib/calendar/events"

const eventTypes = new Set<CalendarEventType>([
  "post.created", "title.changed", "copy.changed", "schedule.changed", "colour.changed",
  "target.added", "target.removed", "change.reverted",
])
const targets = new Set<CalendarTarget>(["X", "LinkedIn", "Instagram"])
const colours = new Set(["violet", "coral", "teal", "blue"])
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

async function authorize(teamId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  if (!await getMembership(user.id, teamId)) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
  }
  return { user }
}

function validPayload(type: CalendarEventType, payload: Record<string, unknown>) {
  if (type === "post.created") {
    return typeof payload.title === "string" && payload.title.trim().length > 0
      && payload.title.length <= 160 && typeof payload.copy === "string" && payload.copy.length <= 10000
      && typeof payload.date === "string" && typeof payload.time === "string"
      && colours.has(String(payload.colour)) && Array.isArray(payload.targets)
      && payload.targets.length > 0 && payload.targets.every((target) => targets.has(target as CalendarTarget))
  }
  if (type === "title.changed") return typeof payload.value === "string" && payload.value.trim().length > 0 && payload.value.length <= 160
  if (type === "copy.changed") return typeof payload.value === "string" && payload.value.length <= 10000
  if (type === "colour.changed") return colours.has(String(payload.value))
  if (type === "target.added" || type === "target.removed") return targets.has(payload.value as CalendarTarget)
  if (type === "schedule.changed") return typeof payload.date === "string" && typeof payload.time === "string"
  return type === "change.reverted"
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

const actorFallback = (id: string): CalendarActor => ({
  id,
  email: null,
  displayName: `User ${id.slice(0, 8)}`,
})

function userDisplayName(user: { email?: string | null; user_metadata?: Record<string, unknown> } | null | undefined) {
  const metadata = user?.user_metadata ?? {}
  for (const key of ["full_name", "name", "display_name"]) {
    const value = metadata[key]
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return user?.email ?? null
}

async function loadActors(
  admin: ReturnType<typeof createAdminClient>,
  rows: readonly CalendarEventRow[],
) {
  const actors = new Map<string, CalendarActor>()
  const actorIds = [...new Set(rows.map((row) => String(row.actor_id)).filter(Boolean))]
  await Promise.all(actorIds.map(async (id) => {
    const { data } = await admin.auth.admin.getUserById(id)
    const user = data.user as { email?: string | null; user_metadata?: Record<string, unknown> } | null
    actors.set(id, {
      id,
      email: user?.email ?? null,
      displayName: userDisplayName(user) ?? actorFallback(id).displayName,
    })
  }))
  return actors
}

function serialize(row: CalendarEventRow, actors: ReadonlyMap<string, CalendarActor>) {
  const actorId = String(row.actor_id)
  const actor = actors.get(actorId) ?? actorFallback(actorId)
  return {
    id: Number(row.id), aggregateId: row.aggregate_id, eventType: row.event_type,
    payload: row.payload, revertsEventId: row.reverts_event_id === null ? null : Number(row.reverts_event_id),
    actorId, actor, createdAt: row.created_at,
  }
}

export async function GET(request: NextRequest, context: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await context.params
  const auth = await authorize(teamId)
  if (auth.error) return auth.error
  const after = Math.max(0, Number(request.nextUrl.searchParams.get("after") ?? 0) || 0)
  const admin = createAdminClient()
  const { data, error } = await admin.from("calendar_events")
    .select("id, aggregate_id, event_type, payload, reverts_event_id, actor_id, created_at")
    .eq("team_id", teamId).gt("id", after).order("id").limit(5000)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const rows = (data ?? []) as CalendarEventRow[]
  const actors = await loadActors(admin, rows)
  return NextResponse.json({ events: rows.map((row) => serialize(row, actors)) })
}

export async function POST(request: NextRequest, context: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await context.params
  const auth = await authorize(teamId)
  if (auth.error) return auth.error
  const body = await request.json().catch(() => null) as { events?: unknown[] } | null
  if (!body?.events?.length || body.events.length > 50) {
    return NextResponse.json({ error: "Provide between 1 and 50 events" }, { status: 400 })
  }
  const rows = []
  for (const raw of body.events) {
    if (!raw || typeof raw !== "object") return NextResponse.json({ error: "Invalid event" }, { status: 400 })
    const item = raw as Record<string, unknown>
    const type = item.eventType as CalendarEventType
    const payload = item.payload
    if (!eventTypes.has(type) || !uuidPattern.test(String(item.aggregateId))
      || !uuidPattern.test(String(item.clientEventId)) || !payload || typeof payload !== "object"
      || Array.isArray(payload) || !validPayload(type, payload as Record<string, unknown>)) {
      return NextResponse.json({ error: "Invalid calendar event" }, { status: 400 })
    }
    const reverts = type === "change.reverted" ? Number(item.revertsEventId) : null
    if (type === "change.reverted" && (!Number.isSafeInteger(reverts) || reverts! <= 0)) {
      return NextResponse.json({ error: "Invalid reverted event" }, { status: 400 })
    }
    rows.push({ team_id: teamId, aggregate_id: item.aggregateId, client_event_id: item.clientEventId,
      event_type: type, payload, reverts_event_id: reverts, actor_id: auth.user!.id })
  }
  const revertedIds = rows.flatMap((row) => row.reverts_event_id === null ? [] : [row.reverts_event_id])
  const admin = createAdminClient()
  if (revertedIds.length) {
    const { data } = await admin.from("calendar_events").select("id, aggregate_id")
      .eq("team_id", teamId).in("id", revertedIds)
    if (data?.length !== new Set(revertedIds).size) {
      return NextResponse.json({ error: "Reverted event does not belong to this calendar" }, { status: 400 })
    }
    for (const row of rows) {
      const reverted = data.find((item) => Number(item.id) === row.reverts_event_id)
      if (row.reverts_event_id !== null && reverted?.aggregate_id !== row.aggregate_id) {
        return NextResponse.json({ error: "Revert must target the same post" }, { status: 400 })
      }
    }
  }
  const { data, error } = await admin.from("calendar_events").upsert(rows, {
    onConflict: "team_id,client_event_id", ignoreDuplicates: true,
  }).select("id, aggregate_id, event_type, payload, reverts_event_id, actor_id, created_at")
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const persistedRows = (data ?? []) as CalendarEventRow[]
  const actors = await loadActors(admin, persistedRows)
  return NextResponse.json({ events: persistedRows.map((row) => serialize(row, actors)) }, { status: 201 })
}
