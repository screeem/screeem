"use client"

import { useMemo, useState } from "react"

type Target = "X" | "LinkedIn" | "Instagram"
type Status = "scheduled" | "draft" | "published" | "superseded"

type Post = {
  id: number
  rootId: number
  revision: number
  title: string
  copy: string
  date: string
  time: string
  targets: Target[]
  status: Status
  colour: string
  updatedBy: string
}

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

const seed: Post[] = [
  { id: 1, rootId: 1, revision: 1, title: "Summer release notes", copy: "The small details made this release our biggest yet. Here’s everything we shipped…", date: "2026-08-04", time: "09:30", targets: ["X", "LinkedIn"], status: "published", colour: "violet", updatedBy: "Ben" },
  { id: 2, rootId: 2, revision: 1, title: "Behind the build", copy: "A look inside the decisions, discarded sketches, and tiny wins behind our new workflow.", date: "2026-08-11", time: "14:00", targets: ["Instagram", "LinkedIn"], status: "scheduled", colour: "coral", updatedBy: "Maya" },
  { id: 3, rootId: 3, revision: 1, title: "Customer story: Northstar", copy: "How Northstar cut their publishing time in half without losing their voice.", date: "2026-08-14", time: "10:15", targets: ["X", "LinkedIn", "Instagram"], status: "scheduled", colour: "teal", updatedBy: "Ben" },
  { id: 4, rootId: 4, revision: 1, title: "Friday field notes", copy: "Five things the team learned this week—and one question we’re taking into Monday.", date: "2026-08-21", time: "16:30", targets: ["X"], status: "draft", colour: "blue", updatedBy: "Jo" },
  { id: 5, rootId: 5, revision: 1, title: "August round-up", copy: "A month of momentum, gathered in one place.", date: "2026-08-28", time: "11:00", targets: ["LinkedIn", "Instagram"], status: "scheduled", colour: "violet", updatedBy: "Maya" },
]

const monthName = new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" })
const weekdays = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]

function isoDate(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

function TargetDot({ target }: { target: Target }) {
  return <span title={target} className={`grid size-5 place-items-center rounded-full text-[9px] font-bold ring-2 ring-white ${targetStyle[target]}`}>{target === "Instagram" ? "I" : target === "LinkedIn" ? "in" : "X"}</span>
}

export function ScheduleCalendar() {
  const [cursor, setCursor] = useState(new Date(Date.UTC(2026, 7, 1)))
  const [posts, setPosts] = useState<Post[]>(seed)
  const [selected, setSelected] = useState<Post | null>(seed[2])
  const [composing, setComposing] = useState(false)
  const [filter, setFilter] = useState<Target | "All">("All")

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

  const visible = posts.filter((post) => post.status !== "superseded" && (filter === "All" || post.targets.includes(filter)))

  function shiftMonth(amount: number) {
    setCursor(new Date(Date.UTC(year, month + amount, 1)))
  }

  function openNew(date = isoDate(year, month, 14)) {
    setSelected({ id: 0, rootId: 0, revision: 0, title: "", copy: "", date, time: "09:00", targets: ["X"], status: "draft", colour: "violet", updatedBy: "You" })
    setComposing(true)
  }

  function save(next: Post) {
    if (!next.title.trim() || next.targets.length === 0) return
    if (next.id === 0) {
      const id = Math.max(...posts.map((post) => post.id), 0) + 1
      setPosts((current) => [...current, { ...next, id, rootId: id, revision: 1, status: "scheduled" }])
    } else {
      const id = Math.max(...posts.map((post) => post.id), 0) + 1
      setPosts((current) => [
        ...current.map((post) => post.id === next.id ? { ...post, status: "superseded" as const } : post),
        { ...next, id, rootId: next.rootId, revision: next.revision + 1, status: "scheduled" },
      ])
    }
    setComposing(false)
    setSelected(null)
  }

  return (
    <div className="pb-10 text-slate-900">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[.18em] text-violet-600"><span className="size-2 rounded-full bg-violet-500" /> Publishing workspace</div>
          <h1 className="text-3xl font-semibold tracking-tight">Content calendar</h1>
          <p className="mt-2 text-sm text-slate-500">Plan once, publish everywhere. Every change stays in the timeline.</p>
        </div>
        <button onClick={() => openNew()} className="rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-violet-200 transition hover:bg-violet-700">+ Schedule post</button>
      </div>

      <div className="mt-8 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div className="flex items-center gap-2">
            <button onClick={() => shiftMonth(-1)} aria-label="Previous month" className="grid size-8 place-items-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50">‹</button>
            <button onClick={() => shiftMonth(1)} aria-label="Next month" className="grid size-8 place-items-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50">›</button>
            <h2 className="ml-2 text-base font-semibold">{monthName.format(cursor)}</h2>
          </div>
          <div className="flex rounded-lg bg-slate-100 p-1">
            {(["All", "X", "LinkedIn", "Instagram"] as const).map((target) => <button key={target} onClick={() => setFilter(target)} className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${filter === target ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}>{target}</button>)}
          </div>
        </div>
        <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50/70">
          {weekdays.map((day) => <div key={day} className="px-2 py-2.5 text-center text-[10px] font-bold tracking-widest text-slate-400">{day}</div>)}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((cell, index) => {
            const dayPosts = cell ? visible.filter((post) => post.date === cell.date) : []
            const today = cell?.date === "2026-08-14"
            return <div key={index} onDoubleClick={() => cell && openNew(cell.date)} className={`min-h-28 border-b border-r border-slate-100 p-1.5 sm:min-h-32 ${!cell ? "bg-slate-50/50" : "bg-white hover:bg-slate-50/40"}`}>
              {cell && <div className={`mb-1 ml-1 grid size-6 place-items-center rounded-full text-xs ${today ? "bg-violet-600 font-semibold text-white" : "text-slate-500"}`}>{cell.day}</div>}
              {dayPosts.map((post) => <button key={post.id} onClick={() => { setSelected(post); setComposing(true) }} className={`mb-1 w-full rounded-md border-l-[3px] px-2 py-1.5 text-left transition hover:-translate-y-px hover:shadow-sm ${colourStyle[post.colour]}`}>
                <span className="block truncate text-[11px] font-semibold text-slate-800">{post.title}</span>
                <span className="mt-1 flex items-center justify-between gap-1 text-[9px] text-slate-500"><span>{post.time}</span><span className="flex -space-x-1">{post.targets.map((target) => <TargetDot key={target} target={target} />)}</span></span>
              </button>)}
            </div>
          })}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
        <span>Tip: double-click any day to schedule there.</span>
        <span className="flex items-center gap-4"><i className="size-2 rounded-full bg-emerald-500" /> Synced just now <span className="text-slate-300">•</span> {visible.length} active posts</span>
      </div>

      {composing && selected ? (
        <PostEditor
          post={selected}
          history={posts.filter((post) => post.rootId === selected.rootId)}
          onClose={() => setComposing(false)}
          onSave={save}
        />
      ) : null}
    </div>
  )
}

