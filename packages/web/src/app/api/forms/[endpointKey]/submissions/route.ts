import { InvalidSubmissionError, type FormDefinition } from "@screeem/forms"
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
import { qualifySubmission, type QualificationResult } from "@/lib/forms/qualification"

const MAX_BYTES = 64 * 1024
const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"

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
    return published
      ? await structuredSubmission(request, admin, form, published, origin, headers)
      : await legacySubmission(request, admin, form, origin, headers)
  } catch (error) {
    if (error instanceof PublicDefinitionUnavailableError) {
      return NextResponse.json({ error: "Form not found" }, { status: 404, headers })
    }
    return NextResponse.json({ error: "Could not load form" }, { status: 500, headers })
  }
}

type SupabaseAdmin = ReturnType<typeof createAdminClient>

async function structuredSubmission(
  request: NextRequest,
  admin: SupabaseAdmin,
  form: PublicFormRecord,
  published: {
    readonly version: number
    readonly definition: FormDefinition
    readonly routing: import("@screeem/forms").FormRoutingDefinition | null
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

  let qualification: QualificationResult | null
  try {
    qualification = await qualifySubmission(
      published.definition,
      published.routing,
      result.right,
    )
  } catch {
    return NextResponse.json(
      { error: "Could not qualify submission" },
      { status: 500, headers },
    )
  }

  const saved = await saveActiveSubmission(
    admin,
    form.id,
    published.version,
    result.right,
    origin,
    request.headers.get("user-agent")?.slice(0, 500) ?? null,
    qualification,
  )
  if (saved === "unavailable") return unavailable(headers)
  if (saved === "rate-limited") return rateLimited(headers)
  if (saved === "failed") return saveFailure(headers)
  return success(request, form.successUrl, headers, published.version, qualification)
}

async function legacySubmission(
  request: NextRequest,
  admin: SupabaseAdmin,
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

  const saved = await saveActiveSubmission(
    admin,
    form.id,
    null,
    parsed.payload,
    origin,
    request.headers.get("user-agent")?.slice(0, 500) ?? null,
    null,
  )
  if (saved === "unavailable") return unavailable(headers)
  if (saved === "rate-limited") return rateLimited(headers)
  if (saved === "failed") return saveFailure(headers)
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
    const contentType = request.headers.get("content-type") ?? ""
    if (contentType.includes("application/json")) {
      const input: unknown = await request.json()
      return {
        input: input as Record<string, unknown>,
        mode: "json",
        encodedBytes: new TextEncoder().encode(JSON.stringify(input)).byteLength,
      }
    }
    const input = await request.formData()
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
    const contentType = request.headers.get("content-type") ?? ""
    if (contentType.includes("application/json")) {
      const value: unknown = await request.json()
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error()
      return { payload: value as Record<string, unknown> }
    }
    const formData = await request.formData()
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
  admin: SupabaseAdmin,
  formId: string,
  publicationVersion: number | null,
  payload: unknown,
  origin: string | null,
  userAgent: string | null,
  qualification: QualificationResult | null,
): Promise<"saved" | "unavailable" | "rate-limited" | "failed"> {
  const { error } = await admin.rpc("save_form_submission_if_active", {
    target_form_id: formId,
    expected_publication_version: publicationVersion,
    new_payload: payload,
    submission_origin: origin,
    submission_user_agent: userAgent,
    new_qualification_route: qualification?.route ?? null,
    new_qualification_matched_rule: qualification?.matchedRule ?? null,
  })
  if (!error) return "saved"
  if (
    error.message.includes("form_unavailable") ||
    error.message.includes("form_version_changed")
  ) {
    return "unavailable"
  }
  if (error.message.includes("form_rate_limited")) return "rate-limited"
  return "failed"
}

function success(
  request: NextRequest,
  successUrl: string | null,
  headers: Record<string, string>,
  publicationVersion?: number,
  qualification?: QualificationResult | null,
) {
  if (successUrl && !request.headers.get("accept")?.includes("application/json")) {
    return NextResponse.redirect(successUrl, 303)
  }
  return NextResponse.json(
    {
      ok: true,
      ...(publicationVersion === undefined ? {} : { publicationVersion }),
      ...(qualification === null || qualification === undefined
        ? {}
        : { qualification }),
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
