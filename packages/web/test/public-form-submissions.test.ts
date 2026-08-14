import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  findPublicForm: vi.fn(),
  loadActivePublicDefinition: vi.fn(),
  saveSubmission: vi.fn(),
  claim: vi.fn(),
  succeed: vi.fn(),
  fail: vi.fn(),
}))

vi.mock("server-only", () => ({}))

vi.mock("@/lib/forms/public", () => ({
  PublicDefinitionUnavailableError: class PublicDefinitionUnavailableError extends Error {},
  findPublicForm: mocks.findPublicForm,
  loadActivePublicDefinition: mocks.loadActivePublicDefinition,
}))

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({}),
}))

vi.mock("../src/lib/forms/routing-persistence", () => ({
  createFormRoutingPersistence: () => ({
    saveSubmission: mocks.saveSubmission,
    claim: mocks.claim,
    succeed: mocks.succeed,
    fail: mocks.fail,
  }),
}))

vi.mock("@/lib/forms/schema", () => ({
  validateSubmission: vi.fn(() => []),
}))

import { OPTIONS, POST } from "../src/app/api/forms/[endpointKey]/submissions/route"
import { GET as GET_DEFINITION } from "../src/app/api/forms/[endpointKey]/route"
import { productionFormRoutingRegistry } from "../src/lib/forms/routing-registrations"

const context = { params: Promise.resolve({ endpointKey: "public-key" }) }
const allowedOrigin = "https://forms.example"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.findPublicForm.mockResolvedValue({
    id: "form-one",
    teamId: "team-one",
    allowedOrigin,
    successUrl: null,
    legacyUnstructured: true,
    definitionAvailability: "draft",
    publishedVersion: null,
    requiresTurnstile: false,
    submissionSchema: null,
  })
  mocks.loadActivePublicDefinition.mockResolvedValue(null)
  mocks.saveSubmission.mockResolvedValue("saved")
  mocks.claim.mockResolvedValue(null)
})

