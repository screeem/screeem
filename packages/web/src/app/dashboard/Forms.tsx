"use client"

import type { SubmissionRoutingStatus } from "@screeem/forms"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"

type FormView = {
  id: string
  name: string
  endpoint_key: string
  allowed_origin: string | null
  success_url: string | null
  is_active: boolean
  requires_turnstile: boolean
  submission_schema: Record<string, unknown> | null
  legacy_unstructured: boolean
  availability?: "draft" | "active" | "paused"
  draft_revision?: number
  published_version?: number | null
  created_at: string
}

type Submission = {
  id: string
  payload: Record<string, unknown>
  origin: string | null
  created_at: string
  publication_version?: number | null
  routing_status: SubmissionRoutingStatus
  routing_route: string | null
  matched_rule_id: string | null
  routing_error: string | null
}

interface FormsApiBody {
  readonly error?: unknown
  readonly form?: FormView
  readonly forms?: FormView[]
  readonly submissions?: Submission[]
  readonly routes?: string[]
}

export function Forms({ teamId, canManage }: { teamId: string; canManage: boolean }) {
  return <FormsForTeam key={teamId} teamId={teamId} canManage={canManage} />
}

function FormsForTeam({ teamId, canManage }: { teamId: string; canManage: boolean }) {
  const router = useRouter()
  const [forms, setForms] = useState<FormView[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [submissionRoutes, setSubmissionRoutes] = useState<string[]>([])
  const [routeFilter, setRouteFilter] = useState("")
  const [name, setName] = useState("")
  const [allowedOrigin, setAllowedOrigin] = useState("")
  const [successUrl, setSuccessUrl] = useState("")
  const [requiresTurnstile, setRequiresTurnstile] = useState(false)
  const [schemaDrafts, setSchemaDrafts] = useState<Record<string, string>>({})
  const [showCreate, setShowCreate] = useState(false)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const submissionRequest = useRef(0)

  useEffect(() => {
    let isCancelled = false

    async function loadForms() {
      try {
        const response = await fetch(`/api/teams/${teamId}/forms`)
        const body = await readBody(response)
        if (isCancelled) return
        if (!response.ok) {
          setError(readError(body, "Could not load forms"))
          return
        }
        const loadedForms = Array.isArray(body.forms) ? body.forms : []
        setForms(loadedForms)
        if (canManage && loadedForms.length === 0) setShowCreate(true)
      } catch {
        if (!isCancelled) setError("Could not load forms")
      }
    }

    void loadForms()
    return () => {
      isCancelled = true
    }
  }, [teamId, canManage])

  async function createForm(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError("")
    try {
      const response = await fetch(`/api/teams/${teamId}/forms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, allowedOrigin, successUrl, requiresTurnstile }),
      })
      const body = await readBody(response)
      if (!response.ok) {
        setError(readError(body, "Could not create form"))
      } else if (body.form) {
        setForms((current) => [body.form as FormView, ...current])
        setName("")
        setAllowedOrigin("")
        setSuccessUrl("")
        setRequiresTurnstile(false)
        setShowCreate(false)
        router.push(`/dashboard/forms/${body.form.id}?name=${encodeURIComponent(body.form.name)}`)
      }
    } catch {
      setError("Could not create form")
    } finally {
      setBusy(false)
    }
  }

  async function loadSubmissions(formId: string) {
    if (selected === formId) {
      submissionRequest.current += 1
      setSelected(null)
      return
    }
    setSelected(formId)
    setRouteFilter("")
    await fetchSubmissions(formId, "")
  }

  async function fetchSubmissions(formId: string, route: string) {
    const requestId = submissionRequest.current + 1
    submissionRequest.current = requestId
    setError("")
    try {
      const query = route ? `?route=${encodeURIComponent(route)}` : ""
      const response = await fetch(`/api/teams/${teamId}/forms/${formId}/submissions${query}`)
      const body = await readBody(response)
      if (requestId !== submissionRequest.current) return
      if (!response.ok) return setError(readError(body, "Could not load submissions"))
      setSubmissions(Array.isArray(body.submissions) ? body.submissions : [])
      setSubmissionRoutes(Array.isArray(body.routes) ? body.routes : [])
    } catch {
      if (requestId === submissionRequest.current) setError("Could not load submissions")
    }
  }

  async function toggle(form: FormView) {
    const nextActive = form.availability === "paused" || !form.is_active
    const isStructured = form.legacy_unstructured === false
    try {
      const response = await fetch(`/api/teams/${teamId}/forms/${form.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isStructured
            ? { availability: nextActive ? "active" : "paused" }
            : { isActive: nextActive },
        ),
      })
      const body = await readBody(response)
      if (!response.ok) return setError(readError(body, "Could not update form"))
      setForms((items) =>
        items.map((item) =>
          item.id === form.id
            ? { ...item, is_active: nextActive, availability: nextActive ? "active" : "paused" }
            : item,
        ),
      )
    } catch {
      setError("Could not update form")
    }
  }

  async function remove(form: FormView) {
    if (!window.confirm(`Delete ${form.name} and all of its submissions?`)) return
    try {
      const response = await fetch(`/api/teams/${teamId}/forms/${form.id}`, { method: "DELETE" })
      if (!response.ok) return setError("Could not delete form")
      setForms((items) => items.filter((item) => item.id !== form.id))
      if (selected === form.id) {
        submissionRequest.current += 1
        setSelected(null)
        setSubmissions([])
        setSubmissionRoutes([])
        setRouteFilter("")
      }
    } catch {
      setError("Could not delete form")
    }
  }

  async function toggleTurnstile(form: FormView) {
    try {
      const response = await fetch(`/api/teams/${teamId}/forms/${form.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requiresTurnstile: !form.requires_turnstile }),
      })
      const body = await readBody(response)
      if (!response.ok) return setError(readError(body, "Could not update bot protection"))
      setForms((items) =>
        items.map((item) =>
          item.id === form.id ? { ...item, requires_turnstile: !form.requires_turnstile } : item,
        ),
      )
    } catch {
      setError("Could not update bot protection")
    }
  }

  async function saveSchema(form: FormView) {
    const draft = schemaDrafts[form.id] ?? ""
    let submissionSchema: unknown = null
    try {
      if (draft.trim()) submissionSchema = JSON.parse(draft)
    } catch {
      return setError("Submission schema must be valid JSON")
    }
    try {
      const response = await fetch(`/api/teams/${teamId}/forms/${form.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submissionSchema }),
      })
      const body = await readBody(response)
      if (!response.ok) return setError(readError(body, "Could not update submission schema"))
      setForms((items) =>
        items.map((item) =>
          item.id === form.id
            ? { ...item, submission_schema: submissionSchema as Record<string, unknown> | null }
            : item,
        ),
      )
    } catch {
      setError("Could not update submission schema")
    }
  }

  const submissionEndpoint = (key: string) =>
    `${typeof window === "undefined" ? "" : window.location.origin}/api/forms/${key}/submissions`
  const hostedForm = (key: string) =>
    `${typeof window === "undefined" ? "" : window.location.origin}/forms/${key}`

  return (
    <section className="mt-7">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-200 pb-5">
        <div>
          <h2 className="text-base font-semibold text-gray-950">Your forms</h2>
          <p className="mt-1 text-sm text-gray-500">Build, publish and review structured forms.</p>
        </div>
        {canManage ? (
          <button
            type="button"
            onClick={() => setShowCreate((current) => !current)}
            className="rounded-md bg-gray-950 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800"
          >
            {showCreate ? "Cancel" : "New form"}
          </button>
        ) : null}
      </div>

      {showCreate ? (
        <form
          onSubmit={createForm}
          className="grid gap-4 border-b border-gray-200 bg-white py-6 md:grid-cols-3"
        >
          <Field label="Form name">
            <input
              required
              maxLength={80}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Enterprise demo request"
              className={inputClass}
            />
          </Field>
          <Field label="Allowed origin" hint="Optional">
            <input
              type="url"
              value={allowedOrigin}
              onChange={(event) => setAllowedOrigin(event.target.value)}
              placeholder="https://example.com"
              className={inputClass}
            />
          </Field>
          <Field label="Success redirect" hint="Optional">
            <input
              type="url"
              value={successUrl}
              onChange={(event) => setSuccessUrl(event.target.value)}
              placeholder="https://example.com/thanks"
              className={inputClass}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm text-gray-700 md:col-span-3">
            <input
              type="checkbox"
              checked={requiresTurnstile}
              onChange={(event) => setRequiresTurnstile(event.target.checked)}
            />
            Require Cloudflare Turnstile bot verification
          </label>
          <button
            disabled={busy}
            className="w-fit rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create and edit"}
          </button>
        </form>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="mt-4 border-l-2 border-red-500 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {error}
        </p>
      ) : null}

      <div className="divide-y divide-gray-200">
        {forms.length === 0 ? (
          <div className="py-14 text-center">
            <p className="text-sm font-medium text-gray-800">No forms yet</p>
            <p className="mt-1 text-sm text-gray-500">
              Create a form to define fields and start collecting responses.
            </p>
          </div>
        ) : null}

        {forms.map((form) => {
          const isPublished = form.published_version != null
          const isLegacy = form.legacy_unstructured !== false && !isPublished
          const isActive = isPublished ? form.availability === "active" : isLegacy && form.is_active
          const status = isPublished
            ? isActive
              ? "Active"
              : "Paused"
            : isLegacy
              ? isActive
                ? "Legacy active"
                : "Legacy paused"
              : "Draft"
          return (
            <article key={form.id} className="py-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold text-gray-950">{form.name}</h3>
                    <Status label={status} active={isActive} />
                    {form.published_version ? (
                      <span className="text-xs text-gray-400">v{form.published_version}</span>
                    ) : null}
                    {form.requires_turnstile ? (
                      <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700">
                        Bot check
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs text-gray-500">
                    Created {new Date(form.created_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 text-sm">
                  {canManage ? (
                    <Link
                      href={`/dashboard/forms/${form.id}?name=${encodeURIComponent(form.name)}`}
                      className="rounded-md bg-gray-950 px-3 py-1.5 font-medium text-white hover:bg-gray-800"
                    >
                      Edit form
                    </Link>
                  ) : null}
                  <button onClick={() => void loadSubmissions(form.id)} className={secondaryButton}>
                    {selected === form.id ? "Hide submissions" : "Submissions"}
                  </button>
                  {canManage && (isPublished || isLegacy) ? (
                    <button onClick={() => void toggle(form)} className={secondaryButton}>
                      {isActive ? "Pause" : "Resume"}
                    </button>
                  ) : null}
                  {canManage ? (
                    <button onClick={() => void toggleTurnstile(form)} className={secondaryButton}>
                      {form.requires_turnstile ? "Disable bot check" : "Require bot check"}
                    </button>
                  ) : null}
                  {canManage ? (
                    <button
                      onClick={() => void remove(form)}
                      className="rounded-md px-3 py-1.5 text-red-600 hover:bg-red-50"
                    >
                      Delete
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="mt-4 grid gap-2 lg:grid-cols-2">
                <CopyRow
                  label="Hosted form"
                  value={hostedForm(form.endpoint_key)}
                  disabled={!isPublished}
                />
                <CopyRow
                  label="Submission endpoint"
                  value={submissionEndpoint(form.endpoint_key)}
                />
              </div>
              {form.allowed_origin ? (
                <p className="mt-2 text-xs text-gray-500">
                  Accepting requests from {form.allowed_origin}
                </p>
              ) : null}

              {canManage && isLegacy ? (
                <details className="mt-3 rounded-md border border-gray-200 px-4 py-3">
                  <summary className="cursor-pointer text-sm font-medium text-gray-700">
                    Legacy JSON Schema
                  </summary>
                  <p className="mt-2 text-xs text-gray-500">
                    Structured forms use the fields in the form builder. This setting remains for
                    legacy endpoints.
                  </p>
                  <textarea
                    value={
                      schemaDrafts[form.id] ??
                      (form.submission_schema
                        ? JSON.stringify(form.submission_schema, null, 2)
                        : "")
                    }
                    onChange={(event) =>
                      setSchemaDrafts((drafts) => ({ ...drafts, [form.id]: event.target.value }))
                    }
                    rows={8}
                    spellCheck={false}
                    placeholder="No schema — all payloads are accepted"
                    className="mt-3 w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => void saveSchema(form)}
                    className="mt-2 rounded-md bg-gray-950 px-3 py-1.5 text-xs font-medium text-white"
                  >
                    Save schema
                  </button>
                </details>
              ) : null}

              {selected === form.id ? (
                <div className="mt-5 border-t border-gray-100 pt-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h4 className="text-sm font-semibold text-gray-900">Recent submissions</h4>
                    <label className="flex items-center gap-2 text-xs font-medium text-gray-600">
                      Destination
                      <select
                        aria-label="Filter submissions by destination"
                        value={routeFilter}
                        onChange={(event) => {
                          const route = event.target.value
                          setRouteFilter(route)
                          void fetchSubmissions(form.id, route)
                        }}
                        className="rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-800"
                      >
                        <option value="">All destinations</option>
                        {submissionRoutes.map((route) => (
                          <option key={route} value={route}>
                            {route}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="mt-3 space-y-2">
                    {submissions.length === 0 ? (
                      <p className="text-sm text-gray-500">No submissions yet.</p>
                    ) : (
                      submissions.map((submission) => (
                        <details
                          key={submission.id}
                          className="rounded-md border border-gray-200 px-4 py-3"
                        >
                          <summary className="cursor-pointer text-sm text-gray-700">
                            {new Date(submission.created_at).toLocaleString()}
                            {submission.publication_version
                              ? ` · v${submission.publication_version}`
                              : ""}
                            {submission.origin ? ` · ${submission.origin}` : ""}
                            {submission.routing_route ? ` · ${submission.routing_route}` : ""}
                            {submission.routing_status === "failed" ? " · Routing failed" : ""}
                          </summary>
                          <SubmissionRouting routing={submission} />
                          <pre className="mt-3 overflow-x-auto rounded bg-gray-950 p-3 text-xs leading-5 text-gray-100">
                            {JSON.stringify(submission.payload, null, 2)}
                          </pre>
                        </details>
                      ))
                    )}
                  </div>
                </div>
              ) : null}
            </article>
          )
        })}
      </div>
    </section>
  )
}

function SubmissionRouting({ routing }: { readonly routing: Submission }) {
  if (routing.routing_status === "matched") {
    return (
      <p className="mt-3 text-xs text-gray-600">
        Routed to <strong className="text-gray-900">{routing.routing_route}</strong> · matched{" "}
        {routing.matched_rule_id}
      </p>
    )
  }
  if (routing.routing_status === "fallback") {
    return (
      <p className="mt-3 text-xs text-gray-600">
        Routed to <strong className="text-gray-900">{routing.routing_route}</strong> · fallback
      </p>
    )
  }
  if (routing.routing_status === "failed") {
    return <p className="mt-3 text-xs font-medium text-red-700">Routing failed</p>
  }
  return <p className="mt-3 text-xs text-gray-400">No routing configured</p>
}

const inputClass =
  "w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
const secondaryButton =
  "rounded-md border border-gray-200 px-3 py-1.5 text-gray-700 hover:bg-gray-50"

function Field({
  children,
  label,
  hint,
}: {
  readonly children: React.ReactNode
  readonly label: string
  readonly hint?: string
}) {
  return (
    <label className="text-sm font-medium text-gray-700">
      <span className="mb-1.5 flex justify-between">
        <span>{label}</span>
        <span className="font-normal text-gray-400">{hint}</span>
      </span>
      {children}
    </label>
  )
}

function Status({ label, active }: { readonly label: string; readonly active: boolean }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${active ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-600"}`}
    >
      {label}
    </span>
  )
}

function CopyRow({
  label,
  value,
  disabled = false,
}: {
  readonly label: string
  readonly value: string
  readonly disabled?: boolean
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-md bg-gray-50 px-3 py-2">
      <span className="shrink-0 text-xs font-medium text-gray-500">{label}</span>
      <code className="min-w-0 flex-1 truncate text-xs text-gray-700">
        {disabled ? "Publish to create a hosted form" : value}
      </code>
      {!disabled ? (
        <button
          type="button"
          onClick={() => void navigator.clipboard.writeText(value)}
          className="text-xs font-medium text-teal-600 hover:text-teal-800"
        >
          Copy
        </button>
      ) : null}
    </div>
  )
}

async function readBody(response: Response): Promise<FormsApiBody> {
  const value: unknown = await response.json().catch(() => ({}))
  return isObject(value) ? (value as FormsApiBody) : {}
}

function readError(body: FormsApiBody, fallback: string) {
  return typeof body.error === "string" ? body.error : fallback
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
