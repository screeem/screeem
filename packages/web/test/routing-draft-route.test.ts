import { FormRevisionConflictError, InvalidFormRoutingError } from "@screeem/forms"
import { NextRequest, NextResponse } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  authorizeFormTeam: vi.fn(),
  saveRoutingDraft: vi.fn(),
}))

vi.mock("@/lib/forms/authorization", () => ({
  authorizeFormTeam: mocks.authorizeFormTeam,
}))

vi.mock("@/lib/forms/server", () => ({
  createFormDefinitionStore: () => ({ saveRoutingDraft: mocks.saveRoutingDraft }),
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

  it("maps stale shared revisions to a 409 response", async () => {
    mocks.saveRoutingDraft.mockRejectedValue(new FormRevisionConflictError("form-one", 2, 4))

    const response = await PUT(request({ expectedRevision: 2, routing }), context)

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({ currentRevision: 4 })
  })

  it("rejects an oversized encoded body before opening the team store", async () => {
    const response = await PUT(rawRequest(`{"padding":"${"x".repeat(256 * 1024)}"}`), context)

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
