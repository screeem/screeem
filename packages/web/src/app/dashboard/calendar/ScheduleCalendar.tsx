"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { CalendarTagEditor } from "@/components/calendar/CalendarTagEditor"
import { activeCalendarEventIds, isApprovalEventType, replayCalendar } from "@/lib/calendar/events"
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
  X: "bg-platform-x text-platform-x-foreground",
  LinkedIn: "bg-platform-linkedin text-platform-linkedin-foreground",
  Instagram: "bg-gradient-to-br from-platform-instagram-from via-platform-instagram-via to-platform-instagram-to text-platform-instagram-foreground",
}

const approvalStyle: Record<CalendarApprovalStatus, string> = {
  draft: "bg-secondary text-secondary-foreground",
  in_review: "bg-warning-subtle text-warning-text",
  changes_requested: "bg-error-subtle text-error-text",
  approved: "bg-success-subtle text-success-text",
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
  return <span title={target} className={`grid size-5 place-items-center rounded-full text-[9px] font-bold ring-2 ring-card ${targetStyle[target]}`}>{target === "Instagram" ? "I" : target === "LinkedIn" ? "in" : "X"}</span>
}

function actorLabel(event: CalendarEvent) {
  return event.actor.displayName || event.actor.email || `User ${event.actorId.slice(0, 8)}`
}