describe("public form submission transport", () => {
  it("does not advertise an unpublished structured draft in preflight", async () => {
    mocks.findPublicForm.mockResolvedValue({
      id: "form-one",
      teamId: "team-one",
      allowedOrigin,
      successUrl: null,
      legacyUnstructured: false,
      definitionAvailability: "draft",
      publishedVersion: null,
      requiresTurnstile: false,
      submissionSchema: null,
    })

    const response = await OPTIONS(
      request("http://localhost/api/forms/public-key/submissions", { method: "OPTIONS" }),
      context,
    )

    expect(response.status).toBe(404)
  })

  it("keeps CORS headers on malformed allowed-origin requests", async () => {
    const response = await POST(
      request("http://localhost/api/forms/public-key/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{",
      }),
      context,
    )

    expect(response.status).toBe(400)
    expect(response.headers.get("access-control-allow-origin")).toBe(allowedOrigin)
  })

  it.each([
    ["JSON", "application/json"],
    ["multipart form data", "multipart/form-data; boundary=bounded-test"],
  ])("stops an oversized chunked %s body before buffering it", async (_label, contentType) => {
    structuredForm({
      version: 1,
      definition,
      routing: null,
      publishedAt: "2026-08-13T00:00:00.000Z",
    })
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(64 * 1024 + 1))
      },
      cancel() {
        cancelled = true
      },
    })
    const oversized = new NextRequest(
      "http://localhost/api/forms/public-key/submissions",
      {
        method: "POST",
        headers: { Origin: allowedOrigin, "Content-Type": contentType },
        body,
      },
    )

    const response = await POST(oversized, context)

    expect(response.status).toBe(413)
    expect(cancelled).toBe(true)
    expect(mocks.saveSubmission).not.toHaveBeenCalled()
  })

  it("copies legacy FormData into a null-prototype payload", async () => {
    const formData = new FormData()
    formData.append("__proto__", "plain submission value")
    formData.append("name", "Ada")

    const response = await POST(
      request("http://localhost/api/forms/public-key/submissions", {
        method: "POST",
        body: formData,
      }),
      context,
    )

    expect(response.status).toBe(201)
    const payload = mocks.saveSubmission.mock.calls[0]?.[0]?.payload
    expect(Object.getPrototypeOf(payload)).toBeNull()
    expect(Object.prototype.hasOwnProperty.call(payload, "__proto__")).toBe(true)
    expect(payload.__proto__).toBe("plain submission value")
  })

  it("stores a matched route from the exact published definition", async () => {
    structuredForm({
      version: 3,
      definition,
      routing: {
        version: 1,
        rules: [{ id: "enterprise", when: "submission.employees >= 500", route: "sales" }],
        fallback: "review",
      },
      publishedAt: "2026-08-13T00:00:00.000Z",
    })

    const response = await submitStructured({ name: "Ada", employees: 500 })

    expect(response.status).toBe(201)
    expect(mocks.saveSubmission).toHaveBeenCalledWith({
      submissionId: expect.any(String),
      tenantId: "team-one",
      formId: "form-one",
      publicationVersion: 3,
      payload: { name: "Ada", employees: 500 },
      routing: {
        status: "matched",
        route: "sales",
        matchedRule: "enterprise",
        error: null,
      },
      actions: [],
      origin: allowedOrigin,
      userAgent: null,
    })
  })

  it("stores fallback and unconfigured routing outcomes", async () => {
    structuredForm({
      version: 4,
      definition,
      routing: {
        version: 1,
        rules: [{ id: "enterprise", when: "submission.employees >= 500", route: "sales" }],
        fallback: "review",
      },
      publishedAt: "2026-08-13T00:00:00.000Z",
    })
    expect((await submitStructured({ name: "Ada", employees: 20 })).status).toBe(201)
    expect(mocks.saveSubmission.mock.calls[0]?.[0]).toMatchObject({
      routing: { status: "fallback", route: "review", matchedRule: null },
    })

    mocks.saveSubmission.mockClear()
    structuredForm({
      version: 5,
      definition,
      routing: null,
      publishedAt: "2026-08-13T00:00:00.000Z",
    })
    expect((await submitStructured({ name: "Grace", employees: 20 })).status).toBe(201)
    expect(mocks.saveSubmission.mock.calls[0]?.[0]).toMatchObject({
      routing: { status: "not_configured", route: null, matchedRule: null },
    })
  })

  it("emits lifecycle events with stable submission and tenant identifiers", async () => {
    structuredForm({
      version: 9,
      definition,
      routing: null,
      publishedAt: "2026-08-13T00:00:00.000Z",
    })
    const before = vi.spyOn(productionFormRoutingRegistry, "emitBefore")
    const after = vi.spyOn(productionFormRoutingRegistry, "emitAfter")

    const response = await submitStructured({ name: "Ada", employees: 20 })

    expect(response.status).toBe(201)
    const beforeEvent = before.mock.calls[0]?.[0]
    expect(beforeEvent).toMatchObject({
      type: "before_evaluation",
      tenantId: "team-one",
      formId: "form-one",
      publicationVersion: 9,
      evaluationId: expect.any(String),
    })
    expect(after).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "after_evaluation",
        evaluationId: beforeEvent?.evaluationId,
        outcome: "not_configured",
        durationMs: expect.any(Number),
      }),
    )
    before.mockRestore()
    after.mockRestore()
  })

  it("persists matched action plans before attempting execution", async () => {
    structuredForm({
      version: 10,
      definition,
      routing: {
        version: 1,
        rules: [
          {
            id: "enterprise",
            when: "submission.employees >= 500",
            route: "sales",
            actions: [{ use: "notify", with: "({ name: submission.name })" }],
          },
        ],
        fallback: "review",
      },
      publishedAt: "2026-08-13T00:00:00.000Z",
    })
    mocks.claim.mockResolvedValueOnce({ attempt: 1 })

    const response = await submitStructured({ name: "Ada", employees: 500 })

    expect(response.status).toBe(201)
    expect(mocks.saveSubmission.mock.calls[0]?.[0]).toMatchObject({
      actions: [
        { key: "enterprise:0", name: "notify", index: 0, ruleId: "enterprise" },
      ],
    })
    expect(mocks.claim).toHaveBeenCalledOnce()
  })

  it("saves a valid submission when routing evaluation fails", async () => {
    structuredForm({
      version: 6,
      definition,
      routing: {
        version: 1,
        rules: [{ id: "always", when: "true", route: "sales" }],
        fallback: "review",
      },
      publishedAt: "2026-08-13T00:00:00.000Z",
    })

    const response = await submitStructured({ name: "x".repeat(17_000), employees: 500 })

    expect(response.status).toBe(201)
    expect(mocks.saveSubmission.mock.calls[0]?.[0]).toMatchObject({
      routing: {
        status: "failed",
        route: null,
        matchedRule: null,
        error: "routing_evaluation_failed",
      },
    })
  })

  it("fails closed when the transactional store is unavailable", async () => {
    structuredForm({
      version: 8,
      definition,
      routing: null,
      publishedAt: "2026-08-13T00:00:00.000Z",
    })
    mocks.saveSubmission.mockRejectedValueOnce(new Error("database unavailable"))

    const response = await submitStructured({ name: "Ada", employees: 20 })

    expect(response.status).toBe(500)
    expect(mocks.saveSubmission).toHaveBeenCalledOnce()
  })

  it("does not save an action-bearing submission without durable action storage", async () => {
    structuredForm({
      version: 11,
      definition,
      routing: {
        version: 1,
        rules: [
          {
            id: "enterprise",
            when: "submission.employees >= 500",
            route: "sales",
            actions: [{ use: "notify", with: "({ name: submission.name })" }],
          },
        ],
        fallback: "review",
      },
      publishedAt: "2026-08-13T00:00:00.000Z",
    })
    mocks.saveSubmission.mockRejectedValueOnce(new Error("action table unavailable"))

    const response = await submitStructured({ name: "Ada", employees: 500 })

    expect(response.status).toBe(500)
    expect(mocks.saveSubmission).toHaveBeenCalledOnce()
  })

  it("rejects a submission when the publication changes before its atomic save", async () => {
    structuredForm({
      version: 7,
      definition,
      routing: null,
      publishedAt: "2026-08-13T00:00:00.000Z",
    })
    mocks.saveSubmission.mockResolvedValueOnce("unavailable")

    const response = await submitStructured({ name: "Ada", employees: 500 })

    expect(response.status).toBe(404)
  })
})

