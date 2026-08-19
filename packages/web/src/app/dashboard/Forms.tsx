"use client"

import { integrationActionNameForRegistration } from "../../lib/integrations/action-catalog"
import type { FormAvailability } from "@screeem/forms"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import {
  snapshotFormSubmissionsApiResponse,
  type FormSubmissionListItem,
} from "../../lib/forms/submission-contract"
import type { FormEventDeliverySummary } from "../../lib/forms/form-delivery-contract"
import { Button } from "@/components/ui/button"
import { CodeBlock } from "@/components/ui/code-block"
import { CopyRow } from "@/components/ui/copy-row"
import { Input } from "@/components/ui/input"
import { Notice } from "@/components/ui/notice"
import { StatusBadge } from "@/components/ui/status-badge"

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
  availability?: FormAvailability
  draft_revision?: number
  published_version?: number | null
  created_at: string
}

interface FormsApiBody {
  readonly error?: unknown
  readonly form?: FormView
  readonly forms?: FormView[]
}

export function Forms({ teamId, canManage }: { teamId: string; canManage: boolean }) {
  return <FormsForTeam key={teamId} teamId={teamId} canManage={canManage} />
}

function FormsForTeam({ teamId, canManage }: { teamId: string; canManage: boolean }) {
  const router = useRouter()
  const [forms, setForms] = useState<FormView[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [submissions, setSubmissions] = useState<readonly FormSubmissionListItem[]>([])
  const [submissionRoutes, setSubmissionRoutes] = useState<readonly string[]>([])
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
      setSubmissions([])
      setSubmissionRoutes([])
      return
    }
    setSelected(formId)
    setRouteFilter("")
    setSubmissions([])
    setSubmissionRoutes([])
    await fetchSubmissions(formId, "")
  }

  async function fetchSubmissions(formId: string, route: string) {
    const requestId = submissionRequest.current + 1
    submissionRequest.current = requestId
    setError("")
    setSubmissions([])
    try {
      const query = route ? `?route=${encodeURIComponent(route)}` : ""
      const response = await fetch(`/api/teams/${teamId}/forms/${formId}/submissions${query}`)
      const body = await readBody(response)
      if (requestId !== submissionRequest.current) return
      if (!response.ok) return setError(readError(body, "Could not load submissions"))
      const result = snapshotFormSubmissionsApiResponse(body)
      setSubmissions(result.submissions)
      setSubmissionRoutes(result.routes)
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
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-5">
        <div>
          <h2 className="text-base font-semibold text-foreground">Your forms</h2>
          <p className="mt-1 text-sm text-muted-foreground">Build, publish and review structured forms.</p>
        </div>
        {canManage ? (
          <Button type="button" onClick={() => setShowCreate((current) => !current)}>
            {showCreate ? "Cancel" : "New form"}
          </Button>
        ) : null}
      </div>

      {showCreate ? (
        <form
          onSubmit={createForm}
          className="grid gap-4 border-b border-border bg-card py-6 md:grid-cols-3"
        >
          <Field label="Form name">
            <Input
              required
              maxLength={80}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Enterprise demo request"
            />
          </Field>
          <Field label="Allowed origin" hint="Optional">
            <Input
              type="url"
              value={allowedOrigin}
              onChange={(event) => setAllowedOrigin(event.target.value)}
              placeholder="https://example.com"
            />
          </Field>
          <Field label="Success redirect" hint="Optional">
            <Input
              type="url"
              value={successUrl}
              onChange={(event) => setSuccessUrl(event.target.value)}
              placeholder="https://example.com/thanks"
            />
          </Field>
          <label className="flex items-center gap-2 text-sm text-foreground md:col-span-3">
            <input
              type="checkbox"
              checked={requiresTurnstile}
              onChange={(event) => setRequiresTurnstile(event.target.checked)}
            />
            Require Cloudflare Turnstile bot verification
          </label>
          <Button disabled={busy} className="w-fit">
            {busy ? "Creating…" : "Create and edit"}
          </Button>
        </form>
      ) : null}

      {error ? (
        <Notice tone="error" className="mt-4">
          {error}
        </Notice>
      ) : null}

      <div className="divide-y divide-border">
        {forms.length === 0 ? (
          <div className="py-14 text-center">
            <p className="text-sm font-medium text-foreground">No forms yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
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
                    <h3 className="font-semibold text-foreground">{form.name}</h3>
                    <StatusBadge tone={isActive ? "success" : "neutral"}>{status}</StatusBadge>
                    {form.published_version ? (
                      <span className="text-xs text-muted-foreground">v{form.published_version}</span>
                    ) : null}
                    {form.requires_turnstile ? (
                      <StatusBadge tone="info">Bot check</StatusBadge>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Created {new Date(form.created_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 text-sm">
                  {canManage ? (
                    <Button asChild size="sm">
                      <Link href={`/dashboard/forms/${form.id}?name=${encodeURIComponent(form.name)}`}>
                        Edit form
                      </Link>
                    </Button>
                  ) : null}
                  <Button variant="outline" size="sm" onClick={() => void loadSubmissions(form.id)}>
                    {selected === form.id ? "Hide submissions" : "Submissions"}
                  </Button>
                  {canManage && (isPublished || isLegacy) ? (
                    <Button variant="outline" size="sm" onClick={() => void toggle(form)}>
                      {isActive ? "Pause" : "Resume"}
                    </Button>
                  ) : null}
                  {canManage ? (
                    <Button variant="outline" size="sm" onClick={() => void toggleTurnstile(form)}>
                      {form.requires_turnstile ? "Disable bot check" : "Require bot check"}
                    </Button>
                  ) : null}
                  {canManage ? (
                    <Button variant="destructive-ghost" size="sm" onClick={() => void remove(form)}>
                      Delete
                    </Button>
                  ) : null}
                </div>
              </div>

              <div className="mt-4 grid gap-2 lg:grid-cols-2">
                <CopyRow
                  label="Hosted form"
                  value={isPublished ? hostedForm(form.endpoint_key) : undefined}
                  placeholder="Publish to create a hosted form"
                />
                <CopyRow
                  label="Submission endpoint"
                  value={submissionEndpoint(form.endpoint_key)}
                />
              </div>
              {form.allowed_origin ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Accepting requests from {form.allowed_origin}
                </p>
              ) : null}

              {canManage && isLegacy ? (
                <details className="mt-3 rounded-md border border-border px-4 py-3">
                  <summary className="cursor-pointer text-sm font-medium text-foreground">
                    Legacy JSON Schema
                  </summary>
                  <p className="mt-2 text-xs text-muted-foreground">
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
                    className="mt-3 w-full rounded-md border border-border px-3 py-2 font-mono text-xs"
                  />
                  <Button
                    type="button"
                    size="xs"
                    className="mt-2"
                    onClick={() => void saveSchema(form)}
                  >
                    Save schema
                  </Button>
                </details>
              ) : null}

              {selected === form.id ? (
                <div className="mt-5 border-t border-border pt-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h4 className="text-sm font-semibold text-foreground">Recent submissions</h4>
                    <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                      Destination
                      <select
                        aria-label="Filter submissions by destination"
                        value={routeFilter}
                        onChange={(event) => {
                          const route = event.target.value
                          setRouteFilter(route)
                          void fetchSubmissions(form.id, route)
                        }}
                        className="rounded-md border border-border bg-card px-2 py-1.5 text-sm text-foreground"
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
                      <p className="text-sm text-muted-foreground">No submissions yet.</p>
                    ) : (
                      submissions.map((submission) => (
                        <details
                          key={submission.id}
                          className="rounded-md border border-border px-4 py-3"
                        >
                          <summary className="cursor-pointer text-sm text-foreground">
                            {new Date(submission.created_at).toLocaleString()}
                            {submission.publication_version
                              ? ` · v${submission.publication_version}`
                              : ""}
                            {submission.origin ? ` · ${submission.origin}` : ""}
                            {submission.routing_route ? ` · ${submission.routing_route}` : ""}
                            {submission.routing_status === "failed" ? " · Routing failed" : ""}
                          </summary>
                          <SubmissionRouting routing={submission} />
                          <SubmissionDeliveries deliveries={submission.event_deliveries} />
                          <CodeBlock
                            className="mt-3"
                            code={JSON.stringify(submission.payload, null, 2)}
                          />
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

function SubmissionDeliveries({
  deliveries,
}: {
  readonly deliveries: readonly FormEventDeliverySummary[]
}) {
  if (deliveries.length === 0) return null
  return (
    <div className="mt-3 space-y-1 text-xs text-muted-foreground">
      {deliveries.map((delivery) => (
        <p key={delivery.delivery_key}>
          <strong className="text-foreground">
            {integrationActionNameForRegistration(delivery.registration_name)}
          </strong>{" "}
          · {delivery.status}
          {delivery.attempt_count > 1 ? ` · ${delivery.attempt_count} attempts` : ""}
          {delivery.last_error ? ` · ${delivery.last_error}` : ""}
        </p>
      ))}
    </div>
  )
}

function SubmissionRouting({ routing }: { readonly routing: FormSubmissionListItem }) {
  if (routing.routing_status === "matched") {
    return (
      <p className="mt-3 text-xs text-muted-foreground">
        Routed to <strong className="text-foreground">{routing.routing_route}</strong> · matched{" "}
        {routing.matched_rule_id}
      </p>
    )
  }
  if (routing.routing_status === "fallback") {
    return (
      <p className="mt-3 text-xs text-muted-foreground">
        Routed to <strong className="text-foreground">{routing.routing_route}</strong> · fallback
      </p>
    )
  }
  if (routing.routing_status === "failed") {
    return <p className="mt-3 text-xs font-medium text-error-text">Routing failed</p>
  }
  return <p className="mt-3 text-xs text-muted-foreground">No routing configured</p>
}


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
    <label className="text-sm font-medium text-foreground">
      <span className="mb-1.5 flex justify-between">
        <span>{label}</span>
        <span className="font-normal text-muted-foreground">{hint}</span>
      </span>
      {children}
    </label>
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
