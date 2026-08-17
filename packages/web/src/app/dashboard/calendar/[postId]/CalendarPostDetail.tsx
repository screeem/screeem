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
import type { TeamRole } from "@/lib/teams/server"

const targets: CalendarTarget[] = ["X", "LinkedIn", "Instagram"]

const approvalLabels: Record<CalendarApprovalStatus, string> = {
  draft: "Draft",
  in_review: "In review",
  changes_requested: "Changes requested",
  approved: "Approved",
}

const approvalClasses: Record<CalendarApprovalStatus, string> = {
  draft: "bg-slate-100 text-slate-600",
  in_review: "bg-amber-100 text-amber-800",
  changes_requested: "bg-orange-100 text-orange-800",
  approved: "bg-emerald-100 text-emerald-800",
}

const eventLabels: Record<CalendarEventType, string> = {
  "post.created": "Post created",
  "title.changed": "Title changed",
  "copy.changed": "Copy changed",
  "schedule.changed": "Schedule changed",
  "tag.added": "Tag added",
  "tag.removed": "Tag removed",
  "colour.changed": "Legacy label changed",
  "target.added": "Social network added",
  "target.removed": "Social network removed",
  "change.reverted": "Change reverted",
  "approval.requested": "Approval requested",
  "approval.granted": "Post approved",
  "approval.changes_requested": "Changes requested",
  "approval.withdrawn": "Approval request withdrawn",
}

function actorLabel(event: CalendarEvent) {
  return event.actor.displayName || event.actor.email || `User ${event.actorId.slice(0, 8)}`
}

function eventDetail(event: CalendarEvent) {
  if (event.eventType === "post.created") return "Initial content and schedule"
  if (event.eventType === "schedule.changed") return `${String(event.payload.date)} at ${String(event.payload.time)}`
  if (event.eventType === "target.added" || event.eventType === "target.removed"
    || event.eventType === "tag.added" || event.eventType === "tag.removed") return String(event.payload.value)
  if (event.eventType === "colour.changed") return "This legacy label is no longer used"
  if (event.eventType === "change.reverted") return `Event #${event.revertsEventId}`
  if (isApprovalEventType(event.eventType)) {
    const comment = typeof event.payload.comment === "string" ? event.payload.comment : ""
    return `Revision ${String(event.payload.revision)}${comment ? ` · ${comment}` : ""}`
  }
  return String(event.payload.value ?? "")
}

