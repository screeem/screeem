import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { AesGcmIntegrationCredentialCipher } from "../src/lib/integrations/credential-cipher"
import { snapshotIntegrationIdentifier } from "../src/lib/integrations/contract"
import { IntegrationAuthorizationAttemptError } from "../src/lib/integrations/provisioning-store"
import {
  MemoryIntegrationConnectionStore,
  MemoryIntegrationCredentialStore,
  MemoryIntegrationExecutionStore,
  MemoryIntegrationTeamControlStore,
} from "../src/lib/integrations/memory-stores"
import { FakeSalesforceClient } from "../src/lib/integrations/salesforce/client"
import {
  salesforceProviderName,
  snapshotSalesforceAccessCredential,
  snapshotSalesforceCredential,
} from "../src/lib/integrations/salesforce/contract"
import { SalesforceConnectionService } from "../src/lib/integrations/salesforce/service"
import { MemorySalesforceOAuthStateStore } from "../src/lib/integrations/salesforce/stores"

const now = "2026-08-14T10:00:00.000Z"
const teamId = snapshotIntegrationIdentifier("72000000-0000-0000-0000-000000000001")
const userId = snapshotIntegrationIdentifier("73000000-0000-0000-0000-000000000001")
const connectionId = snapshotIntegrationIdentifier("71000000-0000-0000-0000-000000000001")

describe("Salesforce connection service", () => {
  it("plans, consumes, identifies, and commits one tenant-bound OAuth attempt", async () => {
    const dependencies = await fixture()
    const service = new SalesforceConnectionService(dependencies)
    const started = await service.begin(teamId, userId, "/dashboard/forms")
    const stateToken = new URL(started.authorizationUrl).searchParams.get("state")!
    const state = await service.consumeState(stateToken, userId)

    expect(state).not.toBeNull()
    await service.complete(state!, "authorization-code")

    expect(dependencies.identify).toHaveBeenCalledOnce()
    expect(dependencies.provisioning.connect).toHaveBeenCalledWith(
      teamId,
      expect.objectContaining({
        connectionId,
        authorizationAttemptId: state!.attemptId,
        provider: salesforceProviderName,
        actorId: userId,
      }),
    )
    const input = vi.mocked(dependencies.provisioning.connect).mock.calls[0]![1]
    await expect(dependencies.cipher.open(
      { teamId, connectionId, provider: salesforceProviderName },
      input.credential,
    )).resolves.toMatchObject({ generation: state!.attemptId })
  })

  it("invalidates an older callback when a newer OAuth attempt starts", async () => {
    const dependencies = await fixture()
    const service = new SalesforceConnectionService(dependencies)
    const first = await service.begin(teamId, userId)
    const second = await service.begin(teamId, userId)

    await expect(service.consumeState(
      new URL(first.authorizationUrl).searchParams.get("state")!,
      userId,
    )).resolves.toBeNull()
    await expect(service.consumeState(
      new URL(second.authorizationUrl).searchParams.get("state")!,
      userId,
    )).resolves.not.toBeNull()
  })

  it("uses the offline fake for connection health and records only safe status", async () => {
    const dependencies = await fixture()
    const client = new FakeSalesforceClient()
    dependencies.resolveClient.mockResolvedValue(client)
    const service = new SalesforceConnectionService(dependencies)

    await expect(service.test(teamId, userId)).resolves.toEqual({
      remaining: 10_000,
      maximum: 15_000,
    })
    expect(dependencies.provisioning.recordHealth).toHaveBeenCalledWith(
      teamId,
      connectionId,
      1,
      expect.objectContaining({ health: "healthy", lastErrorCode: null }),
    )
  })

  it("revokes a newly issued token when a known provisioning rejection rolls back", async () => {
    const dependencies = await fixture()
    dependencies.provisioning.connect.mockRejectedValueOnce(
      new IntegrationAuthorizationAttemptError("superseded"),
    )
    const service = new SalesforceConnectionService(dependencies)
    const started = await service.begin(teamId, userId)
    const state = await service.consumeState(
      new URL(started.authorizationUrl).searchParams.get("state")!,
      userId,
    )

    await expect(service.complete(state!, "authorization-code")).rejects.toBeInstanceOf(
      IntegrationAuthorizationAttemptError,
    )
    expect(dependencies.oauth.revoke).toHaveBeenCalledOnce()
    expect(dependencies.oauth.revoke).toHaveBeenCalledWith("refresh-token")
  })

  it("revokes the replaced token only after reconnect commits", async () => {
    const dependencies = await fixture()
    const previous = await dependencies.cipher.seal(
      { teamId, connectionId, provider: salesforceProviderName },
      snapshotSalesforceCredential({
        ...snapshotSalesforceAccessCredential({
          accessToken: "old-access",
          refreshToken: "old-refresh",
          instanceUrl: "https://acme.my.salesforce.com",
          identityUrl: "https://login.salesforce.com/id/00D000000000001/005000000000001",
          issuedAt: now,
        }),
        generation: "74000000-0000-0000-0000-000000000099",
      }),
    )
    dependencies.provisioning.connect.mockResolvedValueOnce({
      connection: await dependencies.connections.get(teamId, connectionId),
      previousCredential: {
        teamId,
        connectionId,
        credential: previous,
        revision: 1,
        updatedAt: now,
      },
    })
    const service = new SalesforceConnectionService(dependencies)
    const started = await service.begin(teamId, userId)
    const state = await service.consumeState(
      new URL(started.authorizationUrl).searchParams.get("state")!,
      userId,
    )

    await service.complete(state!, "authorization-code")

    expect(dependencies.oauth.revoke).toHaveBeenCalledOnce()
    expect(dependencies.oauth.revoke).toHaveBeenCalledWith("old-refresh")
  })

  it("reconciles an acknowledged-late commit without revoking its token", async () => {
    const dependencies = await fixture()
    dependencies.provisioning.connect.mockImplementationOnce(async (_teamId, input) => {
      await dependencies.credentials.compareAndSet(
        teamId,
        connectionId,
        null,
        input.credential,
        input.connectedAt,
      )
      throw new Error("connection lost after commit")
    })
    const service = new SalesforceConnectionService(dependencies)
    const started = await service.begin(teamId, userId)
    const state = await service.consumeState(
      new URL(started.authorizationUrl).searchParams.get("state")!,
      userId,
    )

    await expect(service.complete(state!, "authorization-code")).resolves.toMatchObject({
      id: connectionId,
    })
    expect(dependencies.oauth.revoke).not.toHaveBeenCalled()
  })

  it("does not report an ambiguous commit as connected after a concurrent disconnect", async () => {
    const dependencies = await fixture()
    dependencies.provisioning.connect.mockImplementationOnce(async (_teamId, input) => {
      await dependencies.credentials.compareAndSet(
        teamId,
        connectionId,
        null,
        input.credential,
        input.connectedAt,
      )
      throw new Error("connection lost after commit")
    })
    let releaseLoad!: () => void
    let loadStarted!: () => void
    const waiting = new Promise<void>((resolve) => { releaseLoad = resolve })
    const startedLoading = new Promise<void>((resolve) => { loadStarted = resolve })
    const originalLoad = dependencies.execution.load.bind(dependencies.execution)
    vi.spyOn(dependencies.execution, "load").mockImplementation(async (...input) => {
      loadStarted()
      await waiting
      return originalLoad(...input)
    })
    const service = new SalesforceConnectionService(dependencies)
    const started = await service.begin(teamId, userId)
    const state = await service.consumeState(
      new URL(started.authorizationUrl).searchParams.get("state")!,
      userId,
    )

    const completion = service.complete(state!, "authorization-code")
    await startedLoading
    const connection = await dependencies.connections.get(teamId, connectionId)
    await dependencies.connections.updateAuthState(teamId, connectionId, connection.revision, {
      status: "disconnected",
      displayName: connection.displayName,
      externalAccountId: connection.externalAccountId,
      actorId: userId,
      updatedAt: "2026-08-14T10:01:00.000Z",
    })
    releaseLoad()

    await expect(completion).rejects.toThrow("connection lost after commit")
    expect(dependencies.oauth.revoke).toHaveBeenCalledOnce()
    expect(dependencies.oauth.revoke).toHaveBeenCalledWith("refresh-token")
  })

  it("revokes a new token when an ambiguous reconnect leaves the connection disconnected", async () => {
    const dependencies = await fixture()
    const connection = await dependencies.connections.get(teamId, connectionId)
    await dependencies.connections.updateAuthState(teamId, connectionId, connection.revision, {
      status: "disconnected",
      displayName: connection.displayName,
      externalAccountId: connection.externalAccountId,
      actorId: userId,
      updatedAt: "2026-08-14T10:01:00.000Z",
    })
    dependencies.provisioning.connect.mockRejectedValueOnce(new Error("database unavailable"))
    const service = new SalesforceConnectionService(dependencies)
    const started = await service.begin(teamId, userId)
    const state = await service.consumeState(
      new URL(started.authorizationUrl).searchParams.get("state")!,
      userId,
    )

    await expect(service.complete(state!, "authorization-code")).rejects.toThrow(
      "database unavailable",
    )
    expect(dependencies.oauth.revoke).toHaveBeenCalledOnce()
    expect(dependencies.oauth.revoke).toHaveBeenCalledWith("refresh-token")
  })
})

