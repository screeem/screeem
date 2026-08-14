import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { snapshotIntegrationIdentifier, snapshotIntegrationProviderName } from "../src/lib/integrations/contract"
import {
  MemoryIntegrationConnectionStore,
  MemoryIntegrationCredentialStore,
  MemoryIntegrationTeamControlStore,
} from "../src/lib/integrations/memory-stores"
import {
  IntegrationConnectionNotFoundError,
  IntegrationConnectionRevisionConflictError,
  IntegrationCredentialRevisionConflictError,
  IntegrationTeamControlRevisionConflictError,
  snapshotSealedIntegrationCredential,
} from "../src/lib/integrations/stores"

const now = "2026-08-14T10:00:00.000Z"
const teamOne = snapshotIntegrationIdentifier("72000000-0000-0000-0000-000000000001")
const teamTwo = snapshotIntegrationIdentifier("72000000-0000-0000-0000-000000000002")
const userOne = snapshotIntegrationIdentifier("73000000-0000-0000-0000-000000000001")
const userTwo = snapshotIntegrationIdentifier("73000000-0000-0000-0000-000000000002")
const connectionOne = snapshotIntegrationIdentifier("71000000-0000-0000-0000-000000000001")
const connectionTwo = snapshotIntegrationIdentifier("71000000-0000-0000-0000-000000000002")
const provider = snapshotIntegrationProviderName("example")

describe("integration stores", () => {
  let connections: MemoryIntegrationConnectionStore
  let credentials: MemoryIntegrationCredentialStore
  let controls: MemoryIntegrationTeamControlStore

  beforeEach(() => {
    connections = new MemoryIntegrationConnectionStore()
    credentials = new MemoryIntegrationCredentialStore(connections)
    controls = new MemoryIntegrationTeamControlStore()
  })

  it("scopes connection reads and providers by team", async () => {
    const first = await createConnection(connections, teamOne, connectionOne)
    const second = await createConnection(connections, teamTwo, connectionTwo)

    await expect(connections.get(teamTwo, first.id)).rejects.toBeInstanceOf(
      IntegrationConnectionNotFoundError,
    )
    await expect(connections.getByProvider(teamOne, provider)).resolves.toEqual(first)
    await expect(connections.getByProvider(teamTwo, provider)).resolves.toEqual(second)
  })

  it("fences independent auth, health, and operational updates", async () => {
    const original = await createConnection(connections, teamOne, connectionOne)
    const health = await connections.recordHealth(teamOne, original.id, original.revision, {
      health: "degraded",
      lastErrorCode: "provider_unavailable",
      checkedAt: now,
      actorId: userTwo,
      updatedAt: now,
    })
    const disabled = await connections.setEnabled(
      teamOne, health.id, health.revision, false, userTwo, now,
    )
    const control = await controls.setEnabled(teamOne, null, false, userTwo, now)

    expect(disabled).toMatchObject({ enabled: false, status: "connected", health: "degraded" })
    expect(control).toMatchObject({ enabled: false, disabledBy: userTwo })
    await expect(
      connections.updateAuthState(teamOne, disabled.id, original.revision, {
        status: "disconnected",
        displayName: null,
        externalAccountId: null,
        actorId: userTwo,
        updatedAt: now,
      }),
    ).rejects.toBeInstanceOf(IntegrationConnectionRevisionConflictError)
  })

  it("fences credential replacement, presence, deletion, and tenant reads", async () => {
    const connection = await createConnection(connections, teamOne, connectionOne)
    const first = await credentials.compareAndSet(teamOne, connection.id, null, sealed("one"), now)
    const second = await credentials.compareAndSet(
      teamOne, connection.id, first.revision, sealed("two"), now,
    )

    expect(second.revision).toBe(2)
    expect(await credentials.listPresentConnectionIds(teamOne, [connection.id])).toEqual(
      new Set([connection.id]),
    )
    await expect(credentials.load(teamTwo, connection.id)).resolves.toBeNull()
    await expect(
      credentials.delete(teamOne, connection.id, first.revision),
    ).rejects.toBeInstanceOf(IntegrationCredentialRevisionConflictError)
    await credentials.delete(teamOne, connection.id, second.revision)
    await expect(credentials.load(teamOne, connection.id)).resolves.toBeNull()
  })

  it("rejects identifiers that cannot be stored by Postgres", async () => {
    await expect(
      connections.create("team-one" as never, {
        id: connectionOne,
        provider,
        status: "connected",
        actorId: userOne,
        createdAt: now,
      }),
    ).rejects.toThrow("Invalid integration identifier")
  })

  it("lets only one concurrent create and one concurrent revision update commit", async () => {
    const creates = await Promise.allSettled([
      createConnection(connections, teamOne, connectionOne),
      createConnection(connections, teamOne, connectionTwo),
    ])
    expect(creates.filter((result) => result.status === "fulfilled")).toHaveLength(1)
    expect(creates.filter((result) => result.status === "rejected")).toHaveLength(1)

    const connection = await connections.getByProvider(teamOne, provider)
    expect(connection).not.toBeNull()
    const updates = await Promise.allSettled([
      connections.setEnabled(teamOne, connection!.id, 1, false, userTwo, now),
      connections.recordHealth(teamOne, connection!.id, 1, {
        health: "degraded",
        lastErrorCode: "provider_unavailable",
        checkedAt: now,
        actorId: userTwo,
        updatedAt: now,
      }),
    ])
    expect(updates.filter((result) => result.status === "fulfilled")).toHaveLength(1)
    expect(updates.filter((result) => result.status === "rejected")).toHaveLength(1)
  })

  it("fences concurrent team kill-switch updates", async () => {
    const disabled = await controls.setEnabled(teamOne, null, false, userOne, now)
    const updates = await Promise.allSettled([
      controls.setEnabled(teamOne, disabled.revision, true, userOne, now),
      controls.setEnabled(teamOne, disabled.revision, false, userTwo, now),
    ])

    expect(updates.filter((result) => result.status === "fulfilled")).toHaveLength(1)
    expect(updates.filter((result) => result.status === "rejected")).toHaveLength(1)
    await expect(
      controls.setEnabled(teamOne, disabled.revision, true, userOne, now),
    ).rejects.toBeInstanceOf(IntegrationTeamControlRevisionConflictError)
  })

  it("only marks a currently connected revision for reauthorization", async () => {
    const connection = await createConnection(connections, teamOne, connectionOne)
    const marked = await connections.markReauthorizationRequired(
      teamOne,
      connection.id,
      connection.revision,
      "2026-08-14T10:01:00.000Z",
    )
    expect(marked).toMatchObject({
      status: "reauthorization_required",
      health: "degraded",
      lastErrorCode: "authentication_failed",
    })
    await expect(connections.markReauthorizationRequired(
      teamOne,
      connection.id,
      marked.revision,
      "2026-08-14T10:02:00.000Z",
    )).rejects.toBeInstanceOf(IntegrationConnectionRevisionConflictError)
  })
})

function createConnection(
  store: MemoryIntegrationConnectionStore,
  teamId: typeof teamOne,
  id: typeof connectionOne,
) {
  return store.create(teamId, {
    id,
    provider,
    status: "connected",
    health: "healthy",
    displayName: "Example workspace",
    actorId: userOne,
    createdAt: now,
  })
}

function sealed(value: string) {
  return snapshotSealedIntegrationCredential({ keyId: "key-v1", sealed: `v1.${value}` })
}