export function CalendarPostDetail({
  teamId, postId, currentUserId, role,
}: {
  teamId: string
  postId: string
  currentUserId: string
  role: TeamRole
}) {
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [draft, setDraft] = useState<CalendarPost | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [reviewComment, setReviewComment] = useState("")
  const postEvents = useMemo(() => events.filter((event) => event.aggregateId === postId), [events, postId])
  const activeEventIds = useMemo(() => activeCalendarEventIds(events), [events])
  const persistedPost = useMemo(
    () => replayCalendar(events).find((post) => post.id === postId) ?? null,
    [events, postId],
  )
  const dirty = Boolean(draft && persistedPost && (
    draft.title !== persistedPost.title || draft.copy !== persistedPost.copy
    || draft.date !== persistedPost.date || draft.time !== persistedPost.time
    || [...draft.tags].sort().join() !== [...persistedPost.tags].sort().join()
    || [...draft.targets].sort().join() !== [...persistedPost.targets].sort().join()
  ))

  async function sync() {
    const response = await fetch(`/api/teams/${teamId}/calendar/events`)
    const body = await response.json()
    if (!response.ok) throw new Error(body.error || "Could not load post")
    const nextEvents = (body.events ?? []) as CalendarEvent[]
    setEvents(nextEvents)
    const nextPost = replayCalendar(nextEvents).find((post) => post.id === postId) ?? null
    setDraft(nextPost)
    return nextEvents
  }

  useEffect(() => {
    let stopped = false
    fetch(`/api/teams/${teamId}/calendar/events`).then(async (response) => {
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || "Could not load post")
      if (stopped) return
      const nextEvents = (body.events ?? []) as CalendarEvent[]
      setEvents(nextEvents)
      setDraft(replayCalendar(nextEvents).find((post) => post.id === postId) ?? null)
    }).catch((reason) => { if (!stopped) setError(reason.message) }).finally(() => { if (!stopped) setLoading(false) })
    return () => { stopped = true }
  }, [postId, teamId])

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
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events: changes.map((change) => ({ ...change, clientEventId: crypto.randomUUID() })) }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || "Could not save changes")
      await sync()
      return true
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save changes")
      return false
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    if (!draft?.title.trim() || draft.targets.length === 0) return
    const original = replayCalendar(events).find((post) => post.id === postId)
    if (!original) return
    const changes: PendingEvent[] = []
    const add = (eventType: CalendarEventType, payload: Record<string, unknown>) => {
      changes.push({ aggregateId: postId, eventType, payload })
    }
    if (original.title !== draft.title) add("title.changed", { value: draft.title })
    if (original.copy !== draft.copy) add("copy.changed", { value: draft.copy })
    if (original.date !== draft.date || original.time !== draft.time) add("schedule.changed", { date: draft.date, time: draft.time })
    draft.tags.filter((tag) => !original.tags.includes(tag)).forEach((value) => add("tag.added", { value }))
    original.tags.filter((tag) => !draft.tags.includes(tag)).forEach((value) => add("tag.removed", { value }))
    draft.targets.filter((target) => !original.targets.includes(target)).forEach((value) => add("target.added", { value }))
    original.targets.filter((target) => !draft.targets.includes(target)).forEach((value) => add("target.removed", { value }))
    if (changes.length) await append(changes)
  }

  async function approvalAction(eventType: CalendarEventType) {
    if (!draft || dirty) return
    const saved = await append([{ aggregateId: postId, eventType, payload: {
      revision: draft.revision,
      ...(reviewComment.trim() ? { comment: reviewComment.trim() } : {}),
    } }])
    if (saved) setReviewComment("")
  }

  function toggleTarget(target: CalendarTarget) {
    setDraft((current) => current ? ({ ...current, targets: current.targets.includes(target)
      ? current.targets.filter((item) => item !== target) : [...current.targets, target] }) : current)
  }

  if (loading) return <p className="py-16 text-center text-sm text-slate-500">Loading post…</p>
  if (!draft) return <div className="rounded-xl border border-slate-200 bg-white p-8 text-center"><h1 className="text-xl font-semibold">Post not found</h1><p className="mt-2 text-sm text-slate-500">This post does not exist or is no longer active.</p><Link href="/dashboard/calendar" className="mt-5 inline-block text-sm font-semibold text-violet-700">Back to calendar</Link></div>

  return <div className="pb-10 text-slate-900">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><Link href="/dashboard/calendar" className="text-sm font-medium text-slate-500 hover:text-violet-700">← Content calendar</Link><div className="mt-3 flex flex-wrap items-center gap-3"><h1 className="text-3xl font-semibold tracking-tight">{draft.title}</h1><ApprovalBadge status={draft.approval.status} /></div><p className="mt-2 text-sm text-slate-500">Edit the post, review its previews, and inspect its complete immutable history.</p>{draft.tags.length ? <div className="mt-3 flex flex-wrap gap-2">{draft.tags.map((tag) => <span key={tag.toLowerCase()} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">#{tag}</span>)}</div> : null}</div>
      <button disabled={busy || !dirty || !draft.title.trim() || draft.targets.length === 0} onClick={() => void save()} className="rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm disabled:opacity-40">{busy ? "Saving…" : "Append changes"}</button>
    </div>
    {error ? <p role="alert" className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}

    <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(320px,.95fr)]">
      <div className="space-y-6">
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-base font-semibold">Post details</h2>
          <div className="mt-5 space-y-5">
            <label className="block text-xs font-semibold text-slate-600">Title<input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-normal outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100" /></label>
            <label className="block text-xs font-semibold text-slate-600">Post copy<textarea value={draft.copy} onChange={(event) => setDraft({ ...draft, copy: event.target.value })} rows={7} className="mt-2 w-full resize-y rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-normal leading-6 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100" /><span className="mt-1 block text-right font-normal text-slate-400">{draft.copy.length} characters</span></label>
            <div className="grid grid-cols-2 gap-3"><label className="text-xs font-semibold text-slate-600">Date<input type="date" value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-normal" /></label><label className="text-xs font-semibold text-slate-600">Time<input type="time" value={draft.time} onChange={(event) => setDraft({ ...draft, time: event.target.value })} className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-normal" /></label></div>
            <fieldset><legend className="text-xs font-semibold text-slate-600">Publish to</legend><div className="mt-2 flex flex-wrap gap-2">{targets.map((target) => <button type="button" key={target} onClick={() => toggleTarget(target)} className={`rounded-full border px-3 py-2 text-xs font-medium ${draft.targets.includes(target) ? "border-violet-300 bg-violet-50 text-violet-800" : "border-slate-200 text-slate-500"}`}>{target}</button>)}</div></fieldset>
            <CalendarTagEditor tags={draft.tags} onChange={(tags) => setDraft({ ...draft, tags })} />
          </div>
        </section>
        <ApprovalPanel
          post={draft}
          dirty={dirty}
          busy={busy}
          currentUserId={currentUserId}
          canApprove={role === "owner" || role === "admin"}
          comment={reviewComment}
          onComment={setReviewComment}
          onAction={approvalAction}
        />
        <History events={postEvents} activeEventIds={activeEventIds} busy={busy} onRevert={async (event) => {
          await append([{
            aggregateId: postId, eventType: "change.reverted", payload: {}, revertsEventId: event.id,
          }])
        }} />
      </div>
      <SocialPreviews post={draft} />
    </div>
  </div>
}

function ApprovalBadge({ status }: { status: CalendarApprovalStatus }) {
  return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${approvalClasses[status]}`}>
    {approvalLabels[status]}
  </span>
}

function ApprovalPanel({
  post, dirty, busy, currentUserId, canApprove, comment, onComment, onAction,
}: {
  post: CalendarPost
  dirty: boolean
  busy: boolean
  currentUserId: string
  canApprove: boolean
  comment: string
  onComment: (value: string) => void
  onAction: (eventType: CalendarEventType) => Promise<void>
}) {
  const { approval } = post
  const canWithdraw = canApprove || approval.requestedBy === currentUserId
  return <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
    <div className="flex items-start justify-between gap-4">
      <div><h2 className="text-base font-semibold">Approval</h2><p className="mt-1 text-xs text-slate-500">Decisions apply only to revision {post.revision}.</p></div>
      <ApprovalBadge status={approval.status} />
    </div>
    {approval.comment ? <blockquote className="mt-4 rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-600">{approval.comment}</blockquote> : null}
    {dirty ? <p className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-xs text-amber-800">Save your edits before changing approval. Saving creates a new revision and returns the post to Draft.</p> : null}
    <label className="mt-4 block text-xs font-semibold text-slate-600">Review note<textarea value={comment} maxLength={2000} onChange={(event) => onComment(event.target.value)} rows={3} placeholder={approval.status === "in_review" ? "Add context for the decision" : "Add context for reviewers"} className="mt-2 w-full resize-y rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-normal outline-none focus:border-violet-400" /></label>
    <div className="mt-4 flex flex-wrap gap-2">
      {(approval.status === "draft" || approval.status === "changes_requested") ? <button disabled={busy || dirty} onClick={() => void onAction("approval.requested")} className="rounded-lg bg-violet-600 px-3.5 py-2 text-sm font-semibold text-white disabled:opacity-40">Request approval</button> : null}
      {approval.status === "in_review" && canApprove ? <button disabled={busy || dirty} onClick={() => void onAction("approval.granted")} className="rounded-lg bg-emerald-600 px-3.5 py-2 text-sm font-semibold text-white disabled:opacity-40">Approve revision</button> : null}
      {approval.status === "in_review" && canApprove ? <button disabled={busy || dirty || !comment.trim()} onClick={() => void onAction("approval.changes_requested")} className="rounded-lg border border-orange-200 px-3.5 py-2 text-sm font-semibold text-orange-700 disabled:opacity-40">Request changes</button> : null}
      {approval.status === "in_review" && canWithdraw ? <button disabled={busy || dirty} onClick={() => void onAction("approval.withdrawn")} className="rounded-lg border border-slate-200 px-3.5 py-2 text-sm font-semibold text-slate-600 disabled:opacity-40">Withdraw</button> : null}
    </div>
    {approval.status === "in_review" && !canApprove ? <p className="mt-3 text-xs text-slate-500">A team owner or admin must review this revision.</p> : null}
  </section>
}

function History({
  events, activeEventIds, busy, onRevert,
}: {
  events: CalendarEvent[]
  activeEventIds: Set<number>
  busy: boolean
  onRevert: (event: CalendarEvent) => Promise<void>
}) {
  return <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><div className="flex items-center justify-between"><div><h2 className="text-base font-semibold">Post history</h2><p className="mt-1 text-xs text-slate-500">Every edit and approval decision is retained.</p></div><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-500">{events.length} events</span></div><div className="mt-5 border-l border-slate-200 pl-5">{[...events].sort((a, b) => b.id - a.id).map((event) => { const active = activeEventIds.has(event.id); return <div key={event.id} className="relative flex items-start justify-between gap-4 pb-5 text-xs before:absolute before:-left-[25px] before:top-1 before:size-2 before:rounded-full before:bg-violet-400"><div><strong className="font-semibold text-slate-700">{eventLabels[event.eventType]}</strong><p className="mt-1 max-w-md break-words text-slate-500">{eventDetail(event)}</p><p className="mt-1 text-slate-400">#{event.id} · {active ? "Active" : "Reverted"} · {actorLabel(event)} · {new Date(event.createdAt).toLocaleString()}</p></div>{active && !isApprovalEventType(event.eventType) ? <button disabled={busy} onClick={() => void onRevert(event)} className="rounded-md px-2 py-1 font-medium text-violet-700 hover:bg-violet-50 disabled:opacity-40">Revert</button> : null}</div>})}</div></section>
}

function SocialPreviews({ post }: { post: CalendarPost }) {
  return <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start"><div><h2 className="text-base font-semibold">Social previews</h2><p className="mt-1 text-xs text-slate-500">Live preview for each selected network.</p></div>{post.targets.map((target) => <PreviewCard key={target} target={target} copy={post.copy} />)}{post.targets.length === 0 ? <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">Select a social network to see its preview.</div> : null}</aside>
}

function PreviewCard({ target, copy }: { target: CalendarTarget; copy: string }) {
  const name = target === "X" ? "Screeem" : "Screeem Studio"
  return <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="flex items-center justify-between border-b border-slate-100 px-4 py-3"><span className="text-xs font-semibold text-slate-600">{target} preview</span><span className="text-xs text-slate-400">{copy.length} chars</span></div><div className={target === "Instagram" ? "p-0" : "p-5"}>{target === "Instagram" ? <div className="aspect-square bg-gradient-to-br from-violet-600 via-fuchsia-500 to-orange-400 p-8 text-white"><div className="flex h-full items-center justify-center rounded-2xl border border-white/30 bg-white/10 p-6 text-center text-xl font-semibold leading-snug backdrop-blur-sm">{copy || "Your post preview"}</div></div> : <><div className="flex gap-3"><div className={`grid size-10 shrink-0 place-items-center rounded-full font-bold text-white ${target === "X" ? "bg-slate-900" : "bg-blue-600"}`}>S</div><div className="min-w-0"><p className="text-sm font-semibold text-slate-900">{name} <span className="font-normal text-slate-400">{target === "X" ? "@screeem · now" : "1st · now"}</span></p><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">{copy || "Your post copy will appear here."}</p></div></div><div className="mt-4 flex justify-between border-t border-slate-100 pt-3 text-xs text-slate-400"><span>♡ Like</span><span>↗ Share</span><span>◯ Comment</span></div></>}</div>{target === "Instagram" ? <p className="px-4 py-3 text-sm text-slate-700"><strong>screeem</strong> {copy || "Your caption will appear here."}</p> : null}</section>
}
