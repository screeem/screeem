import {
  FormRevisionConflictError,
  InvalidFormRoutingError,
  generateFormRoutingDefinition,
  type FormDefinition,
  type FormRoutingAuthoring,
} from "@screeem/forms"
import { NextRequest, NextResponse } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  authorizeFormTeam: vi.fn(),
  assertFormRoutingAuthoring: vi.fn(),
  getDraft: vi.fn(),
  saveRoutingDraft: vi.fn(),
}))

vi.mock("@/lib/forms/authorization", () => ({
  authorizeFormTeam: mocks.authorizeFormTeam,
}))

vi.mock("@/lib/forms/server", () => ({
  assertFormRoutingAuthoring: mocks.assertFormRoutingAuthoring,
  createFormDefinitionStore: () => ({
    getDraft: mocks.getDraft,
    saveRoutingDraft: mocks.saveRoutingDraft,
  }),
}))

vi.mock("server-only", () => ({}))
vi.mock("@/lib/forms/http", async () => {
  const actual = await import("../src/lib/forms/http")
  return { formErrorResponse: actual.formErrorResponse }
})

import { PUT } from "../src/app/api/teams/[teamId]/forms/[formId]/draft/routing/route"

const context = { params: Promise.resolve({ teamId: "team-one", formId: "form-one" }) }
const routing = {
  version: 1,
  rules: [{ id: "enterprise", when: "submission.employees >= 500", route: "sales" }],
  fallback: "self-serve",
} as const

beforeEach(() => {
  vi.clearAllMocks()
  mocks.authorizeFormTeam.mockResolvedValue({ error: null })
  mocks.getDraft.mockResolvedValue({
    revision: 2,
    definition: {
      formatVersion: 1,
      title: "Qualification",
      submitLabel: "Submit",
      successMessage: "Thanks",
      fields: [],
    },
    routing: null,
  })
  mocks.saveRoutingDraft.mockResolvedValue({
    formId: "form-one",
    revision: 3,
    definition: { formatVersion: 1, fields: [] },
    routing,
  })
})

