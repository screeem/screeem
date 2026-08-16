"use client"

import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { useEffect, useMemo, useState } from "react"
import { activeCalendarEventIds, isApprovalEventType, replayCalendar } from "@/lib/calendar/events"
import { getSocialAccounts, type SocialAccount } from "@/lib/queries/profile"
import {
  configuredCalendarTargets,
  socialPlatformDefinitionForTarget,
} from "@/lib/social-platforms"
import type {
  CalendarApprovalStatus,
  CalendarEvent,
  CalendarEventType,
  CalendarPost,
  CalendarTarget,
} from "@/lib/calendar/events"

type Target = CalendarTarget
type Post = CalendarPost

const targetStyle: Record<Target, string> = {
  X: "bg-slate-900 text-white",
  LinkedIn: "bg-blue-600 text-white",
  Instagram: "bg-gradient-to-br from-fuchsia-500 to-orange-400 text-white",
}

const colourStyle: Record<string, string> = {
  violet: "border-l-violet-500 bg-violet-50/70",
  coral: "border-l-orange-500 bg-orange-50/70",
  teal: "border-l-teal-500 bg-teal-50/70",
  blue: "border-l-blue-500 bg-blue-50/70",
}

const approvalStyle: Record<CalendarApprovalStatus, string> = {
  draft: "bg-slate-200 text-slate-600",
  in_review: "bg-amber-200 text-amber-800",
  changes_requested: "bg-orange-200 text-orange-800",
  approved: "bg-emerald-200 text-emerald-800",
}

const approvalLabel: Record<CalendarApprovalStatus, string> = {
  draft: "Draft", in_review: "In review",
  changes_requested: "Changes", approved: "Approved",
}

const monthName = new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" })
const weekdays = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]

