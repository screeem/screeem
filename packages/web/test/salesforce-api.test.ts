import { NextRequest, NextResponse } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  authorizeTeam: vi.fn(),
  createService: vi.fn(),
  disconnectSalesforce: vi.fn(),
  returnUrl: vi.fn(),
  begin: vi.fn(),
  consumeState: vi.fn(),
  complete: vi.fn(),
  disconnect: vi.fn(),
  test: vi.fn(),
  createClient: vi.fn(),
  getUser: vi.fn(),
  getMembership: vi.fn(),
  canManage: vi.fn(),
}))

vi.mock("server-only", () => ({}))
vi.mock("@/lib/integrations/api", async () => import("../src/lib/integrations/api"))
vi.mock("@/lib/integrations/contract", async () => import("../src/lib/integrations/contract"))
vi.mock("@/lib/integrations/provisioning-store", async () => import("../src/lib/integrations/provisioning-store"))
vi.mock("@/lib/integrations/salesforce/contract", async () => import("../src/lib/integrations/salesforce/contract"))
vi.mock("@/lib/teams/authorization", () => ({ authorizeTeam: mocks.authorizeTeam }))
vi.mock("@/lib/integrations/server", () => ({
  createSalesforceConnectionService: mocks.createService,
  disconnectSalesforceConnection: mocks.disconnectSalesforce,
  createSalesforceReturnUrl: mocks.returnUrl,
}))
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }))
vi.mock("@/lib/teams/server", () => ({
  getMembership: mocks.getMembership,
  canManage: mocks.canManage,
}))

import { POST as connect } from "../src/app/api/teams/[teamId]/integrations/salesforce/connect/route"
import { DELETE as disconnect } from "../src/app/api/teams/[teamId]/integrations/salesforce/route"
import { POST as testConnection } from "../src/app/api/teams/[teamId]/integrations/salesforce/test/route"
import { GET as callback } from "../src/app/api/integrations/salesforce/callback/route"
import { IntegrationAuthorizationAttemptError } from "../src/lib/integrations/provisioning-store"

const teamId = "72000000-0000-0000-0000-000000000001"
const userId = "73000000-0000-0000-0000-000000000001"
const context = { params: Promise.resolve({ teamId }) }
const oauthState = {
  stateHash: "h".repeat(43),
  teamId,
  attemptId: "74000000-0000-0000-0000-000000000001",
  userId,
  codeVerifier: "v".repeat(64),
  returnPath: "/dashboard/forms",
  createdAt: "2026-08-14T10:00:00.000Z",
  expiresAt: "2026-08-14T10:10:00.000Z",
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.authorizeTeam.mockResolvedValue({ error: null, user: { id: userId } })
  mocks.createService.mockResolvedValue({
    begin: mocks.begin,
    consumeState: mocks.consumeState,
    complete: mocks.complete,
    disconnect: mocks.disconnect,
    test: mocks.test,
  })
  mocks.begin.mockResolvedValue({ authorizationUrl: "https://login.salesforce.com/authorize" })
  mocks.disconnect.mockResolvedValue({ id: "connection" })
  mocks.disconnectSalesforce.mockResolvedValue({ id: "connection" })
  mocks.test.mockResolvedValue({ remaining: 100, maximum: 1_000 })
  mocks.createClient.mockResolvedValue({ auth: { getUser: mocks.getUser } })
  mocks.getUser.mockResolvedValue({ data: { user: { id: userId } } })
  mocks.consumeState.mockResolvedValue(oauthState)
  mocks.getMembership.mockResolvedValue({ role: "owner" })
  mocks.canManage.mockReturnValue(true)
  mocks.returnUrl.mockImplementation((path: string, status: string) => {
    const url = new URL(path, "https://app.screeem.example")
    url.searchParams.set("integration", "salesforce")
    url.searchParams.set("status", status)
    return url
  })
})

