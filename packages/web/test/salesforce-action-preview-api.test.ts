import { NextRequest, NextResponse } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  createPreviewService: vi.fn(),
  previewLead: vi.fn(),
  createAdmin: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  abortSignal: vi.fn(),
  maybeSingle: vi.fn(),
}))

vi.mock("server-only", () => ({}))
vi.mock("@/lib/integrations/api", async () => import("../src/lib/integrations/api"))
vi.mock("@/lib/integrations/contract", async () => import("../src/lib/integrations/contract"))
vi.mock("@/lib/integrations/provider-registry", async () => import("../src/lib/integrations/provider-registry"))
vi.mock("@/lib/integrations/salesforce/contract", async () => import("../src/lib/integrations/salesforce/contract"))
vi.mock("@/lib/forms/authorization", () => ({ authorizeFormTeam: mocks.authorize }))
vi.mock("@/lib/integrations/server", () => ({
  createSalesforceActionPreviewService: mocks.createPreviewService,
}))
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdmin }))

import { POST as preview } from "../src/app/api/teams/[teamId]/forms/[formId]/actions/crm.upsertLead/preview/route"
import { IntegrationResolutionError } from "../src/lib/integrations/provider-registry"
import { SalesforceError } from "../src/lib/integrations/salesforce/contract"
import { salesforceProviderName } from "../src/lib/integrations/salesforce/contract"

const teamId = "72000000-0000-0000-0000-000000000001"
const formId = "75000000-0000-0000-0000-000000000001"
const context = { params: Promise.resolve({ teamId, formId }) }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.authorize.mockResolvedValue({ error: null, user: { id: "user" } })
  const query = {
    select: mocks.select,
    eq: mocks.eq,
    abortSignal: mocks.abortSignal,
    maybeSingle: mocks.maybeSingle,
  }
  mocks.createAdmin.mockReturnValue({ from: mocks.from })
  mocks.from.mockReturnValue(query)
  mocks.select.mockReturnValue(query)
  mocks.eq.mockReturnValue(query)
  mocks.abortSignal.mockReturnValue(query)
  mocks.maybeSingle.mockResolvedValue({ data: { id: formId }, error: null })
  mocks.createPreviewService.mockReturnValue({ previewLead: mocks.previewLead })
  mocks.previewLead.mockResolvedValue({
    status: "success",
    summary: "Salesforce is ready.",
    details: [{ label: "Operation", value: "Upsert Lead" }],
  })
})

