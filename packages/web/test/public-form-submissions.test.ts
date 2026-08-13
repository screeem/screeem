import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  findPublicForm: vi.fn(),
  loadActivePublicDefinition: vi.fn(),
  rpc: vi.fn(),
}))

vi.mock("@/lib/forms/public", () => ({
  PublicDefinitionUnavailableError: class PublicDefinitionUnavailableError extends Error {},
  findPublicForm: mocks.findPublicForm,
  loadActivePublicDefinition: mocks.loadActivePublicDefinition,
}))

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: mocks.rpc }),
}))

vi.mock("@/lib/forms/schema", () => ({
  validateSubmission: vi.fn(() => []),
}))

import { OPTIONS, POST } from "../src/app/api/forms/[endpointKey]/submissions/route"
import { GET as GET_DEFINITION } from "../src/app/api/forms/[endpointKey]/route"

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
  mocks.rpc.mockResolvedValue({ error: null })
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
    const payload = mocks.rpc.mock.calls[0]?.[1]?.new_payload
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
    expect(mocks.rpc).toHaveBeenCalledWith("save_form_submission_with_routing_if_active", {
      target_form_id: "form-one",
      expected_publication_version: 3,
      new_payload: { name: "Ada", employees: 500 },
      submission_routing_status: "matched",
      submission_routing_route: "sales",
      submission_matched_rule_id: "enterprise",
      submission_routing_error: null,
      submission_origin: allowedOrigin,
      submission_user_agent: null,
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
    expect(mocks.rpc.mock.calls[0]?.[1]).toMatchObject({
      submission_routing_status: "fallback",
      submission_routing_route: "review",
      submission_matched_rule_id: null,
    })

    mocks.rpc.mockClear()
    structuredForm({
      version: 5,
      definition,
      routing: null,
      publishedAt: "2026-08-13T00:00:00.000Z",
    })
    expect((await submitStructured({ name: "Grace", employees: 20 })).status).toBe(201)
    expect(mocks.rpc.mock.calls[0]?.[1]).toMatchObject({
      submission_routing_status: "not_configured",
      submission_routing_route: null,
      submission_matched_rule_id: null,
    })
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
    expect(mocks.rpc.mock.calls[0]?.[1]).toMatchObject({
      submission_routing_status: "failed",
      submission_routing_route: null,
      submission_matched_rule_id: null,
      submission_routing_error: "routing_evaluation_failed",
    })
  })

  it("falls back to the previous submission RPC during a rolling deploy", async () => {
    structuredForm({
      version: 8,
      definition,
      routing: null,
      publishedAt: "2026-08-13T00:00:00.000Z",
    })
    mocks.rpc
      .mockResolvedValueOnce({
        error: {
          code: "PGRST202",
          message: "Could not find save_form_submission_with_routing_if_active in the schema cache",
        },
      })
      .mockResolvedValueOnce({ error: null })

    const response = await submitStructured({ name: "Ada", employees: 20 })

    expect(response.status).toBe(201)
    expect(mocks.rpc.mock.calls[1]).toEqual([
      "save_form_submission_if_active",
      {
        target_form_id: "form-one",
        expected_publication_version: 8,
        new_payload: { name: "Ada", employees: 20 },
        submission_origin: allowedOrigin,
        submission_user_agent: null,
      },
    ])
  })

  it("rejects a submission when the publication changes before its atomic save", async () => {
    structuredForm({
      version: 7,
      definition,
      routing: null,
      publishedAt: "2026-08-13T00:00:00.000Z",
    })
    mocks.rpc.mockResolvedValueOnce({ error: { message: "form_version_changed" } })

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
