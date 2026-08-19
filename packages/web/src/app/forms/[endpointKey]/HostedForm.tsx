"use client"

import type {
  FormDefinition,
  NormalizedSubmission,
  PublishedAvailability,
} from "@screeem/forms"
import { RespondentForm } from "@/components/forms/RespondentForm"
import { useEffect, useState } from "react"

interface PublicFormResponse {
  readonly form?: {
    readonly name?: string
    readonly availability?: PublishedAvailability
  }
  readonly published?: {
    readonly version: number
    readonly definition: FormDefinition
  }
  readonly definition?: FormDefinition
  readonly version?: number
}

export function HostedForm({ endpointKey }: { readonly endpointKey: string }) {
  const [definition, setDefinition] = useState<FormDefinition | null>(null)
  const [version, setVersion] = useState<number | null>(null)
  const [error, setError] = useState("")
  const [submitted, setSubmitted] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const response = await fetch(`/api/forms/${encodeURIComponent(endpointKey)}`)
      const body = (await response.json().catch(() => ({}))) as PublicFormResponse & {
        error?: string
      }
      if (cancelled) return
      if (!response.ok) {
        setError(typeof body.error === "string" ? body.error : "This form is not available")
        return
      }
      const nextDefinition = body.published?.definition ?? body.definition
      if (!nextDefinition) {
        setError("This form is not available")
        return
      }
      setDefinition(nextDefinition)
      setVersion(body.published?.version ?? body.version ?? null)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [endpointKey])

  async function submit(values: NormalizedSubmission) {
    const response = await fetch(`/api/forms/${encodeURIComponent(endpointKey)}/submissions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(values),
    })
    const body = (await response.json().catch(() => ({}))) as {
      error?: string
      issues?: readonly { message: string }[]
      redirectTo?: string
    }
    if (!response.ok) {
      const detail = body.issues?.map((issue) => issue.message).join(". ")
      throw new Error(detail || body.error || "Your response could not be submitted")
    }
    if (body.redirectTo) {
      window.location.assign(body.redirectTo)
      return
    }
    setSubmitted(true)
  }

  if (error) {
    return <PublicState title="Form unavailable" detail={error} />
  }
  if (!definition) {
    return <PublicState title="Loading form" detail="Preparing the latest version…" />
  }
  if (submitted) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
        <div className="w-full max-w-lg rounded-2xl bg-card px-7 py-10 text-center shadow-[0_18px_60px_rgba(15,23,42,0.12)] sm:px-10">
          <span
            aria-hidden="true"
            className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-success-subtle text-success-text"
          >
            ✓
          </span>
          <h1 className="mt-5 text-2xl font-semibold tracking-tight text-foreground">
            Response received
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{definition.successMessage}</p>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-background px-4 py-8 sm:py-14">
      <div className="mx-auto max-w-xl rounded-2xl bg-card px-6 py-8 shadow-[0_18px_60px_rgba(15,23,42,0.12)] sm:px-10 sm:py-10">
        <div className="mb-8 border-b border-border pb-6">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Screeem form
          </p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-foreground">
            {definition.title}
          </h1>
          {definition.description ? (
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{definition.description}</p>
          ) : null}
        </div>
        <RespondentForm definition={definition} onSubmit={submit} />
        {version ? (
          <p className="mt-7 text-center text-[11px] text-muted-foreground">Form version {version}</p>
        ) : null}
      </div>
    </main>
  )
}

function PublicState({ title, detail }: { readonly title: string; readonly detail: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold text-foreground">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{detail}</p>
      </div>
    </main>
  )
}