function PostEditor({
  post, history, onClose, onSave,
}: {
  post: Post
  history: Post[]
  onClose: () => void
  onSave: (post: Post) => void
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
      <div className="flex items-center justify-between border-b border-slate-200 px-6 py-5"><div><p className="text-xs font-semibold uppercase tracking-wider text-violet-600">{post.id ? `Edit forward · v${post.revision}` : "New calendar entry"}</p><h2 className="mt-1 text-xl font-semibold">{post.id ? post.title : "Schedule a post"}</h2></div><button onClick={onClose} className="grid size-9 place-items-center rounded-full bg-slate-100 text-xl text-slate-500">×</button></div>
      <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
        {post.id ? <div className="rounded-lg border border-violet-100 bg-violet-50 px-3 py-2 text-xs leading-5 text-violet-800">Saving creates version {post.revision + 1}. Version {post.revision} remains in the activity log and is never overwritten.</div> : null}
        <label className="block text-xs font-semibold text-slate-600">Title<input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="Give this post a name" className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-normal outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100" /></label>
        <label className="block text-xs font-semibold text-slate-600">Post copy<textarea value={draft.copy} onChange={(event) => setDraft({ ...draft, copy: event.target.value })} rows={5} placeholder="What do you want to share?" className="mt-2 w-full resize-none rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-normal leading-6 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100" /><span className="mt-1 block text-right font-normal text-slate-400">{draft.copy.length} characters</span></label>
        <div className="grid grid-cols-2 gap-3"><label className="text-xs font-semibold text-slate-600">Date<input type="date" value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-normal" /></label><label className="text-xs font-semibold text-slate-600">Time<input type="time" value={draft.time} onChange={(event) => setDraft({ ...draft, time: event.target.value })} className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-normal" /></label></div>
        <fieldset><legend className="text-xs font-semibold text-slate-600">Publish to</legend><div className="mt-2 flex flex-wrap gap-2">{(["X", "LinkedIn", "Instagram"] as Target[]).map((target) => <button type="button" key={target} onClick={() => toggleTarget(target)} className={`flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-medium ${draft.targets.includes(target) ? "border-violet-300 bg-violet-50 text-violet-800" : "border-slate-200 text-slate-500"}`}><TargetDot target={target} />{target}</button>)}</div></fieldset>
        <fieldset><legend className="text-xs font-semibold text-slate-600">Label colour</legend><div className="mt-2 flex gap-2">{Object.keys(colourStyle).map((colour) => <button type="button" aria-label={colour} key={colour} onClick={() => setDraft({ ...draft, colour })} className={`size-7 rounded-full ${colour === "violet" ? "bg-violet-500" : colour === "coral" ? "bg-orange-500" : colour === "teal" ? "bg-teal-500" : "bg-blue-500"} ${draft.colour === colour ? "ring-2 ring-slate-800 ring-offset-2" : ""}`} />)}</div></fieldset>
        {history.length > 0 ? <div><h3 className="text-xs font-semibold text-slate-600">Activity</h3><div className="mt-3 border-l border-slate-200 pl-4">{history.sort((a, b) => b.revision - a.revision).map((item) => <div key={item.id} className="relative pb-4 text-xs text-slate-500 before:absolute before:-left-[19px] before:top-1 before:size-2 before:rounded-full before:bg-violet-400"><span className="font-semibold text-slate-700">Version {item.revision}</span> · {item.updatedBy}<br />{item.date} at {item.time} {item.status === "superseded" ? "· superseded" : "· current"}</div>)}</div></div> : null}
      </div>
      <div className="flex items-center justify-between border-t border-slate-200 px-6 py-4"><span className="text-xs text-slate-400">Changes sync on save</span><div className="flex gap-2"><button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100">Cancel</button><button disabled={!draft.title.trim() || draft.targets.length === 0} onClick={() => onSave(draft)} className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40">{post.id ? "Save as new version" : "Schedule post"}</button></div></div>
    </aside>
  </div>
}
