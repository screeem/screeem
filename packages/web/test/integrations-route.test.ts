import { NextRequest, NextResponse } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  authorizeTeam: vi.fn(),
  list: vi.fn(),
  get: vi.fn(),
  getControl: vi.fn(),
  listPresent: vi.fn(),
  summarize: vi.fn(),
  createConnectionStore: vi.fn(),
  createControlStore: vi.fn(),
  createCredentialStore: vi.fn(),
}))

vi.mock("server-only", () => ({}))
vi.mock("@/lib/integrations/contract", async () => import("../src/lib/integrations/contract"))
vi.mock("@/lib/integrations/stores", async () => import("../src/lib/integrations/stores"))
vi.mock("@/lib/teams/authorization", () => ({ authorizeTeam: mocks.authorizeTeam }))
vi.mock("@/lib/integrations/server", () => ({
  createIntegrationConnectionStore: mocks.createConnectionStore,
  createIntegrationTeamControlStore: mocks.createControlStore,
  createIntegrationCredentialStore: mocks.createCredentialStore,
  productionIntegrationProviderRegistry: { summarize: mocks.summarize },
}))

import { GET as listIntegrations } from "../src/app/api/teams/[teamId]/integrations/route"
import { GET as integrationStatus } from "../src/app/api/teams/[teamId]/integrations/[connectionId]/status/route"
import { IntegrationConnectionNotFoundError } from "../src/lib/integrations/stores"

const teamId = "72000000-0000-0000-0000-000000000001"
const otherTeamId = "72000000-0000-0000-0000-000000000002"
const connectionId = "71000000-0000-0000-0000-000000000001"
const userId = "73000000-0000-0000-0000-000000000001"
const listContext = { params: Promise.resolve({ teamId }) }
const statusContext = { params: Promise.resolve({ teamId, connectionId }) }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.authorizeTeam.mockResolvedValue({ error: null })
  mocks.createConnectionStore.mockReturnValue({ list: mocks.list, get: mocks.get })
  mocks.createControlStore.mockReturnValue({ get: mocks.getControl })
  mocks.createCredentialStore.mockReturnValue({ listPresentConnectionIds: mocks.listPresent })
  mocks.list.mockResolvedValue([connection()])
  mocks.get.mockResolvedValue(connection())
  mocks.getControl.mockResolvedValue(control())
  mocks.listPresent.mockResolvedValue(new Set([connectionId]))
  mocks.summarize.mockReturnValue(summary())
})

describe("team integrations API", () => {
  it("returns safe summaries and checks credential presence without loading secrets", async () => {
    const response = await listIntegrations(request("integrations"), listContext)

    expect(response.status).toBe(200)
    expect(response.headers.get("Cache-Control")).toBe("no-store")
    expect(mocks.listPresent).toHaveBeenCalledWith(teamId, [connectionId])
    const body = await response.json()
    expect(body).toEqual({ integrations: [summary()] })
    expect(JSON.stringify(body)).not.toMatch(/credential|cipher|keyId|teamId|createdBy/i)
  })

  it("returns one tenant-scoped status without loading credential material", async () => {
    const response = await integrationStatus(request(`integrations/${connectionId}/status`), statusContext)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ integration: summary() })
    expect(mocks.get).toHaveBeenCalledWith(teamId, connectionId)
    expect(mocks.listPresent).toHaveBeenCalledWith(teamId, [connectionId])
  })

  it("returns 404 for a connection outside the authorized team", async () => {
    mocks.get.mockRejectedValue(new IntegrationConnectionNotFoundError(connectionId as never))

    const response = await integrationStatus(request(`integrations/${connectionId}/status`), statusContext)

    expect(response.status).toBe(404)
  })

  it("returns 400 for a malformed connection identifier before store access", async () => {
    const response = await integrationStatus(
      request("integrations/not-a-uuid/status"),
      { params: Promise.resolve({ teamId, connectionId: "not-a-uuid" }) },
    )

    expect(response.status).toBe(400)
    expect(mocks.createConnectionStore).not.toHaveBeenCalled()
  })

  it("rejects malformed cross-tenant store data", async () => {
    mocks.list.mockResolvedValue([{ ...connection(), teamId: otherTeamId }])

    const response = await listIntegrations(request("integrations"), listContext)

    expect(response.status).toBe(500)
    expect(mocks.listPresent).not.toHaveBeenCalled()
  })

  it("rejects an impossible stored connection state at the API boundary", async () => {
    mocks.list.mockResolvedValue([{ ...connection(), enabled: false, disabledAt: null }])

    const response = await listIntegrations(request("integrations"), listContext)

    expect(response.status).toBe(500)
    expect(mocks.listPresent).not.toHaveBeenCalled()
  })

  it("returns an authorization denial before constructing stores", async () => {
    mocks.authorizeTeam.mockResolvedValue({
      error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    })

    const response = await listIntegrations(request("integrations"), listContext)

    expect(response.status).toBe(403)
    expect(mocks.createConnectionStore).not.toHaveBeenCalled()
    expect(mocks.createCredentialStore).not.toHaveBeenCalled()
  })

  it("does not expose storage failures", async () => {
    mocks.list.mockRejectedValue(new Error("sealed_payload contained a database secret"))

    const response = await listIntegrations(request("integrations"), listContext)

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: "Unable to load integrations" })
  })
})

function request(path: string) {
  return new NextRequest(`http://localhost/api/teams/${teamId}/${path}`)
}

function connection() {
  return {
    id: connectionId,
    teamId,
    provider: "example",
    revision: 1,
    status: "connected",
    health: "healthy",
    enabled: true,
    displayName: "Example",
    externalAccountId: "external-one",
    lastErrorCode: null,
    lastCheckedAt: "2026-08-14T10:00:00.000Z",
    createdBy: userId,
    createdAt: "2026-08-14T09:00:00.000Z",
    updatedBy: userId,
    updatedAt: "2026-08-14T10:00:00.000Z",
    disabledBy: null,
    disabledAt: null,
    disconnectedBy: null,
    disconnectedAt: null,
  }
}

function control() {
  return { teamId, revision: null, enabled: true, disabledBy: null, disabledAt: null, updatedBy: null, updatedAt: null }
}

function summary() {
  return {
    id: connectionId,
    provider: "example",
    revision: 1,
    providerDisplayName: "Example",
    status: "connected",
    health: "healthy",
    enabled: true,
    availability: "available",
    displayName: "Example",
    externalAccountId: "external-one",
    lastErrorCode: null,
    lastCheckedAt: "2026-08-14T10:00:00.000Z",
    createdAt: "2026-08-14T09:00:00.000Z",
    updatedAt: "2026-08-14T10:00:00.000Z",
  }
}