describe("routing draft API", () => {
  it("saves routing through the authorized team store at the expected revision", async () => {
    const response = await PUT(request({ expectedRevision: 2, routing }), context)

    expect(response.status).toBe(200)
    expect(mocks.authorizeFormTeam).toHaveBeenCalledWith("team-one", true)
    expect(mocks.saveRoutingDraft).toHaveBeenCalledWith("form-one", 2, routing)
    await expect(response.json()).resolves.toMatchObject({ draft: { revision: 3, routing } })
  })

  it("rejects requests that omit the routing value", async () => {
    const response = await PUT(request({ expectedRevision: 2 }), context)

    expect(response.status).toBe(400)
    expect(mocks.saveRoutingDraft).not.toHaveBeenCalled()
  })

  it("returns an authorization denial without opening the team store", async () => {
    mocks.authorizeFormTeam.mockResolvedValue({
      error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    })

    const response = await PUT(request({ expectedRevision: 2, routing }), context)

    expect(response.status).toBe(403)
    expect(mocks.saveRoutingDraft).not.toHaveBeenCalled()
  })

  it("maps invalid routing diagnostics to a 400 response", async () => {
    mocks.saveRoutingDraft.mockRejectedValue(
      new InvalidFormRoutingError([
        { code: "routing_expression_limit", message: "Condition is too long" },
      ]),
    )

    const response = await PUT(request({ expectedRevision: 2, routing }), context)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      issues: [{ code: "routing_expression_limit" }],
    })
  })

  it("validates visual authoring against the current form before saving", async () => {
    const definition: FormDefinition = {
      formatVersion: 1,
      title: "Qualification",
      submitLabel: "Submit",
      successMessage: "Thanks",
      fields: [{
        id: "employees",
        name: "employees",
        label: "Employees",
        required: true,
        type: "number",
        control: "number",
      }],
    }
    const generated = generateFormRoutingDefinition(definition, {
      version: 1,
      rules: [{
        id: "enterprise",
        combinator: "all",
        conditions: [{
          id: "employees-condition",
          fieldId: "employees",
          operator: "greater_than_or_equal",
          value: 500,
        }],
        route: "sales",
      }],
      fallback: "review",
    })
    if (!generated.ok) throw new Error("Expected visual routing")
    mocks.getDraft.mockResolvedValueOnce({ revision: 2, definition, routing: null })

    const response = await PUT(
      request({ expectedRevision: 2, routing: generated.routing }),
      context,
    )

    expect(response.status).toBe(200)
    expect(mocks.getDraft).toHaveBeenCalledWith("form-one")
    expect(mocks.assertFormRoutingAuthoring).toHaveBeenCalledWith(
      definition,
      generated.routing,
    )
  })

  it("does not persist a visual runtime that fails authoritative regeneration", async () => {
    mocks.assertFormRoutingAuthoring.mockImplementationOnce(() => {
      throw new InvalidFormRoutingError([{
        code: "routing_authoring_mismatch",
        message: "Visual actions do not match runtime actions",
      }])
    })
    const authoringRouting = {
      ...routing,
      authoring: {
        version: 1 as const,
        rules: [{
          id: "enterprise",
          combinator: "all" as const,
          conditions: [{
            id: "employees-condition",
            fieldId: "employees",
            operator: "greater_than_or_equal" as const,
            value: 500,
          }],
          route: "sales",
        }],
        fallback: "self-serve",
      },
    }

    const response = await PUT(
      request({ expectedRevision: 2, routing: authoringRouting }),
      context,
    )

    expect(response.status).toBe(400)
    expect(mocks.saveRoutingDraft).not.toHaveBeenCalled()
  })

  it("maps stale shared revisions to a 409 response", async () => {
    mocks.saveRoutingDraft.mockRejectedValue(new FormRevisionConflictError("form-one", 2, 4))

    const response = await PUT(request({ expectedRevision: 2, routing }), context)

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({ currentRevision: 4 })
  })

  it("rejects an oversized encoded body before opening the team store", async () => {
    const response = await PUT(
      rawRequest(`{"padding":"${"x".repeat(3 * 1024 * 1024 + 1_024)}"}`),
      context,
    )

    expect(response.status).toBe(413)
    expect(mocks.saveRoutingDraft).not.toHaveBeenCalled()
  })

  it("accepts a valid maximum-count visual draft through the transport boundary", async () => {
    const definition: FormDefinition = {
      formatVersion: 1,
      title: "Qualification",
      submitLabel: "Submit",
      successMessage: "Thanks",
      fields: [
        {
          id: "employees",
          name: "employees",
          label: "Employees",
          required: true,
          type: "number",
          control: "number",
        },
      ],
    }
    const authoring: FormRoutingAuthoring = {
      version: 1,
      rules: Array.from({ length: 100 }, (_, ruleIndex) => ({
        id: `form-rule-${ruleIndex}-${"r".repeat(40)}`,
        combinator: "all",
        conditions: Array.from({ length: 20 }, (_, conditionIndex) => ({
          id: `form-condition-${ruleIndex}-${conditionIndex}-${"c".repeat(40)}`,
          fieldId: "employees",
          operator: "greater_than_or_equal",
          value: conditionIndex,
        })),
        route: `destination-${ruleIndex}`,
      })),
      fallback: "review",
    }
    const generated = generateFormRoutingDefinition(definition, authoring)
    if (!generated.ok) throw new Error("Expected maximum-count routing to be valid")
    const encoded = JSON.stringify({ expectedRevision: 2, routing: generated.routing })
    expect(new TextEncoder().encode(encoded).byteLength).toBeGreaterThan(256 * 1024)

    const response = await PUT(rawRequest(encoded), context)

    expect(response.status).toBe(200)
    expect(mocks.saveRoutingDraft).toHaveBeenCalledWith("form-one", 2, generated.routing)
  })

  it("rejects a contract-valid advanced model above the aggregate write budget", async () => {
    const rules = Array.from({ length: 100 }, (_, ruleIndex) => ({
      id: `${ruleIndex}-${"r".repeat(124)}`.slice(0, 128),
      when: "w".repeat(4_096),
      route: "destination",
      actions: Array.from({ length: 10 }, (_, actionIndex) => ({
        use: `${actionIndex}-${"a".repeat(124)}`.slice(0, 128),
        with: "x".repeat(4_096),
      })),
    }))
    const authoring = {
      version: 1,
      rules: Array.from({ length: 100 }, (_, ruleIndex) => ({
        id: rules[ruleIndex]!.id,
        combinator: "all",
        conditions: Array.from({ length: 20 }, (_, conditionIndex) => ({
          id: `${ruleIndex}-${conditionIndex}-${"c".repeat(120)}`.slice(0, 128),
          fieldId: "f".repeat(128),
          operator: "equals",
          value: "v".repeat(1_024),
        })),
        route: "destination",
      })),
      fallback: "review",
    } as const
    const maximumRouting = { version: 1 as const, rules, fallback: "review", authoring }
    const encoded = JSON.stringify({ expectedRevision: 2, routing: maximumRouting })
    expect(new TextEncoder().encode(encoded).byteLength).toBeGreaterThan(3 * 1024 * 1024)

    const response = await PUT(rawRequest(encoded), context)

    expect(response.status).toBe(413)
    expect(mocks.saveRoutingDraft).not.toHaveBeenCalled()
  })
})

function request(body: unknown) {
  return rawRequest(JSON.stringify(body))
}

function rawRequest(body: string) {
  return new NextRequest("http://localhost/api/teams/team-one/forms/form-one/draft/routing", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body,
  })
}
