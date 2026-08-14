import {
  InvalidSubmissionError,
  notConfiguredSubmissionRouting,
  type FormDefinition,
  type FormRoutingDefinition,
  type SubmissionRoutingResult,
} from "@screeem/forms"
import { normalizeSubmissionEffect } from "@screeem/forms/effect"
import { Effect } from "effect"
import { NextRequest, NextResponse } from "next/server"
import {
  PublicDefinitionUnavailableError,
  findPublicForm,
  loadActivePublicDefinition,
  type PublicFormRecord,
} from "@/lib/forms/public"
import { createAdminClient } from "@/lib/supabase/admin"
import { validateSubmission, type SubmissionSchema } from "@/lib/forms/schema"
import { runAfterResponse } from "../../../../../lib/forms/after-response"
import {
  executeFormEventDeliveries,
  orderFormEventDeliveries,
  planFormRoutingDeliveries,
} from "../../../../../lib/forms/form-event-deliveries"
import {
  createFormPersistence,
  type FormPersistence,
  type PublicSubmissionSaveStatus,
} from "../../../../../lib/forms/routing-persistence"
import { productionFormAutomationRegistry } from "../../../../../lib/forms/form-registrations"
import {
  snapshotFormEvent,
  type FormEvent,
  type StoredFormEventDelivery,
} from "../../../../../lib/forms/form-actions"
import { evaluatePublishedFormRouting } from "../../../../../lib/forms/routing-runtime"

const MAX_BYTES = 64 * 1024
const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"
export const maxDuration = 60

export async function OPTIONS(
  request: NextRequest,
  context: { params: Promise<{ endpointKey: string }> },
) {
  const { endpointKey } = await context.params
  const origin = request.headers.get("origin")
  const admin = createAdminClient()

  try {
    const form = await findPublicForm(admin, endpointKey)
    if (!form) return new NextResponse(null, { status: 404 })
    if (!originIsAllowed(request, origin, form.allowedOrigin)) {
      return new NextResponse(null, { status: 403 })
    }
    if (
      (!form.legacyUnstructured && form.publishedVersion === null) ||
      (form.publishedVersion !== null && form.definitionAvailability !== "active")
    ) {
      return new NextResponse(null, { status: 404 })
    }

    return new NextResponse(null, {
      status: 204,
      headers: {
        ...cors(origin, form.allowedOrigin),
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400",
      },
    })
  } catch {
    return new NextResponse(null, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ endpointKey: string }> },
) {
  const { endpointKey } = await context.params
  const origin = request.headers.get("origin")
  const admin = createAdminClient()
  let form: PublicFormRecord
  try {
    const found = await findPublicForm(admin, endpointKey)
    if (!found) return NextResponse.json({ error: "Form not found" }, { status: 404 })
    form = found
  } catch {
    return NextResponse.json({ error: "Could not load form" }, { status: 500 })
  }

  if (!originIsAllowed(request, origin, form.allowedOrigin)) {
    return NextResponse.json({ error: "Origin is not allowed" }, { status: 403 })
  }

  const headers = cors(origin, form.allowedOrigin)
  const length = Number(request.headers.get("content-length"))
  if (length > MAX_BYTES) return tooLarge(headers)
  try {
    const published = await loadActivePublicDefinition(admin, form)
    const persistence = createFormPersistence()
    return published
      ? await structuredSubmission(request, persistence, form, published, origin, headers)
      : await legacySubmission(request, persistence, form, origin, headers)
  } catch (error) {
    if (error instanceof PublicDefinitionUnavailableError) {
      return NextResponse.json({ error: "Form not found" }, { status: 404, headers })
    }
    return NextResponse.json({ error: "Could not load form" }, { status: 500, headers })
  }
}