describe("Salesforce integration API", () => {
  it("starts OAuth only after manager authorization", async () => {
    const response = await connect(
      request(`/api/teams/${teamId}/integrations/salesforce/connect`, {
        method: "POST",
        body: JSON.stringify({ returnPath: "/dashboard/forms?tab=integrations" }),
      }),
      context,
    )

    expect(response.status).toBe(201)
    expect(mocks.authorizeTeam).toHaveBeenCalledWith(teamId, true)
    expect(mocks.begin).toHaveBeenCalledWith(teamId, userId, "/dashboard/forms?tab=integrations")
    expect(response.headers.get("Cache-Control")).toBe("no-store")
  })

  it("rejects authorization and oversized bodies before constructing the service", async () => {
    mocks.authorizeTeam.mockResolvedValueOnce({
      error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    })
    const denied = await connect(request(`/api/teams/${teamId}/integrations/salesforce/connect`, {
      method: "POST",
      body: "{}",
    }), context)
    expect(denied.status).toBe(403)
    expect(mocks.createService).not.toHaveBeenCalled()

    const oversized = await connect(request(`/api/teams/${teamId}/integrations/salesforce/connect`, {
      method: "POST",
      body: JSON.stringify({ padding: "x".repeat(5_000) }),
    }), context)
    expect(oversized.status).toBe(413)
    expect(mocks.createService).not.toHaveBeenCalled()
  })

  it("returns 400 for malformed connect input", async () => {
    const response = await connect(request(`/api/teams/${teamId}/integrations/salesforce/connect`, {
      method: "POST",
      body: JSON.stringify({ returnPath: "https://evil.invalid", extra: true }),
    }), context)

    expect(response.status).toBe(400)
    expect(mocks.createService).not.toHaveBeenCalled()
  })

  it("disconnects locally and exposes only a boolean result", async () => {
    const response = await disconnect(request(`/api/teams/${teamId}/integrations/salesforce`, {
      method: "DELETE",
    }), context)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ disconnected: true })
    expect(mocks.disconnectSalesforce).toHaveBeenCalledWith(teamId, userId)
  })

  it("tests the tenant connection through the safe provider boundary", async () => {
    const response = await testConnection(request(`/api/teams/${teamId}/integrations/salesforce/test`, {
      method: "POST",
    }), context)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      limits: { remaining: 100, maximum: 1_000 },
    })
  })

  it("binds callback completion to the state tenant rather than active-team state", async () => {
    const response = await callback(request(
      `/api/integrations/salesforce/callback?state=${"s".repeat(43)}&code=authorization-code`,
    ))

    expect(response.status).toBe(303)
    expect(mocks.consumeState).toHaveBeenCalledWith("s".repeat(43), userId)
    expect(mocks.getMembership).toHaveBeenCalledWith(userId, teamId)
    expect(mocks.complete).toHaveBeenCalledWith(oauthState, "authorization-code")
    expect(mocks.returnUrl).toHaveBeenCalledWith("/dashboard/forms", "connected")
    expect(response.headers.get("location")).toContain("status=connected")
    expect(response.headers.get("location")).toContain("app.screeem.example")
    expect(response.headers.get("Cache-Control")).toBe("no-store")
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer")
  })

  it("classifies malformed and superseded callbacks at the API boundary", async () => {
    const malformed = await callback(request(
      "/api/integrations/salesforce/callback?state=short&code=authorization-code",
    ))
    expect(malformed.status).toBe(400)
    expect(mocks.createService).not.toHaveBeenCalled()

    const malformedProviderError = await callback(request(
      `/api/integrations/salesforce/callback?state=${"m".repeat(43)}` +
      "&code=authorization-code&error=invalid%20scope",
    ))
    expect(malformedProviderError.status).toBe(400)
    expect(mocks.createService).not.toHaveBeenCalled()

    mocks.complete.mockRejectedValueOnce(new IntegrationAuthorizationAttemptError("superseded"))
    const superseded = await callback(request(
      `/api/integrations/salesforce/callback?state=${"z".repeat(43)}&code=authorization-code`,
    ))
    expect(superseded.status).toBe(409)
  })

  it("rejects replayed state and role loss before token exchange", async () => {
    mocks.consumeState.mockResolvedValueOnce(null)
    const replay = await callback(request(
      `/api/integrations/salesforce/callback?state=${"r".repeat(43)}&code=authorization-code`,
    ))
    expect(replay.status).toBe(400)
    expect(mocks.complete).not.toHaveBeenCalled()

    mocks.consumeState.mockResolvedValueOnce(oauthState)
    mocks.canManage.mockReturnValueOnce(false)
    const roleLoss = await callback(request(
      `/api/integrations/salesforce/callback?state=${"f".repeat(43)}&code=authorization-code`,
    ))
    expect(roleLoss.status).toBe(403)
    expect(mocks.complete).not.toHaveBeenCalled()
  })

  it("consumes a denied authorization and redirects without echoing provider details", async () => {
    const denied = await callback(request(
      `/api/integrations/salesforce/callback?state=${"d".repeat(43)}` +
      "&error=access_denied&error_description=private-provider-detail",
    ))
    expect(denied.status).toBe(303)
    expect(mocks.consumeState).toHaveBeenCalledWith("d".repeat(43), userId)
    expect(mocks.complete).not.toHaveBeenCalled()
    expect(mocks.returnUrl).toHaveBeenCalledWith("/dashboard/forms", "error")
    expect(denied.headers.get("location")).not.toContain("private-provider-detail")

    mocks.consumeState.mockResolvedValueOnce(null)
    const replay = await callback(request(
      `/api/integrations/salesforce/callback?state=${"d".repeat(43)}&error=access_denied`,
    ))
    expect(replay.status).toBe(400)

    mocks.consumeState.mockResolvedValueOnce(oauthState)
    const unavailable = await callback(request(
      `/api/integrations/salesforce/callback?state=${"u".repeat(43)}` +
      "&error=temporarily_unavailable&error_description=private-provider-detail",
    ))
    expect(unavailable.status).toBe(303)
    expect(mocks.consumeState).toHaveBeenLastCalledWith("u".repeat(43), userId)
    expect(mocks.complete).not.toHaveBeenCalled()
    expect(unavailable.headers.get("location")).not.toContain("private-provider-detail")
  })
})

function request(path: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(`http://localhost${path}`, init)
}