describe("Salesforce action preview API", () => {
  it("authorizes the manager, verifies form ownership, and previews for the path tenant", async () => {
    const response = await preview(request(previewBody()), context)

    expect(response.status).toBe(200)
    expect(response.headers.get("Cache-Control")).toBe("no-store")
    expect(mocks.authorize).toHaveBeenCalledWith(teamId, true, expect.any(AbortSignal))
    expect(mocks.from).toHaveBeenCalledWith("forms")
    expect(mocks.eq).toHaveBeenCalledWith("team_id", teamId)
    expect(mocks.eq).toHaveBeenCalledWith("id", formId)
    expect(mocks.abortSignal).toHaveBeenCalledWith(expect.any(AbortSignal))
    expect(mocks.previewLead).toHaveBeenCalledWith(
      teamId,
      previewBody(),
      expect.any(AbortSignal),
    )
    await expect(response.json()).resolves.toEqual({
      status: "success",
      summary: "Salesforce is ready.",
      details: [{ label: "Operation", value: "Upsert Lead" }],
    })
  })

  it("denies non-managers before reading the form or constructing the preview service", async () => {
    mocks.authorize.mockResolvedValueOnce({
      error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    })

    const response = await preview(request(previewBody()), context)

    expect(response.status).toBe(403)
    expect(mocks.createAdmin).not.toHaveBeenCalled()
    expect(mocks.createPreviewService).not.toHaveBeenCalled()
  })

  it("bounds a deferred authorization before reading the form", async () => {
    const controller = new AbortController()
    let authorizationSignal: AbortSignal | undefined
    mocks.authorize.mockImplementationOnce(
      (_teamId: string, _requireManager: boolean, signal: AbortSignal) => {
        authorizationSignal = signal
        return new Promise((_, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true })
        })
      },
    )

    const pending = preview(request(previewBody(), controller.signal), context)
    await vi.waitFor(() => expect(authorizationSignal).toBeDefined())
    controller.abort(new DOMException("Cancelled", "AbortError"))
    const response = await pending

    expect(response.status).toBe(408)
    expect(mocks.createAdmin).not.toHaveBeenCalled()
    expect(mocks.createPreviewService).not.toHaveBeenCalled()
  })

  it("rejects a form outside the authorized team before resolving Salesforce", async () => {
    mocks.maybeSingle.mockResolvedValueOnce({ data: null, error: null })

    const response = await preview(request(previewBody()), context)

    expect(response.status).toBe(404)
    expect(mocks.createPreviewService).not.toHaveBeenCalled()
  })

  it("cancels a deferred ownership lookup before constructing the preview service", async () => {
    const controller = new AbortController()
    let lookupSignal: AbortSignal | undefined
    mocks.abortSignal.mockImplementationOnce((signal: AbortSignal) => {
      lookupSignal = signal
      return { maybeSingle: mocks.maybeSingle }
    })
    mocks.maybeSingle.mockImplementationOnce(() => new Promise((_, reject) => {
      lookupSignal?.addEventListener("abort", () => reject(lookupSignal?.reason), { once: true })
    }))

    const pending = preview(request(previewBody(), controller.signal), context)
    await vi.waitFor(() => expect(lookupSignal).toBeDefined())
    controller.abort(new DOMException("Cancelled", "AbortError"))
    const response = await pending

    expect(response.status).toBe(408)
    expect(mocks.createPreviewService).not.toHaveBeenCalled()
  })

  it("bounds and validates the preview body", async () => {
    const oversized = await preview(request({ padding: "x".repeat(270_000) }), context)
    expect(oversized.status).toBe(413)
    expect(mocks.createPreviewService).not.toHaveBeenCalled()

    mocks.previewLead.mockRejectedValueOnce(new TypeError("hostile accessor detail"))
    const malformed = await preview(request({ definition: {} }), context)
    expect(malformed.status).toBe(400)
    await expect(malformed.json()).resolves.toEqual({ error: "Invalid preview request" })
  })

  it("cancels a stalled chunked body before constructing the preview service", async () => {
    const controller = new AbortController()
    const cancelled = vi.fn()
    let bodyStarted = false
    const body = new ReadableStream<Uint8Array>({
      pull() {
        bodyStarted = true
        return new Promise<void>(() => undefined)
      },
      cancel: cancelled,
    })
    const pending = preview(streamingRequest(body, controller.signal), context)
    await vi.waitFor(() => expect(bodyStarted).toBe(true))
    controller.abort(new DOMException("Cancelled", "AbortError"))
    const response = await pending

    expect(response.status).toBe(408)
    expect(cancelled).toHaveBeenCalledOnce()
    expect(mocks.createPreviewService).not.toHaveBeenCalled()
  })

  it("maps connection, reauthorization, and rate-limit failures without exposing details", async () => {
    mocks.previewLead.mockRejectedValueOnce(
      new IntegrationResolutionError("connection_unavailable", salesforceProviderName),
    )
    const disconnected = await preview(request(previewBody()), context)
    expect(disconnected.status).toBe(409)

    mocks.previewLead.mockRejectedValueOnce(
      new SalesforceError("authentication_failed", false),
    )
    const expired = await preview(request(previewBody()), context)
    expect(expired.status).toBe(409)

    mocks.previewLead.mockRejectedValueOnce(
      new SalesforceError("rate_limited", true, 90_000),
    )
    const limited = await preview(request(previewBody()), context)
    expect(limited.status).toBe(429)
    expect(limited.headers.get("Retry-After")).toBe("90")

    const serialized = JSON.stringify([
      await disconnected.json(),
      await expired.json(),
      await limited.json(),
    ])
    expect(serialized).not.toMatch(/token|credential|database|provider detail/i)
  })

  it("reports a provider operation deadline as a timeout", async () => {
    mocks.previewLead.mockRejectedValueOnce(new DOMException("Timed out", "TimeoutError"))

    const response = await preview(request(previewBody()), context)

    expect(response.status).toBe(408)
    await expect(response.json()).resolves.toEqual({ error: "Salesforce preview timed out" })
  })
})

function request(body: unknown, signal?: AbortSignal) {
  return new NextRequest(
    `http://localhost/api/teams/${teamId}/forms/${formId}` +
      "/actions/crm.upsertLead/preview",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    },
  )
}

function streamingRequest(body: ReadableStream<Uint8Array>, signal: AbortSignal) {
  return new NextRequest(
    `http://localhost/api/teams/${teamId}/forms/${formId}` +
      "/actions/crm.upsertLead/preview",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal,
    },
  )
}

function previewBody() {
  return {
    definition: {
      formatVersion: 1,
      title: "Lead qualification",
      submitLabel: "Submit",
      successMessage: "Thanks",
      fields: [
        {
          id: "last-name-field",
          name: "last_name",
          label: "Last name",
          required: true,
          type: "string",
          control: "text",
        },
        {
          id: "company-field",
          name: "company",
          label: "Company",
          required: true,
          type: "string",
          control: "text",
        },
        {
          id: "email-field",
          name: "email",
          label: "Email",
          required: true,
          type: "string",
          control: "email",
        },
      ],
    },
    submission: {
      last_name: "Lovelace",
      company: "Analytical Engines",
      email: "ada@example.com",
    },
    routing: {
      status: "fallback",
      route: "commercial",
      matchedRule: null,
      error: null,
    },
    action: {
      id: "action-1",
      use: "crm.upsertLead",
      inputs: [
        { input: "lastName", fieldId: "last-name-field" },
        { input: "company", fieldId: "company-field" },
        { input: "email", fieldId: "email-field" },
      ],
      input: {
        lastName: "Lovelace",
        company: "Analytical Engines",
        email: "ada@example.com",
      },
    },
  }
}
