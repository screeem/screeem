import postgres from "postgres"
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  PostgresIntegrationConnectionStore,
  PostgresIntegrationCredentialStore,
  PostgresIntegrationTeamControlStore,
} from "../src/lib/integrations/postgres-store"
import {
  snapshotIntegrationIdentifier,
  snapshotIntegrationProviderName,
  type IntegrationIdentifier,
} from "../src/lib/integrations/contract"
import {
  IntegrationConnectionNotFoundError,
  IntegrationConnectionRevisionConflictError,
  IntegrationCredentialRevisionConflictError,
  IntegrationTeamControlRevisionConflictError,
  snapshotSealedIntegrationCredential,
} from "../src/lib/integrations/stores"

vi.mock("server-only", () => ({}))

const suite = process.env.FORM_PERSISTENCE_DB_TESTS === "1" ? describe : describe.skip

suite("Postgres integration stores", () => {
  const database = postgres(process.env.DATABASE_URL ?? "postgresql://127.0.0.1:1/unavailable", {
    max: 2,
    prepare: false,
  })
  const connections = new PostgresIntegrationConnectionStore(database)
  const credentials = new PostgresIntegrationCredentialStore(database, connections)
  const controls = new PostgresIntegrationTeamControlStore(database)
  let fixture: ReturnType<typeof identifiers>

  beforeEach(async () => {
    fixture = identifiers()
    await database`
      INSERT INTO auth.users (
        id, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
      ) VALUES
        (${fixture.userOne}, ${`${fixture.userOne}@example.com`}, '{}'::jsonb, '{}'::jsonb, now(), now()),
        (${fixture.userTwo}, ${`${fixture.userTwo}@example.com`}, '{}'::jsonb, '{}'::jsonb, now(), now())
    `
    await database`
      INSERT INTO teams (id, name, created_by) VALUES
        (${fixture.teamOne}, 'Integration team one', ${fixture.userOne}),
        (${fixture.teamTwo}, 'Integration team two', ${fixture.userTwo})
    `
  })

  afterEach(async () => {
    await database`DELETE FROM teams WHERE created_by IN (${fixture.userOne}, ${fixture.userTwo})`
    await database`DELETE FROM auth.users WHERE id IN (${fixture.userOne}, ${fixture.userTwo})`
  })

  afterAll(() => database.end())

  it("keeps the same provider isolated between tenants", async () => {
    const first = await createConnection(fixture.teamOne, fixture.userOne)
    const second = await createConnection(fixture.teamTwo, fixture.userTwo)

    await expect(connections.get(fixture.teamTwo, first.id)).rejects.toBeInstanceOf(
      IntegrationConnectionNotFoundError,
    )
    await expect(connections.getByProvider(fixture.teamOne, provider)).resolves.toEqual(first)
    await expect(connections.getByProvider(fixture.teamTwo, provider)).resolves.toEqual(second)
  })

  it("fences credential rotation and prevents cross-tenant reads", async () => {
    const connection = await createConnection(fixture.teamOne, fixture.userOne)
    const first = await credentials.compareAndSet(
      fixture.teamOne,
      connection.id,
      null,
      sealed("cipher-one"),
      now(),
    )
    const second = await credentials.compareAndSet(
      fixture.teamOne,
      connection.id,
      first.revision,
      sealed("cipher-two"),
      now(),
    )

    expect(second.revision).toBe(2)
    await expect(credentials.load(fixture.teamTwo, connection.id)).resolves.toBeNull()
    await expect(
      credentials.compareAndSet(
        fixture.teamOne,
        connection.id,
        first.revision,
        sealed("stale"),
        now(),
      ),
    ).rejects.toBeInstanceOf(IntegrationCredentialRevisionConflictError)
  })

  it("persists the team kill switch independently of connection state", async () => {
    const connection = await createConnection(fixture.teamOne, fixture.userOne)
    const control = await controls.setEnabled(
      fixture.teamOne,
      null,
      false,
      fixture.userOne,
      now(),
    )

    expect(control.enabled).toBe(false)
    await expect(connections.get(fixture.teamOne, connection.id)).resolves.toMatchObject({
      enabled: true,
      status: "connected",
    })
  })

  it("fences narrow connection updates without overwriting unrelated state", async () => {
    const original = await createConnection(fixture.teamOne, fixture.userOne)
    const health = await connections.recordHealth(
      fixture.teamOne,
      original.id,
      original.revision,
      {
        health: "degraded",
        lastErrorCode: "provider_unavailable",
        checkedAt: now(),
        actorId: fixture.userOne,
        updatedAt: now(),
      },
    )
    const disconnected = await connections.updateAuthState(
      fixture.teamOne,
      original.id,
      health.revision,
      {
        status: "disconnected",
        displayName: "Disconnected workspace",
        externalAccountId: null,
        actorId: fixture.userOne,
        updatedAt: now(),
      },
    )

    expect(disconnected).toMatchObject({ status: "disconnected", health: "degraded", revision: 3 })
    await expect(
      connections.setEnabled(
        fixture.teamOne,
        original.id,
        original.revision,
        false,
        fixture.userOne,
        now(),
      ),
    ).rejects.toBeInstanceOf(IntegrationConnectionRevisionConflictError)
  })

  it("lists scoped connections and credential presence, then fences deletion", async () => {
    const connection = await createConnection(fixture.teamOne, fixture.userOne)
    const stored = await credentials.compareAndSet(
      fixture.teamOne,
      connection.id,
      null,
      sealed("present"),
      now(),
    )

    await expect(connections.list(fixture.teamTwo)).resolves.toEqual([])
    expect(await credentials.listPresentConnectionIds(fixture.teamOne, [connection.id])).toEqual(
      new Set([connection.id]),
    )
    await expect(
      credentials.delete(fixture.teamOne, connection.id, stored.revision + 1),
    ).rejects.toBeInstanceOf(IntegrationCredentialRevisionConflictError)
    await credentials.delete(fixture.teamOne, connection.id, stored.revision)
    await expect(credentials.load(fixture.teamOne, connection.id)).resolves.toBeNull()
  })

  it("lets only one concurrent revision update commit", async () => {
    const connection = await createConnection(fixture.teamOne, fixture.userOne)
    const updates = await Promise.allSettled([
      connections.setEnabled(
        fixture.teamOne,
        connection.id,
        connection.revision,
        false,
        fixture.userOne,
        now(),
      ),
      connections.recordHealth(
        fixture.teamOne,
        connection.id,
        connection.revision,
        {
          health: "degraded",
          lastErrorCode: "provider_unavailable",
          checkedAt: now(),
          actorId: fixture.userOne,
          updatedAt: now(),
        },
      ),
    ])

    expect(updates.filter((result) => result.status === "fulfilled")).toHaveLength(1)
    expect(updates.filter((result) => result.status === "rejected")).toHaveLength(1)
  })

  it("fences concurrent team kill-switch updates", async () => {
    const disabled = await controls.setEnabled(
      fixture.teamOne,
      null,
      false,
      fixture.userOne,
      now(),
    )
    const updates = await Promise.allSettled([
      controls.setEnabled(
        fixture.teamOne,
        disabled.revision,
        true,
        fixture.userOne,
        now(),
      ),
      controls.setEnabled(
        fixture.teamOne,
        disabled.revision,
        false,
        fixture.userTwo,
        now(),
      ),
    ])

    expect(updates.filter((result) => result.status === "fulfilled")).toHaveLength(1)
    expect(updates.filter((result) => result.status === "rejected")).toHaveLength(1)
    await expect(
      controls.setEnabled(
        fixture.teamOne,
        disabled.revision,
        true,
        fixture.userOne,
        now(),
      ),
    ).rejects.toBeInstanceOf(IntegrationTeamControlRevisionConflictError)
  })

  function createConnection(teamId: IntegrationIdentifier, actorId: IntegrationIdentifier) {
    return connections.create(teamId, {
      provider,
      status: "connected",
      health: "healthy",
      actorId,
      createdAt: now(),
    })
  }
})

function identifiers() {
  return {
    userOne: snapshotIntegrationIdentifier(crypto.randomUUID()),
    userTwo: snapshotIntegrationIdentifier(crypto.randomUUID()),
    teamOne: snapshotIntegrationIdentifier(crypto.randomUUID()),
    teamTwo: snapshotIntegrationIdentifier(crypto.randomUUID()),
  }
}

const provider = snapshotIntegrationProviderName("example")

function sealed(value: string) {
  return snapshotSealedIntegrationCredential({ keyId: "key-v1", sealed: `v1.${value}` })
}

function now() {
  return "2026-08-14T10:00:00.000Z"
}