export function ScheduleCalendar({ teamId }: { teamId: string }) {
  const [cursor, setCursor] = useState(new Date(Date.UTC(2026, 7, 1)))
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [selected, setSelected] = useState<Post | null>(null)
  const [composing, setComposing] = useState(false)
  const [filter, setFilter] = useState<Target | "All">("All")
  const [approvalFilter, setApprovalFilter] = useState<CalendarApprovalStatus | "All">("All")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
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

  const visible = posts.filter((post) => (filter === "All" || post.targets.includes(filter))
    && (approvalFilter === "All" || post.approval.status === approvalFilter))

  function shiftMonth(amount: number) {
    setCursor(new Date(Date.UTC(year, month + amount, 1)))
  }

  function openNew(date = isoDate(year, month, 14)) {
    setSelected({
      id: "", title: "", copy: "", date, time: "09:00", targets: ["X"], tags: [],
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
        targets: next.targets, tags: next.tags,
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
      next.tags.filter((tag) => !original.tags.includes(tag)).forEach((value) => add("tag.added", { value }))
      original.tags.filter((tag) => !next.tags.includes(tag)).forEach((value) => add("tag.removed", { value }))
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
    <div className="pb-10 text-foreground">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[.18em] text-muted-foreground"><span className="size-2 rounded-full bg-muted-foreground" /> Publishing workspace</div>
          <h1 className="text-3xl font-semibold tracking-tight">Content calendar</h1>
          <p className="mt-2 text-sm text-muted-foreground">Plan once, publish everywhere. Every change stays in the timeline.</p>
        </div>
        <button onClick={() => openNew()} className="rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:bg-primary-hover">+ Schedule post</button>
      </div>
      {error ? <p role="alert" className="mt-4 rounded-lg bg-error-subtle px-4 py-3 text-sm text-error-text">{error}</p> : null}

      <div className="mt-8 overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <button onClick={() => shiftMonth(-1)} aria-label="Previous month" className="grid size-8 place-items-center rounded-md border border-border text-muted-foreground hover:bg-accent">‹</button>
            <button onClick={() => shiftMonth(1)} aria-label="Next month" className="grid size-8 place-items-center rounded-md border border-border text-muted-foreground hover:bg-accent">›</button>
            <h2 className="ml-2 text-base font-semibold">{monthName.format(cursor)}</h2>
          </div>
          <div className="flex rounded-lg bg-muted p-1">
            {(["All", "X", "LinkedIn", "Instagram"] as const).map((target) => <button key={target} onClick={() => setFilter(target)} className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${filter === target ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>{target}</button>)}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 border-b border-border bg-muted/60 px-5 py-3">
          {(["All", "draft", "in_review", "changes_requested", "approved"] as const).map((status) => <button key={status} onClick={() => setApprovalFilter(status)} className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${approvalFilter === status ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground ring-1 ring-border hover:text-foreground"}`}>{status === "All" ? "All approvals" : approvalLabel[status]}</button>)}
        </div>
        <div className="grid grid-cols-7 border-b border-border bg-muted/70">
          {weekdays.map((day) => <div key={day} className="px-2 py-2.5 text-center text-[10px] font-bold tracking-widest text-muted-foreground">{day}</div>)}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((cell, index) => {
            const dayPosts = cell ? visible.filter((post) => post.date === cell.date) : []
            const today = cell?.date === "2026-08-14"
            return <div key={index} onDoubleClick={() => cell && openNew(cell.date)} className={`min-h-28 border-b border-r border-border p-1.5 sm:min-h-32 ${!cell ? "bg-muted/50" : "bg-card hover:bg-accent/40"}`}>
              {cell && <div className={`mb-1 ml-1 grid size-6 place-items-center rounded-full text-xs ${today ? "bg-primary font-semibold text-primary-foreground" : "text-muted-foreground"}`}>{cell.day}</div>}
              {dayPosts.map((post) => <Link key={post.id} href={`/dashboard/calendar/${post.id}`} className="mb-1 block w-full rounded-md border border-border bg-muted/70 px-2 py-1.5 text-left transition hover:-translate-y-px hover:shadow-sm">
                <span className="block truncate text-[11px] font-semibold text-foreground">{post.title}</span>
                {post.tags.length ? <span className="mt-1 flex min-w-0 gap-1 overflow-hidden text-[9px] text-muted-foreground">{post.tags.slice(0, 2).map((tag) => <span key={tag.toLowerCase()} className="max-w-20 truncate rounded-full bg-card px-1.5 py-0.5 ring-1 ring-border">#{tag}</span>)}{post.tags.length > 2 ? <span className="py-0.5">+{post.tags.length - 2}</span> : null}</span> : null}
                <span className="mt-1 flex items-center justify-between gap-1 text-[9px] text-muted-foreground"><span className={`rounded-full px-1.5 py-0.5 font-medium ${approvalStyle[post.approval.status]}`}>{approvalLabel[post.approval.status]}</span><span>{post.time}</span><span className="flex -space-x-1">{post.targets.map((target) => <TargetDot key={target} target={target} />)}</span></span>
              </Link>)}
            </div>
          })}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>Tip: double-click any day to schedule there.</span>
        <span className="flex items-center gap-4"><i className="size-2 rounded-full bg-success" /> {busy ? "Syncing…" : "Synced"} <span className="text-muted-foreground">•</span> {visible.length} active posts</span>
      </div>

      {events.length ? (
        <section className="mt-6 rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold">Calendar event log</h2>
              <p className="mt-1 text-xs text-muted-foreground">Append-only history, including reverted changes.</p>
            </div>
            <span className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
              {events.length} events
            </span>
          </div>
          <div className="mt-4 divide-y divide-border">
            {[...events].sort((a, b) => b.id - a.id).slice(0, 12).map((event) => (
              <div key={event.id} className="flex items-center justify-between gap-4 py-3 text-xs">
                <div className="min-w-0">
                  <span className="font-semibold text-foreground">{event.eventType}</span>
                  <span className="ml-2 text-muted-foreground">#{event.id}</span>
                  <p className="mt-0.5 truncate text-muted-foreground">Post {event.aggregateId.slice(0, 8)} · by {actorLabel(event)}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className={activeEventIds.has(event.id) ? "text-success-text" : "text-muted-foreground"}>
                    {activeEventIds.has(event.id) ? "Active" : "Reverted"}
                  </span>
                  {activeEventIds.has(event.id) && !isApprovalEventType(event.eventType) ? (
                    <button disabled={busy} onClick={() => void revert(event)} className="rounded-md border border-border px-2.5 py-1.5 font-medium text-primary hover:bg-primary-subtle disabled:opacity-40">Revert</button>
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
          busy={busy}
          onClose={() => setComposing(false)}
          onSave={save}
        />
      ) : null}
    </div>
  )
}

function PostEditor({
  post, busy, onClose, onSave,
}: {
  post: Post
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
  return <div className="fixed inset-0 z-50 flex justify-end bg-overlay backdrop-blur-[2px]" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <aside className="flex h-full w-full max-w-md flex-col bg-card shadow-lg">
      <div className="flex items-center justify-between border-b border-border px-6 py-5"><div><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{post.id ? "Edit incrementally" : "New calendar entry"}</p><h2 className="mt-1 text-xl font-semibold">{post.id ? post.title : "Schedule a post"}</h2></div><button onClick={onClose} className="grid size-9 place-items-center rounded-full bg-muted text-xl text-muted-foreground">×</button></div>
      <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
        <label className="block text-xs font-semibold text-muted-foreground">Title<input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="Give this post a name" className="mt-2 w-full rounded-lg border border-border px-3 py-2.5 text-sm font-normal outline-none focus:border-primary focus:ring-2 focus:ring-ring/30" /></label>
        <label className="block text-xs font-semibold text-muted-foreground">Post copy<textarea value={draft.copy} onChange={(event) => setDraft({ ...draft, copy: event.target.value })} rows={5} placeholder="What do you want to share?" className="mt-2 w-full resize-none rounded-lg border border-border px-3 py-2.5 text-sm font-normal leading-6 outline-none focus:border-primary focus:ring-2 focus:ring-ring/30" /><span className="mt-1 block text-right font-normal text-muted-foreground">{draft.copy.length} characters</span></label>
        <div className="grid grid-cols-2 gap-3"><label className="text-xs font-semibold text-muted-foreground">Date<input type="date" value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} className="mt-2 w-full rounded-lg border border-border px-3 py-2.5 text-sm font-normal" /></label><label className="text-xs font-semibold text-muted-foreground">Time<input type="time" value={draft.time} onChange={(event) => setDraft({ ...draft, time: event.target.value })} className="mt-2 w-full rounded-lg border border-border px-3 py-2.5 text-sm font-normal" /></label></div>
        <fieldset><legend className="text-xs font-semibold text-muted-foreground">Publish to</legend><div className="mt-2 flex flex-wrap gap-2">{(["X", "LinkedIn", "Instagram"] as Target[]).map((target) => <button type="button" key={target} onClick={() => toggleTarget(target)} className={`flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-medium ${draft.targets.includes(target) ? "border-primary bg-primary-subtle text-primary" : "border-border text-muted-foreground"}`}><TargetDot target={target} />{target}</button>)}</div></fieldset>
        <CalendarTagEditor tags={draft.tags} onChange={(tags) => setDraft({ ...draft, tags })} />
      </div>
      <div className="flex items-center justify-between border-t border-border px-6 py-4"><span className="text-xs text-muted-foreground">Append-only sync</span><div className="flex gap-2"><button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-semibold text-muted-foreground hover:bg-accent">Cancel</button><button disabled={busy || !draft.title.trim() || draft.targets.length === 0} onClick={() => void onSave(draft)} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40">{busy ? "Saving…" : post.id ? "Append changes" : "Schedule post"}</button></div></div>
    </aside>
  </div>
}