function isoDate(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

function TargetDot({ target }: { target: Target }) {
  const definition = socialPlatformDefinitionForTarget(target)
  return <span title={target} className={`grid size-5 place-items-center rounded-full text-[9px] font-bold ring-2 ring-white ${targetStyle[target]}`}>{definition.badge}</span>
}

function actorLabel(event: CalendarEvent) {
  return event.actor.displayName || event.actor.email || `User ${event.actorId.slice(0, 8)}`
}

export function ScheduleCalendar({
  teamId,
  canManageAccounts,
}: {
  teamId: string
  canManageAccounts: boolean
}) {
  const [cursor, setCursor] = useState(new Date(Date.UTC(2026, 7, 1)))
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [selected, setSelected] = useState<Post | null>(null)
  const [composing, setComposing] = useState(false)
  const [filter, setFilter] = useState<Target | "All">("All")
  const [approvalFilter, setApprovalFilter] = useState<CalendarApprovalStatus | "All">("All")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const accountsQuery = useQuery({
    queryKey: ["social-accounts", teamId],
    queryFn: () => getSocialAccounts(teamId),
  })
  const accounts = useMemo(() => accountsQuery.data ?? [], [accountsQuery.data])
  const availableTargets = useMemo(() => configuredCalendarTargets(accounts), [accounts])
  const posts = useMemo(() => replayCalendar(events), [events])
  const activeEventIds = useMemo(() => activeCalendarEventIds(events), [events])

  async function sync() {
    const response = await fetch(`/api/teams/${teamId}/calendar/events`)
    const body = await response.json()
    if (!response.ok) throw new Error(body.error || "Could not sync calendar")
    const nextEvents = body.events ?? []
    setEvents(nextEvents)
    return nextEvents as CalendarEvent[]
  }

  useEffect(() => {
    let stopped = false
    fetch(`/api/teams/${teamId}/calendar/events`).then(async (response) => {
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || "Could not sync calendar")
      if (!stopped) setEvents(body.events ?? [])
    }).catch((reason) => { if (!stopped) setError(reason.message) })
    return () => { stopped = true }
  }, [teamId])

  const year = cursor.getUTCFullYear()
  const month = cursor.getUTCMonth()
  const cells = useMemo(() => {
    const first = new Date(Date.UTC(year, month, 1))
    const offset = (first.getUTCDay() + 6) % 7
    const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
    return Array.from({ length: 42 }, (_, index) => {
      const day = index - offset + 1
      if (day < 1 || day > days) return null
      return { day, date: isoDate(year, month, day) }
    })
  }, [year, month])

  const activeFilter = filter !== "All" && !availableTargets.includes(filter) ? "All" : filter
  const visible = posts.filter((post) => (activeFilter === "All" || post.targets.includes(activeFilter))
    && (approvalFilter === "All" || post.approval.status === approvalFilter))

  function shiftMonth(amount: number) {
    setCursor(new Date(Date.UTC(year, month + amount, 1)))
  }

  function openNew(date = isoDate(year, month, 14)) {
    const defaultTarget = availableTargets[0]
    if (!defaultTarget) return
    setSelected({
      id: "", title: "", copy: "", date, time: "09:00", targets: [defaultTarget], colour: "violet",
      createdEventId: 0, activeEventIds: [], revision: 1,
      approval: { status: "draft", reviewRevision: null, requestedBy: null, comment: "" },
    })
    setComposing(true)
  }

  type PendingEvent = {
    aggregateId: string
    eventType: CalendarEventType
    payload: Record<string, unknown>
    revertsEventId?: number
  }

  async function append(changes: PendingEvent[]) {
    setBusy(true)
    setError("")
    try {
      const response = await fetch(`/api/teams/${teamId}/calendar/events`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events: changes.map((change) => ({ ...change, clientEventId: crypto.randomUUID() })) }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || "Could not save changes")
      return await sync()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save changes")
      throw reason
    } finally { setBusy(false) }
  }

  async function save(next: Post) {
    if (!next.title.trim() || next.targets.length === 0) return
    if (!next.id) {
      const aggregateId = crypto.randomUUID()
      await append([{ aggregateId, eventType: "post.created", payload: {
        title: next.title, copy: next.copy, date: next.date, time: next.time,
        targets: next.targets, colour: next.colour,
      } }])
    } else {
      const original = posts.find((post) => post.id === next.id)
      if (!original) return
      const changes: PendingEvent[] = []
      const add = (eventType: CalendarEventType, payload: Record<string, unknown>) => {
        changes.push({ aggregateId: next.id, eventType, payload })
      }
      if (original.title !== next.title) add("title.changed", { value: next.title })
      if (original.copy !== next.copy) add("copy.changed", { value: next.copy })
      if (original.date !== next.date || original.time !== next.time) add("schedule.changed", { date: next.date, time: next.time })
      if (original.colour !== next.colour) add("colour.changed", { value: next.colour })
      next.targets.filter((target) => !original.targets.includes(target)).forEach((value) => add("target.added", { value }))
      original.targets.filter((target) => !next.targets.includes(target)).forEach((value) => add("target.removed", { value }))
      if (changes.length) await append(changes)
    }
    setComposing(false)
    setSelected(null)
  }

  async function revert(change: CalendarEvent) {
    const nextEvents = await append([{ aggregateId: change.aggregateId, eventType: "change.reverted", payload: {}, revertsEventId: change.id }])
    const current = replayCalendar(nextEvents).find((post) => post.id === change.aggregateId)
    setSelected(current ?? null)
    if (!current) setComposing(false)
  }

  return (
    <div className="pb-10 text-slate-900">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[.18em] text-violet-600"><span className="size-2 rounded-full bg-violet-500" /> Publishing workspace</div>
          <h1 className="text-3xl font-semibold tracking-tight">Content calendar</h1>
          <p className="mt-2 text-sm text-slate-500">Plan once, publish everywhere. Every change stays in the timeline.</p>
        </div>
        {availableTargets.length > 0 ? (
          <button disabled={accountsQuery.isLoading} onClick={() => openNew()} className="rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-violet-200 transition hover:bg-violet-700 disabled:opacity-50">+ Schedule post</button>
        ) : accountsQuery.isLoading ? (
          <button disabled className="rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white opacity-50">Loading accounts…</button>
        ) : canManageAccounts ? (
          <Link href="/dashboard/user" className="rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-violet-200 transition hover:bg-violet-700">Set up accounts</Link>
        ) : (
          <button disabled className="rounded-lg bg-slate-300 px-4 py-2.5 text-sm font-semibold text-white">Accounts required</button>
        )}
      </div>
      {error ? <p role="alert" className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}
      {accountsQuery.error ? <p role="alert" className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">Could not load social accounts.</p> : null}
      {!accountsQuery.isLoading && !accountsQuery.error && availableTargets.length === 0 ? (
        <p className="mt-4 rounded-lg border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-800">
          {canManageAccounts ? <>Set up at least one social account before scheduling a post. <Link href="/dashboard/user" className="font-semibold underline">Open user settings</Link></> : "Ask a team owner or admin to set up a social account before scheduling a post."}
        </p>
      ) : null}

      <div className="mt-8 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div className="flex items-center gap-2">
            <button onClick={() => shiftMonth(-1)} aria-label="Previous month" className="grid size-8 place-items-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50">‹</button>
            <button onClick={() => shiftMonth(1)} aria-label="Next month" className="grid size-8 place-items-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50">›</button>
            <h2 className="ml-2 text-base font-semibold">{monthName.format(cursor)}</h2>
          </div>
          <div className="flex rounded-lg bg-slate-100 p-1">
            {(["All", ...availableTargets] as const).map((target) => <button key={target} onClick={() => setFilter(target)} className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${activeFilter === target ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}>{target}</button>)}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 border-b border-slate-200 bg-slate-50/60 px-5 py-3">
          {(["All", "draft", "in_review", "changes_requested", "approved"] as const).map((status) => <button key={status} onClick={() => setApprovalFilter(status)} className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${approvalFilter === status ? "bg-violet-600 text-white" : "bg-white text-slate-500 ring-1 ring-slate-200 hover:text-slate-800"}`}>{status === "All" ? "All approvals" : approvalLabel[status]}</button>)}
        </div>
        <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50/70">
          {weekdays.map((day) => <div key={day} className="px-2 py-2.5 text-center text-[10px] font-bold tracking-widest text-slate-400">{day}</div>)}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((cell, index) => {
            const dayPosts = cell ? visible.filter((post) => post.date === cell.date) : []
            const today = cell?.date === "2026-08-14"
            return <div key={index} onDoubleClick={() => cell && availableTargets.length > 0 && openNew(cell.date)} className={`min-h-28 border-b border-r border-slate-100 p-1.5 sm:min-h-32 ${!cell ? "bg-slate-50/50" : "bg-white hover:bg-slate-50/40"}`}>
              {cell && <div className={`mb-1 ml-1 grid size-6 place-items-center rounded-full text-xs ${today ? "bg-violet-600 font-semibold text-white" : "text-slate-500"}`}>{cell.day}</div>}
              {dayPosts.map((post) => <Link key={post.id} href={`/dashboard/calendar/${post.id}`} className={`mb-1 block w-full rounded-md border-l-[3px] px-2 py-1.5 text-left transition hover:-translate-y-px hover:shadow-sm ${colourStyle[post.colour]}`}>
                <span className="block truncate text-[11px] font-semibold text-slate-800">{post.title}</span>
                <span className="mt-1 flex items-center justify-between gap-1 text-[9px] text-slate-500"><span className={`rounded-full px-1.5 py-0.5 font-medium ${approvalStyle[post.approval.status]}`}>{approvalLabel[post.approval.status]}</span><span>{post.time}</span><span className="flex -space-x-1">{post.targets.map((target) => <TargetDot key={target} target={target} />)}</span></span>
              </Link>)}
            </div>
          })}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
        <span>Tip: double-click any day to schedule there.</span>
        <span className="flex items-center gap-4"><i className="size-2 rounded-full bg-emerald-500" /> {busy ? "Syncing…" : "Synced"} <span className="text-slate-300">•</span> {visible.length} active posts</span>
      </div>

      {events.length ? (
        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold">Calendar event log</h2>
              <p className="mt-1 text-xs text-slate-500">Append-only history, including reverted changes.</p>
            </div>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-500">
              {events.length} events
            </span>
          </div>
          <div className="mt-4 divide-y divide-slate-100">
            {[...events].sort((a, b) => b.id - a.id).slice(0, 12).map((event) => (
              <div key={event.id} className="flex items-center justify-between gap-4 py-3 text-xs">
                <div className="min-w-0">
                  <span className="font-semibold text-slate-700">{event.eventType}</span>
                  <span className="ml-2 text-slate-400">#{event.id}</span>
                  <p className="mt-0.5 truncate text-slate-400">Post {event.aggregateId.slice(0, 8)} · by {actorLabel(event)}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className={activeEventIds.has(event.id) ? "text-emerald-600" : "text-slate-400"}>
                    {activeEventIds.has(event.id) ? "Active" : "Reverted"}
                  </span>
                  {activeEventIds.has(event.id) && !isApprovalEventType(event.eventType) ? (
                    <button disabled={busy} onClick={() => void revert(event)} className="rounded-md border border-slate-200 px-2.5 py-1.5 font-medium text-violet-700 hover:bg-violet-50 disabled:opacity-40">Revert</button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {composing && selected ? (
        <PostEditor
          post={selected}
          accounts={accounts}
          availableTargets={availableTargets}
          busy={busy}
          onClose={() => setComposing(false)}
          onSave={save}
        />
      ) : null}
    </div>
  )
}

function PostEditor({
  post, accounts, availableTargets, busy, onClose, onSave,
}: {
  post: Post
  accounts: SocialAccount[]
  availableTargets: Target[]
  busy: boolean
  onClose: () => void
  onSave: (post: Post) => Promise<void>
}) {
  const [draft, setDraft] = useState(post)
  const toggleTarget = (target: Target) => setDraft((current) => ({
    ...current,
    targets: current.targets.includes(target)
      ? current.targets.filter((item) => item !== target)
      : [...current.targets, target],
  }))
  return <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/25 backdrop-blur-[2px]" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <aside className="flex h-full w-full max-w-md flex-col bg-white shadow-2xl">
      <div className="flex items-center justify-between border-b border-slate-200 px-6 py-5"><div><p className="text-xs font-semibold uppercase tracking-wider text-violet-600">{post.id ? "Edit incrementally" : "New calendar entry"}</p><h2 className="mt-1 text-xl font-semibold">{post.id ? post.title : "Schedule a post"}</h2></div><button onClick={onClose} className="grid size-9 place-items-center rounded-full bg-slate-100 text-xl text-slate-500">×</button></div>
      <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
        <label className="block text-xs font-semibold text-slate-600">Title<input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="Give this post a name" className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-normal outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100" /></label>
        <label className="block text-xs font-semibold text-slate-600">Post copy<textarea value={draft.copy} onChange={(event) => setDraft({ ...draft, copy: event.target.value })} rows={5} placeholder="What do you want to share?" className="mt-2 w-full resize-none rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-normal leading-6 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100" /><span className="mt-1 block text-right font-normal text-slate-400">{draft.copy.length} characters</span></label>
        <div className="grid grid-cols-2 gap-3"><label className="text-xs font-semibold text-slate-600">Date<input type="date" value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-normal" /></label><label className="text-xs font-semibold text-slate-600">Time<input type="time" value={draft.time} onChange={(event) => setDraft({ ...draft, time: event.target.value })} className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-normal" /></label></div>
        <fieldset><legend className="text-xs font-semibold text-slate-600">Publish to</legend><div className="mt-2 flex flex-wrap gap-2">{availableTargets.map((target) => {
          const definition = socialPlatformDefinitionForTarget(target)
          const handles = accounts
            .filter((account) => account.platform === definition.id)
            .map((account) => account.label || `${definition.prefix}${account.handle}`)
          return <button type="button" key={target} onClick={() => toggleTarget(target)} className={`flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-medium ${draft.targets.includes(target) ? "border-violet-300 bg-violet-50 text-violet-800" : "border-slate-200 text-slate-500"}`}><TargetDot target={target} /><span className="text-left"><span className="block">{target}</span><span className="block max-w-40 truncate text-[10px] font-normal opacity-70">{handles.join(", ")}</span></span></button>
        })}</div></fieldset>
        <fieldset><legend className="text-xs font-semibold text-slate-600">Label colour</legend><div className="mt-2 flex gap-2">{Object.keys(colourStyle).map((colour) => <button type="button" aria-label={colour} key={colour} onClick={() => setDraft({ ...draft, colour })} className={`size-7 rounded-full ${colour === "violet" ? "bg-violet-500" : colour === "coral" ? "bg-orange-500" : colour === "teal" ? "bg-teal-500" : "bg-blue-500"} ${draft.colour === colour ? "ring-2 ring-slate-800 ring-offset-2" : ""}`} />)}</div></fieldset>
      </div>
      <div className="flex items-center justify-between border-t border-slate-200 px-6 py-4"><span className="text-xs text-slate-400">Append-only sync</span><div className="flex gap-2"><button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100">Cancel</button><button disabled={busy || !draft.title.trim() || draft.targets.length === 0} onClick={() => void onSave(draft)} className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40">{busy ? "Saving…" : post.id ? "Append changes" : "Schedule post"}</button></div></div>
    </aside>
  </div>
}