async function structuredSubmission(
  request: NextRequest,
  persistence: FormPersistence,
  form: PublicFormRecord,
  published: {
    readonly version: number
    readonly definition: FormDefinition
    readonly routing: FormRoutingDefinition | null
  },
  origin: string | null,
  headers: Record<string, string>,
) {
  const parsed = await readStructuredPayload(request, headers)
  if (parsed.response) return parsed.response
  if (parsed.encodedBytes > MAX_BYTES) return tooLarge(headers)

  if (honeypotValue(parsed.input)) {
    return NextResponse.json({ ok: true }, { status: 202, headers })
  }
  removeTransportField(parsed.input, "_gotcha")

  const turnstileResponse = await verifyRequiredTurnstile(form, parsed.input, request, headers)
  if (turnstileResponse) return turnstileResponse

  const result = await Effect.runPromise(
    Effect.either(
      normalizeSubmissionEffect(published.definition, parsed.input, {
        mode: parsed.mode,
      }),
    ),
  )
  if (result._tag === "Left") {
    return invalidSubmission(result.left, headers)
  }

  const evaluationId = crypto.randomUUID()
  const submissionId = crypto.randomUUID()
  const identifiers = {
    tenantId: form.teamId,
    formId: form.id,
    publicationVersion: published.version,
    submissionId,
  }
  const beforeEvent = snapshotFormEvent({
    eventId: `${evaluationId}:before`,
    tenantId: form.teamId,
    formId: form.id,
    type: "routing.evaluation.before",
    occurredAt: new Date().toISOString(),
    payload: { publicationVersion: published.version, evaluationId, submissionId },
  })
  await productionFormAutomationRegistry.runInline(beforeEvent)
  const evaluationStartedAt = performance.now()
  const routing = await evaluatePublishedFormRouting(
    form.id,
    published.version,
    published.definition,
    published.routing,
    result.right,
  )
  const afterEvent = snapshotFormEvent({
    eventId: `${evaluationId}:after`,
    tenantId: form.teamId,
    formId: form.id,
    type: "routing.evaluation.after",
    occurredAt: new Date().toISOString(),
    payload: {
      publicationVersion: published.version,
      evaluationId,
      submissionId,
      route: routing.route,
      matchedRule: routing.matchedRule,
      outcome: routing.status,
      durationMs: Math.max(0, performance.now() - evaluationStartedAt),
    },
  })
  await productionFormAutomationRegistry.runInline(afterEvent)
  const matchedEvent = matchedRoutingEvent(
    identifiers,
    routing,
    result.right,
  )
  const beforeSaveEvent = submissionEvent(
    "submission.before_save",
    identifiers,
    result.right,
    routing,
  )
  const acceptedEvent = submissionEvent(
    "submission.accepted",
    identifiers,
    result.right,
    routing,
  )
  if (matchedEvent) await productionFormAutomationRegistry.runInline(matchedEvent)
  await productionFormAutomationRegistry.runInline(beforeSaveEvent)
  const deliveries = orderFormEventDeliveries([
    ...productionFormAutomationRegistry.planDurable(beforeEvent),
    ...productionFormAutomationRegistry.planDurable(afterEvent),
    ...planFormRoutingDeliveries(published.routing, routing, matchedEvent),
    ...productionFormAutomationRegistry.planDurable(beforeSaveEvent),
    ...productionFormAutomationRegistry.planDurable(acceptedEvent),
  ], identifiers)
  const saved = await saveActiveSubmission(
    persistence,
    submissionId,
    form.teamId,
    form.id,
    published.version,
    result.right,
    routing,
    deliveries,
    origin,
    request.headers.get("user-agent")?.slice(0, 500) ?? null,
  )
  if (saved === "unavailable") return unavailable(headers)
  if (saved === "rate-limited") return rateLimited(headers)
  if (saved === "failed") return saveFailure(headers)
  await runAfterResponse(async () => {
    await Promise.all([
      productionFormAutomationRegistry.runIsolated(beforeEvent),
      productionFormAutomationRegistry.runIsolated(afterEvent),
      ...(matchedEvent ? [productionFormAutomationRegistry.runIsolated(matchedEvent)] : []),
      productionFormAutomationRegistry.runIsolated(beforeSaveEvent),
      productionFormAutomationRegistry.runIsolated(acceptedEvent),
    ])
    if (deliveries.length > 0) {
      await executeFormEventDeliveries({
        definition: published.definition,
        routing: published.routing,
        deliveries,
        store: persistence,
      })
    }
  })
  return success(request, form.successUrl, headers, published.version)
}