async function fixture() {
  const cipher = await AesGcmIntegrationCredentialCipher.create(
    "test-key",
    Buffer.alloc(32, 4).toString("base64url"),
  )
  const connections = new MemoryIntegrationConnectionStore()
  const credentials = new MemoryIntegrationCredentialStore(connections)
  const controls = new MemoryIntegrationTeamControlStore()
  const execution = new MemoryIntegrationExecutionStore(connections, controls, credentials)
  const connection = await connections.create(teamId, {
    id: connectionId,
    provider: salesforceProviderName,
    status: "connected",
    health: "healthy",
    displayName: "Salesforce User",
    externalAccountId: "00D000000000001",
    lastCheckedAt: now,
    actorId: userId,
    createdAt: now,
  })
  const access = snapshotSalesforceAccessCredential({
    accessToken: "access-token",
    refreshToken: "refresh-token",
    instanceUrl: "https://acme.my.salesforce.com",
    identityUrl: "https://login.salesforce.com/id/00D000000000001/005000000000001",
    issuedAt: now,
  })
  const states = new MemorySalesforceOAuthStateStore(() => new Date(now))
  const provisioning = {
    connect: vi.fn().mockResolvedValue({ connection, previousCredential: null }),
    disconnect: vi.fn(),
    recordHealth: vi.fn().mockResolvedValue(connection),
  }
  const oauth = {
    authorizationUrl: vi.fn((state: string) => `https://login.salesforce.com/authorize?state=${state}`),
    exchange: vi.fn().mockResolvedValue(access),
    refresh: vi.fn().mockResolvedValue(access),
    revoke: vi.fn().mockResolvedValue(undefined),
  }
  return {
    oauth,
    states,
    cipher,
    provisioning,
    connections,
    credentials,
    execution,
    identify: vi.fn().mockResolvedValue({
      organizationId: "00D000000000001",
      userId: "005000000000001",
      displayName: "Salesforce User",
      username: "salesforce@example.invalid",
    }),
    resolveClient: vi.fn().mockResolvedValue(new FakeSalesforceClient()),
  }
}
