import { NextRequest } from "next/server"
import { InvalidSocialConfigurationError } from "@screeem/integrations/social"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  authorizeTeam: vi.fn(),
  createService: vi.fn(),
  createReturnUrl: vi.fn(),
  begin: vi.fn(),
  consumeState: vi.fn(),
  complete: vi.fn(),
  disconnect: vi.fn(),
  disconnectSocialConnection: vi.fn(),
  createClient: vi.fn(),
  getUser: vi.fn(),
  getMembership: vi.fn(),
  canManage: vi.fn(),
}))

vi.mock("server-only", () => ({}))
vi.mock("@/lib/integrations/api", async () => import("../src/lib/integrations/api"))
vi.mock("@/lib/integrations/contract", async () => import("../src/lib/integrations/contract"))
vi.mock("@/lib/integrations/social/contract", async () => import("../src/lib/integrations/social/contract"))
vi.mock("@/lib/integrations/social/service", async () => import("../src/lib/integrations/social/service"))
vi.mock("@/lib/integrations/provisioning-store", async () => import("../src/lib/integrations/provisioning-store"))
vi.mock("@/lib/teams/authorization", () => ({ authorizeTeam: mocks.authorizeTeam }))
vi.mock("@/lib/integrations/social/server", () => ({
  createSocialConnectionService: mocks.createService,
  createSocialReturnUrl: mocks.createReturnUrl,
  disconnectSocialConnection: mocks.disconnectSocialConnection,
}))
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }))
vi.mock("@/lib/teams/server", () => ({
  getMembership: mocks.getMembership,
  canManage: mocks.canManage,
}))

import { GET as callback } from "../src/app/api/integrations/[provider]/callback/route"
import { POST as connect } from "../src/app/api/teams/[teamId]/integrations/[provider]/connect/route"
import { DELETE as disconnect } from "../src/app/api/teams/[teamId]/integrations/[provider]/route"
import { SocialAccountSwitchError } from "../src/lib/integrations/social/service"
import {
  IntegrationDisconnectInProgressError,
  IntegrationExternalAccountConflictError,
} from "../src/lib/integrations/provisioning-store"
import { snapshotIntegrationProviderName } from "../src/lib/integrations/contract"

const teamId = "72000000-0000-0000-0000-000000000001"
const userId = "73000000-0000-0000-0000-000000000001"
const stateToken = "s".repeat(43)
const teamContext = { params: Promise.resolve({ teamId, provider: "instagram" }) }
const callbackContext = { params: Promise.resolve({ provider: "instagram" }) }
const state = {
  stateHash: "h".repeat(43),
  provider: "instagram",
  teamId,
  attemptId: "74000000-0000-0000-0000-000000000001",
  userId,
  redirectUri: "https://app.screeem.com/api/integrations/instagram/callback",
  returnPath: "/dashboard/integrations",
  createdAt: "2026-08-31T12:00:00.000Z",
  expiresAt: "2026-08-31T12:10:00.000Z",
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.authorizeTeam.mockResolvedValue({ error: null, user: { id: userId } })
  mocks.createService.mockResolvedValue({
    begin: mocks.begin,
    consumeState: mocks.consumeState,
    complete: mocks.complete,
    disconnect: mocks.disconnect,
  })
  mocks.begin.mockResolvedValue({
    authorizationUrl: `https://www.instagram.com/oauth/authorize?state=${stateToken}`,
  })
  mocks.consumeState.mockResolvedValue(state)
  mocks.disconnect.mockResolvedValue({ status: "disconnected" })
  mocks.disconnectSocialConnection.mockResolvedValue({
    connection: { status: "disconnected" },
    providerAccessRemoved: true,
  })
  mocks.createClient.mockResolvedValue({ auth: { getUser: mocks.getUser } })
  mocks.getUser.mockResolvedValue({ data: { user: { id: userId } } })
  mocks.getMembership.mockResolvedValue({ role: "owner" })
  mocks.canManage.mockReturnValue(true)
  mocks.createReturnUrl.mockImplementation((
    path: string,
    provider: string,
    status: string,
    reason?: string,
  ) => {
    const url = new URL(path, "https://app.screeem.com")
    url.searchParams.set("integration", provider)
    url.searchParams.set("status", status)
    if (reason) url.searchParams.set("reason", reason)
    return url
  })
})