async function legacySubmission(
  request: NextRequest,
  persistence: FormPersistence,
  form: PublicFormRecord,
  origin: string | null,
  headers: Record<string, string>,
) {
  const parsed = await readLegacyPayload(request, headers)
  if (parsed.response) return parsed.response
  if (new TextEncoder().encode(JSON.stringify(parsed.payload)).byteLength > MAX_BYTES) {
    return tooLarge(headers)
  }
  if (parsed.payload._gotcha) {
    return NextResponse.json({ ok: true }, { status: 202, headers })
  }
  delete parsed.payload._gotcha

  const turnstileResponse = await verifyRequiredTurnstile(form, parsed.payload, request, headers)
  if (turnstileResponse) return turnstileResponse
  if (form.submissionSchema) {
    const issues = validateSubmission(form.submissionSchema as SubmissionSchema, parsed.payload)
    if (issues.length) {
      return NextResponse.json(
        { error: "Submission does not match the form schema", details: issues },
        { status: 422, headers },
      )
    }
  }

  const submissionId = crypto.randomUUID()
  const identifiers = {
    tenantId: form.teamId,
    formId: form.id,
    publicationVersion: null,
    submissionId,
  }
  const routing = notConfiguredSubmissionRouting()
  const beforeSaveEvent = submissionEvent(
    "submission.before_save",
    identifiers,
    parsed.payload,
    routing,
  )
  const acceptedEvent = submissionEvent(
    "submission.accepted",
    identifiers,
    parsed.payload,
    routing,
  )
  await productionFormAutomationRegistry.runInline(beforeSaveEvent)
  const deliveries = orderFormEventDeliveries([
    ...productionFormAutomationRegistry.planDurable(beforeSaveEvent),
    ...productionFormAutomationRegistry.planDurable(acceptedEvent),
  ], identifiers)
  const saved = await saveActiveSubmission(
    persistence,
    submissionId,
    form.teamId,
    form.id,
    null,
    parsed.payload,
    routing,
    deliveries,
    origin,
    request.headers.get("user-agent")?.slice(0, 500) ?? null,
  )
  if (saved === "unavailable") return unavailable(headers)
  if (saved === "rate-limited") return rateLimited(headers)
  if (saved === "failed") return saveFailure(headers)
  await runAfterResponse(async () => {
    await Promise.all([
      productionFormAutomationRegistry.runIsolated(beforeSaveEvent),
      productionFormAutomationRegistry.runIsolated(acceptedEvent),
    ])
    if (deliveries.length > 0) {
      await executeFormEventDeliveries({
        definition: null,
        routing: null,
        deliveries,
        store: persistence,
      })
    }
  })
  return success(request, form.successUrl, headers)
}

async function readStructuredPayload(
  request: NextRequest,
  headers: Record<string, string>,
): Promise<
  | {
      readonly input: unknown
      readonly mode: "json" | "form"
      readonly encodedBytes: number
      readonly response?: never
    }
  | { readonly response: NextResponse }
> {
  try {
    const body = await readBoundedBody(request)
    if (body === null) return { response: tooLarge(headers) }
    const contentType = request.headers.get("content-type") ?? ""
    if (contentType.includes("application/json")) {
      const input: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body))
      return {
        input: input as Record<string, unknown>,
        mode: "json",
        encodedBytes: body.byteLength,
      }
    }
    const input = await formDataFromBytes(body, contentType)
    return {
      input,
      mode: "form",
      encodedBytes: encodedPayloadBytes(formDataPayload(input)),
    }
  } catch {
    return {
      response: NextResponse.json(
        { error: "Send a JSON object or form fields" },
        { status: 400, headers },
      ),
    }
  }
}

async function readLegacyPayload(
  request: NextRequest,
  headers: Record<string, string>,
): Promise<
  | { readonly payload: Record<string, unknown>; readonly response?: never }
  | { readonly response: NextResponse }
> {
  try {
    const body = await readBoundedBody(request)
    if (body === null) return { response: tooLarge(headers) }
    const contentType = request.headers.get("content-type") ?? ""
    if (contentType.includes("application/json")) {
      const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body))
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error()
      return { payload: value as Record<string, unknown> }
    }
    const formData = await formDataFromBytes(body, contentType)
    return { payload: formDataPayload(formData) }
  } catch {
    return {
      response: NextResponse.json(
        { error: "Send a JSON object or form fields" },
        { status: 400, headers },
      ),
    }
  }
}

