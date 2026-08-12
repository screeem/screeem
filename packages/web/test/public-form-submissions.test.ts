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