describe("social integration API", () => {
  it("starts Instagram authorization only after manager authorization", async () => {
    const response = await connect(request(`/api/teams/${teamId}/integrations/instagram/connect`, {
      method: "POST",
      body: JSON.stringify({ returnPath: "/dashboard/integrations" }),
    }), teamContext)

    expect(response.status).toBe(201)
    expect(mocks.authorizeTeam).toHaveBeenCalledWith(teamId, true, expect.any(AbortSignal))
    expect(mocks.begin).toHaveBeenCalledWith(teamId, userId, "/dashboard/integrations", false)
  })

  it("rejects unsupported providers before constructing a service", async () => {
    const response = await connect(
      request(`/api/teams/${teamId}/integrations/youtube/connect`, { method: "POST", body: "{}" }),
      { params: Promise.resolve({ teamId, provider: "youtube" }) },
    )

    expect(response.status).toBe(404)
    expect(mocks.createService).not.toHaveBeenCalled()
  })

  it("rejects duplicate callback authority parameters", async () => {
    const response = await callback(
      request(`/api/integrations/instagram/callback?state=${stateToken}&state=${stateToken}&code=code`),
      callbackContext,
    )

    expect(response.status).toBe(400)
    expect(mocks.createService).not.toHaveBeenCalled()
  })

  it("binds a successful callback to the initiating user and consumed state", async () => {
    const response = await callback(
      request(`/api/integrations/instagram/callback?state=${stateToken}&code=provider-code`),
      callbackContext,
    )

    expect(response.status).toBe(303)
    expect(response.headers.get("location")).toBe(
      "https://app.screeem.com/dashboard/integrations?integration=instagram&status=connected",
    )
    expect(mocks.consumeState).toHaveBeenCalledWith(stateToken, userId)
    expect(mocks.complete).toHaveBeenCalledWith(state, stateToken, "provider-code")
  })

  it("consumes denied authorization state before returning to the dashboard", async () => {
    const response = await callback(
      request(`/api/integrations/instagram/callback?state=${stateToken}&error=access_denied`),
      callbackContext,
    )

    expect(response.status).toBe(303)
    expect(mocks.consumeState).toHaveBeenCalledWith(stateToken, userId)
    expect(mocks.complete).not.toHaveBeenCalled()
  })

  it("reports failed provider revocation without claiming disconnect completed", async () => {
    mocks.disconnectSocialConnection.mockRejectedValueOnce(new Error("provider unavailable"))

    const response = await disconnect(
      request(`/api/teams/${teamId}/integrations/instagram`, { method: "DELETE" }),
      teamContext,
    )

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({ error: "Unable to disconnect Instagram" })
  })

  it("reports whether provider access was removed during disconnect", async () => {
    const response = await disconnect(
      request(`/api/teams/${teamId}/integrations/instagram`, { method: "DELETE" }),
      teamContext,
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      disconnected: true,
      providerAccessRemoved: true,
    })
  })

  it("returns to the dashboard after a consumed callback fails", async () => {
    mocks.complete.mockRejectedValueOnce(new Error("database unavailable"))

    const response = await callback(
      request(`/api/integrations/instagram/callback?state=${stateToken}&code=provider-code`),
      callbackContext,
    )

    expect(response.status).toBe(303)
    expect(response.headers.get("location")).toBe(
      "https://app.screeem.com/dashboard/integrations?integration=instagram&status=error",
    )
  })

  it("returns an actionable reason when a different account is already connected", async () => {
    mocks.complete.mockRejectedValueOnce(new SocialAccountSwitchError("instagram"))

    const response = await callback(
      request(`/api/integrations/instagram/callback?state=${stateToken}&code=provider-code`),
      callbackContext,
    )

    expect(response.headers.get("location")).toBe(
      "https://app.screeem.com/dashboard/integrations?integration=instagram&status=error&reason=account_switch",
    )
  })

  it.each([
    [
      new IntegrationExternalAccountConflictError(
        snapshotIntegrationProviderName("instagram"),
        "global",
      ),
      "account_in_use",
    ],
    [
      new IntegrationDisconnectInProgressError(snapshotIntegrationProviderName("instagram")),
      "disconnecting",
    ],
    [
      new InvalidSocialConfigurationError({ provider: "instagram", reason: "missing client" }),
      "configuration",
    ],
  ] as const)("returns the allowlisted callback reason for %s", async (error, reason) => {
    mocks.complete.mockRejectedValueOnce(error)

    const response = await callback(
      request(`/api/integrations/instagram/callback?state=${stateToken}&code=provider-code`),
      callbackContext,
    )

    expect(response.headers.get("location")).toContain(`reason=${reason}`)
  })

  it("returns callback-time role loss as an allowlisted forbidden reason", async () => {
    mocks.canManage.mockReturnValueOnce(false)

    const response = await callback(
      request(`/api/integrations/instagram/callback?state=${stateToken}&code=provider-code`),
      callbackContext,
    )

    expect(response.headers.get("location")).toContain("reason=forbidden")
    expect(mocks.complete).not.toHaveBeenCalled()
  })
})

function request(path: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(`https://app.screeem.com${path}`, init)
}