async function readBoundedBody(request: NextRequest): Promise<Uint8Array | null> {
  if (!request.body) return new Uint8Array()
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_BYTES) {
      await reader.cancel().catch(() => undefined)
      return null
    }
    chunks.push(value)
  }
  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

async function formDataFromBytes(body: Uint8Array, contentType: string) {
  const ownedBody = new Uint8Array(body.byteLength)
  ownedBody.set(body)
  const response = new Response(ownedBody.buffer, {
    headers: { "Content-Type": contentType },
  })
  return response.formData()
}

function formDataPayload(input: FormData): Record<string, unknown> {
  const payload: Record<string, unknown> = Object.create(null)
  for (const [key, value] of input.entries()) {
    const cleanValue =
      typeof value === "string" ? value : { name: value.name, size: value.size, type: value.type }
    const previous = payload[key]
    payload[key] =
      previous === undefined
        ? cleanValue
        : Array.isArray(previous)
          ? [...previous, cleanValue]
          : [previous, cleanValue]
  }
  return payload
}

function encodedPayloadBytes(payload: unknown): number {
  return new TextEncoder().encode(JSON.stringify(payload)).byteLength
}

function honeypotValue(input: unknown): unknown {
  if (input instanceof FormData) return input.getAll("_gotcha").some(Boolean)
  if (typeof input !== "object" || input === null) return undefined
  const descriptor = Object.getOwnPropertyDescriptor(input, "_gotcha")
  return descriptor && "value" in descriptor ? descriptor.value : undefined
}

function removeTransportField(input: unknown, key: string) {
  if (input instanceof FormData) input.delete(key)
  else if (typeof input === "object" && input !== null) {
    delete (input as Record<string, unknown>)[key]
  }
}

function transportField(input: unknown, key: string): unknown {
  if (input instanceof FormData) return input.get(key)
  if (typeof input !== "object" || input === null) return undefined
  const descriptor = Object.getOwnPropertyDescriptor(input, key)
  return descriptor && "value" in descriptor ? descriptor.value : undefined
}

async function verifyRequiredTurnstile(
  form: PublicFormRecord,
  input: unknown,
  request: NextRequest,
  headers: Record<string, string>,
): Promise<NextResponse | null> {
  const token =
    transportField(input, "cf-turnstile-response") ?? transportField(input, "turnstileToken")
  removeTransportField(input, "cf-turnstile-response")
  removeTransportField(input, "turnstileToken")
  if (!form.requiresTurnstile) return null

  try {
    const verification = await verifyTurnstile(token, request)
    if (verification.configurationError) {
      return NextResponse.json(
        { error: "Bot protection is not configured" },
        { status: 503, headers },
      )
    }
    if (!verification.ok) {
      return NextResponse.json({ error: "Bot verification failed" }, { status: 403, headers })
    }
    return null
  } catch {
    return NextResponse.json(
      { error: "Bot verification is temporarily unavailable" },
      { status: 502, headers },
    )
  }
}

async function verifyTurnstile(token: unknown, request: NextRequest) {
  const secret = process.env.TURNSTILE_SECRET_KEY
  if (!secret) return { ok: false, configurationError: true }
  if (typeof token !== "string" || !token || token.length > 2048) {
    return { ok: false, configurationError: false }
  }

  const remoteIp =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
  const response = await fetch(TURNSTILE_VERIFY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      secret,
      response: token,
      ...(remoteIp ? { remoteip: remoteIp } : {}),
    }),
    signal: AbortSignal.timeout(5000),
  })
  if (!response.ok) throw new Error("Turnstile verification failed")
  const result = (await response.json()) as { success?: boolean }
  return { ok: result.success === true, configurationError: false }
}

function invalidSubmission(error: InvalidSubmissionError, headers: Record<string, string>) {
  return NextResponse.json(
    { error: "Submission is invalid", issues: error.issues },
    { status: 422, headers },
  )
}