describe("public form definition transport", () => {
  it("allows the hosted same-origin page when an embed origin is configured", async () => {
    mocks.loadActivePublicDefinition.mockResolvedValue({
      version: 1,
      definition: { formatVersion: 1, title: "Form", fields: [] },
      publishedAt: "2026-08-12T00:00:00.000Z",
    })
    const hostedRequest = new NextRequest("http://localhost/api/forms/public-key", {
      headers: {
        Origin: "http://localhost",
        "Sec-Fetch-Site": "same-origin",
      },
    })

    const response = await GET_DEFINITION(hostedRequest, context)

    expect(response.status).toBe(200)
  })
})

function request(url: string, init: RequestInit) {
  const headers = new Headers(init.headers)
  headers.set("Origin", allowedOrigin)
  return new NextRequest(url, {
    method: init.method,
    headers,
    body: init.body,
  })
}

const definition = {
  formatVersion: 1 as const,
  title: "Qualification",
  submitLabel: "Apply",
  successMessage: "Received",
  fields: [
    {
      id: "name-field",
      name: "name",
      label: "Name",
      required: true,
      type: "string" as const,
      control: "text" as const,
    },
    {
      id: "employees-field",
      name: "employees",
      label: "Employees",
      required: true,
      type: "number" as const,
      control: "number" as const,
    },
  ],
}

function structuredForm(published: Record<string, unknown>) {
  mocks.findPublicForm.mockResolvedValue({
    id: "form-one",
    teamId: "team-one",
    allowedOrigin,
    successUrl: null,
    legacyUnstructured: false,
    definitionAvailability: "active",
    publishedVersion: published.version,
    requiresTurnstile: false,
    submissionSchema: null,
  })
  mocks.loadActivePublicDefinition.mockResolvedValue(published)
}

function submitStructured(payload: Record<string, unknown>) {
  return POST(
    request("http://localhost/api/forms/public-key/submissions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
    context,
  )
}