function tooLarge(headers: Record<string, string>) {
  return NextResponse.json({ error: "Submission is too large" }, { status: 413, headers })
}

function saveFailure(headers: Record<string, string>) {
  return NextResponse.json({ error: "Could not save submission" }, { status: 500, headers })
}

function rateLimited(headers: Record<string, string>) {
  return NextResponse.json(
    { error: "This form has reached its submission limit. Please try again shortly." },
    { status: 429, headers: { ...headers, "Retry-After": "60" } },
  )
}

function unavailable(headers: Record<string, string>) {
  return NextResponse.json({ error: "Form not found" }, { status: 404, headers })
}

async function saveActiveSubmission(
  persistence: FormPersistence,
  submissionId: string,
  tenantId: string,
  formId: string,
  publicationVersion: number | null,
  payload: unknown,
  routing: SubmissionRoutingResult,
  deliveries: readonly StoredFormEventDelivery[],
  origin: string | null,
  userAgent: string | null,
): Promise<PublicSubmissionSaveStatus | "failed"> {
  try {
    return await persistence.saveSubmission({
      submissionId,
      tenantId,
      formId,
      publicationVersion,
      payload,
      routing,
      deliveries,
      origin,
      userAgent,
    })
  } catch {
    return "failed"
  }
}

function matchedRoutingEvent(
  scope: {
    readonly tenantId: string
    readonly formId: string
    readonly publicationVersion: number
    readonly submissionId: string
  },
  routing: SubmissionRoutingResult,
  submission: Readonly<Record<string, string | number | boolean>>,
): FormEvent<"routing.matched"> | null {
  if (routing.status !== "matched" || routing.route === null || routing.matchedRule === null) {
    return null
  }
  return snapshotFormEvent({
    eventId: `${scope.submissionId}:routing.matched`,
    tenantId: scope.tenantId,
    formId: scope.formId,
    type: "routing.matched",
    occurredAt: new Date().toISOString(),
    payload: {
      publicationVersion: scope.publicationVersion,
      submissionId: scope.submissionId,
      submission,
      ruleId: routing.matchedRule,
      route: routing.route,
    },
  }) as FormEvent<"routing.matched">
}

function submissionEvent(
  type: "submission.before_save" | "submission.accepted",
  scope: {
    readonly tenantId: string
    readonly formId: string
    readonly publicationVersion: number | null
    readonly submissionId: string
  },
  submission: Readonly<Record<string, unknown>>,
  routing: SubmissionRoutingResult,
): FormEvent<"submission.before_save" | "submission.accepted"> {
  return snapshotFormEvent({
    eventId: `${scope.submissionId}:${type}`,
    tenantId: scope.tenantId,
    formId: scope.formId,
    type,
    occurredAt: new Date().toISOString(),
    payload: {
      publicationVersion: scope.publicationVersion,
      submissionId: scope.submissionId,
      submission,
      routing,
    },
  }) as FormEvent<"submission.before_save" | "submission.accepted">
}

function success(
  request: NextRequest,
  successUrl: string | null,
  headers: Record<string, string>,
  publicationVersion?: number,
) {
  if (successUrl && !request.headers.get("accept")?.includes("application/json")) {
    return NextResponse.redirect(successUrl, 303)
  }
  return NextResponse.json(
    {
      ok: true,
      ...(publicationVersion === undefined ? {} : { publicationVersion }),
      ...(successUrl === null ? {} : { redirectTo: successUrl }),
    },
    { status: 201, headers },
  )
}

function cors(origin: string | null, allowed: string | null): Record<string, string> {
  if (!allowed) return { "Access-Control-Allow-Origin": "*" }
  return origin === allowed ? { "Access-Control-Allow-Origin": allowed, Vary: "Origin" } : {}
}

function originIsAllowed(
  request: NextRequest,
  origin: string | null,
  allowed: string | null,
): boolean {
  if (!allowed) return true

  // The hosted respondent page posts to its own application origin. The
  // configured origin remains the only additional browser origin permitted
  // to embed or integrate with the endpoint.
  const isHostedSameOrigin =
    origin === request.nextUrl.origin && request.headers.get("sec-fetch-site") === "same-origin"

  return origin === allowed || isHostedSameOrigin
}
