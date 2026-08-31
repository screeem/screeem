import postgres from "postgres"
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { AesGcmIntegrationCredentialCipher } from "../src/lib/integrations/credential-cipher"
import { snapshotIntegrationIdentifier } from "../src/lib/integrations/contract"
import {
  IntegrationAuthorizationAttemptError,
  PostgresIntegrationProvisioningStore,
} from "../src/lib/integrations/provisioning-store"
import {
  PostgresIntegrationConnectionStore,
  PostgresIntegrationCredentialStore,
  PostgresIntegrationExecutionStore,
} from "../src/lib/integrations/postgres-store"
import { IntegrationCredentialRevisionConflictError } from "../src/lib/integrations/stores"
import {
  salesforceProviderName,
  snapshotSalesforceAccessCredential,
  snapshotSalesforceCredential,
} from "../src/lib/integrations/salesforce/contract"
import {
  PostgresSalesforceOAuthStateStore,
  PostgresSalesforceRefreshLeaseStore,
} from "../src/lib/integrations/salesforce/stores"
import { RefreshingSalesforceAccessTokenProvider } from "../src/lib/integrations/salesforce/token-provider"

const suite = process.env.FORM_PERSISTENCE_DB_TESTS === "1" ? describe : describe.skip

suite("Postgres Salesforce integration stores", () => {
  const database = postgres(process.env.DATABASE_URL ?? "postgresql://127.0.0.1:1/unavailable", {
    max: 2,
    prepare: false,
  })
  const states = new PostgresSalesforceOAuthStateStore(database)
  const leases = new PostgresSalesforceRefreshLeaseStore(database)
  const provisioning = new PostgresIntegrationProvisioningStore(database)
  const credentials = new PostgresIntegrationCredentialStore(database)
  const connections = new PostgresIntegrationConnectionStore(database)
  const execution = new PostgresIntegrationExecutionStore(database)
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
        (${fixture.teamOne}, 'Salesforce team one', ${fixture.userOne}),
        (${fixture.teamTwo}, 'Salesforce team two', ${fixture.userTwo})
    `
    await database`
      INSERT INTO team_members (team_id, user_id, role) VALUES
        (${fixture.teamOne}, ${fixture.userOne}, 'owner'),
        (${fixture.teamTwo}, ${fixture.userTwo}, 'owner')
      ON CONFLICT (team_id, user_id) DO UPDATE SET role = EXCLUDED.role
    `
  })

  afterEach(async () => {
    await database`DELETE FROM teams WHERE created_by IN (${fixture.userOne}, ${fixture.userTwo})`
    await database`DELETE FROM auth.users WHERE id IN (${fixture.userOne}, ${fixture.userTwo})`
  })

  afterAll(() => database.end())

  it("consumes OAuth state once for its initiating user", async () => {
    const state = oauthState(fixture)
    await states.create(state)

    await expect(states.consume(state.stateHash, fixture.userTwo)).resolves.toBeNull()
    const consumed = await states.consume(state.stateHash, fixture.userOne)
    expect(consumed).toMatchObject(state)
    expect(new Date(consumed!.expiresAt).getTime() - new Date(consumed!.createdAt).getTime()).toBe(
      10 * 60_000,
    )
    await expect(states.consume(state.stateHash, fixture.userOne)).resolves.toBeNull()
  })

  it("rejects OAuth state expired by the database clock", async () => {
    const state = oauthState(fixture)
    await states.create(state)
    await database`
      UPDATE integration_oauth_attempts
      SET
        created_at = statement_timestamp() - interval '11 minutes',
        expires_at = statement_timestamp() - interval '1 minute'
      WHERE team_id = ${fixture.teamOne} AND provider = ${salesforceProviderName}
    `
    await expect(states.consume(state.stateHash, fixture.userOne)).resolves.toBeNull()
  })

  it("atomically reconnects metadata and sealed credentials", async () => {
    const cipher = await cipherForTest()
    const connectionId = snapshotIntegrationIdentifier(crypto.randomUUID())
    const firstAttempt = snapshotIntegrationIdentifier(crypto.randomUUID())
    await authorize(fixture, firstAttempt)
    const scope = { teamId: fixture.teamOne, connectionId, provider: salesforceProviderName }
    const first = await provisioning.connect(fixture.teamOne, {
      connectionId,
      authorizationAttemptId: firstAttempt,
      provider: salesforceProviderName,
      displayName: "Salesforce User",
      externalAccountId: "00D000000000001",
      credential: await cipher.seal(scope, { token: "first" }),
      actorId: fixture.userOne,
      connectedAt: "2026-08-14T10:00:00.000Z",
    })
    const secondAttempt = snapshotIntegrationIdentifier(crypto.randomUUID())
    await authorize(fixture, secondAttempt)
    const second = await provisioning.connect(fixture.teamOne, {
      connectionId,
      authorizationAttemptId: secondAttempt,
      provider: salesforceProviderName,
      displayName: "Renamed User",
      externalAccountId: "00D000000000001",
      credential: await cipher.seal(scope, { token: "second" }),
      actorId: fixture.userOne,
      connectedAt: "2026-08-14T10:01:00.000Z",
    })
    const stored = await credentials.load(fixture.teamOne, connectionId)

    expect(second.connection).toMatchObject({
      id: first.connection.id,
      revision: 2,
      displayName: "Renamed User",
    })
    expect(second.previousCredential).not.toBeNull()
    expect(stored?.revision).toBe(2)
    await expect(cipher.open(scope, stored!.credential)).resolves.toEqual({ token: "second" })
    await expect(credentials.load(fixture.teamTwo, connectionId)).resolves.toBeNull()
  })

  it("rejects superseded OAuth attempts and final role loss", async () => {
    const cipher = await cipherForTest()
    const connectionId = snapshotIntegrationIdentifier(crypto.randomUUID())
    const firstAttempt = snapshotIntegrationIdentifier(crypto.randomUUID())
    const secondAttempt = snapshotIntegrationIdentifier(crypto.randomUUID())
    await authorize(fixture, firstAttempt)
    await authorize(fixture, secondAttempt)
    const input = {
      connectionId,
      provider: salesforceProviderName,
      displayName: "Salesforce User",
      externalAccountId: "00D000000000001",
      credential: await cipher.seal(
        { teamId: fixture.teamOne, connectionId, provider: salesforceProviderName },
        { token: "credential" },
      ),
      actorId: fixture.userOne,
      connectedAt: "2026-08-14T10:00:00.000Z",
    }
    await expect(provisioning.connect(fixture.teamOne, {
      ...input,
      authorizationAttemptId: firstAttempt,
    })).rejects.toEqual(expect.objectContaining<Partial<IntegrationAuthorizationAttemptError>>({
      reason: "superseded",
    }))

    await database`
      DELETE FROM team_members
      WHERE team_id = ${fixture.teamOne} AND user_id = ${fixture.userOne}
    `
    await expect(provisioning.connect(fixture.teamOne, {
      ...input,
      authorizationAttemptId: secondAttempt,
    })).rejects.toEqual(expect.objectContaining<Partial<IntegrationAuthorizationAttemptError>>({
      reason: "forbidden",
    }))
  })

  it("disconnects locally and deletes credentials before remote revocation", async () => {
    const cipher = await cipherForTest()
    const connectionId = snapshotIntegrationIdentifier(crypto.randomUUID())
    const attemptId = snapshotIntegrationIdentifier(crypto.randomUUID())
    await authorize(fixture, attemptId)
    await provisioning.connect(fixture.teamOne, {
      connectionId,
      authorizationAttemptId: attemptId,
      provider: salesforceProviderName,
      displayName: "Salesforce User",
      externalAccountId: "00D000000000001",
      credential: await cipher.seal(
        { teamId: fixture.teamOne, connectionId, provider: salesforceProviderName },
        { token: "first" },
      ),
      actorId: fixture.userOne,
      connectedAt: "2026-08-14T10:00:00.000Z",
    })

    const result = await provisioning.disconnect(
      fixture.teamOne,
      salesforceProviderName,
      fixture.userOne,
      "2026-08-14T10:01:00.000Z",
    )

    expect(result?.connection).toMatchObject({ status: "disconnected", enabled: false })
    expect(result?.credential).not.toBeNull()
    await expect(credentials.load(fixture.teamOne, connectionId)).resolves.toBeNull()
  })

  it("fences and idempotently completes the two-phase disconnect", async () => {
    const cipher = await cipherForTest()
    const connectionId = snapshotIntegrationIdentifier(crypto.randomUUID())
    const attemptId = snapshotIntegrationIdentifier(crypto.randomUUID())
    await authorize(fixture, attemptId)
    await provisioning.connect(fixture.teamOne, {
      connectionId,
      authorizationAttemptId: attemptId,
      provider: salesforceProviderName,
      displayName: "Salesforce User",
      externalAccountId: "00D000000000001",
      credential: await cipher.seal(
        { teamId: fixture.teamOne, connectionId, provider: salesforceProviderName },
        { token: "first" },
      ),
      actorId: fixture.userOne,
      connectedAt: "2026-08-14T10:00:00.000Z",
    })
    const started = await provisioning.beginDisconnect(
      fixture.teamOne,
      salesforceProviderName,
      fixture.userOne,
      "2026-08-14T10:01:00.000Z",
    )

    await expect(provisioning.completeDisconnect(
      fixture.teamOne,
      connectionId,
      started!.connection.revision,
      started!.credential!.revision + 1,
      fixture.userOne,
      "2026-08-14T10:02:00.000Z",
    )).rejects.toBeInstanceOf(IntegrationCredentialRevisionConflictError)
    await expect(credentials.load(fixture.teamOne, connectionId)).resolves.not.toBeNull()

    const refreshed = await provisioning.updateDisconnectCredential(
      fixture.teamOne,
      connectionId,
      started!.connection.revision,
      started!.credential!.revision,
      await cipher.seal(
        { teamId: fixture.teamOne, connectionId, provider: salesforceProviderName },
        { token: "refreshed-before-revoke" },
      ),
      fixture.userOne,
      "2026-08-14T10:01:30.000Z",
    )
    expect(refreshed.revision).toBe(started!.credential!.revision + 1)

    const completed = await provisioning.completeDisconnect(
      fixture.teamOne,
      connectionId,
      started!.connection.revision,
      refreshed.revision,
      fixture.userOne,
      "2026-08-14T10:02:00.000Z",
    )
    await expect(provisioning.completeDisconnect(
      fixture.teamOne,
      connectionId,
      started!.connection.revision,
      refreshed.revision,
      fixture.userOne,
      "2026-08-14T10:03:00.000Z",
    )).resolves.toEqual(completed)
    await expect(credentials.load(fixture.teamOne, connectionId)).resolves.toBeNull()
  })

  it("invalidates a pending OAuth callback when disconnecting", async () => {
    const cipher = await cipherForTest()
    const connectionId = snapshotIntegrationIdentifier(crypto.randomUUID())
    const connectedAttempt = snapshotIntegrationIdentifier(crypto.randomUUID())
    await authorize(fixture, connectedAttempt)
    await provisioning.connect(fixture.teamOne, {
      connectionId,
      authorizationAttemptId: connectedAttempt,
      provider: salesforceProviderName,
      displayName: "Salesforce User",
      externalAccountId: "00D000000000001",
      credential: await cipher.seal(
        { teamId: fixture.teamOne, connectionId, provider: salesforceProviderName },
        { token: "credential" },
      ),
      actorId: fixture.userOne,
      connectedAt: "2026-08-14T10:00:00.000Z",
    })
    const pending = oauthState(fixture)
    await states.create(pending)

    await provisioning.disconnect(
      fixture.teamOne,
      salesforceProviderName,
      fixture.userOne,
      "2026-08-14T10:01:00.000Z",
    )

    await expect(states.consume(pending.stateHash, fixture.userOne)).resolves.toBeNull()
  })

  it("allows one refresh lease owner until the lease expires", async () => {
    const cipher = await cipherForTest()
    const connectionId = snapshotIntegrationIdentifier(crypto.randomUUID())
    const attemptId = snapshotIntegrationIdentifier(crypto.randomUUID())
    await authorize(fixture, attemptId)
    await provisioning.connect(fixture.teamOne, {
      connectionId,
      authorizationAttemptId: attemptId,
      provider: salesforceProviderName,
      displayName: "Salesforce User",
      externalAccountId: "00D000000000001",
      credential: await cipher.seal(
        { teamId: fixture.teamOne, connectionId, provider: salesforceProviderName },
        { token: "first" },
      ),
      actorId: fixture.userOne,
      connectedAt: "2026-08-14T10:00:00.000Z",
    })

    await expect(leases.acquire(
      fixture.teamOne, connectionId, "a".repeat(43),
    )).resolves.toBe(true)
    await expect(leases.acquire(
      fixture.teamOne, connectionId, "b".repeat(43),
    )).resolves.toBe(false)
    await database`
      UPDATE integration_refresh_leases
      SET updated_at = statement_timestamp() - interval '40 seconds',
          expires_at = statement_timestamp() - interval '10 seconds'
      WHERE team_id = ${fixture.teamOne} AND connection_id = ${connectionId}
    `
    await expect(leases.acquire(
      fixture.teamOne, connectionId, "b".repeat(43),
    )).resolves.toBe(true)
  })

  it("serializes refresh across provider instances with the database lease", async () => {
    const cipher = await cipherForTest()
    const connectionId = snapshotIntegrationIdentifier(crypto.randomUUID())
    const attemptId = snapshotIntegrationIdentifier(crypto.randomUUID())
    await authorize(fixture, attemptId)
    const scope = { teamId: fixture.teamOne, connectionId, provider: salesforceProviderName }
    const connected = await provisioning.connect(fixture.teamOne, {
      connectionId,
      authorizationAttemptId: attemptId,
      provider: salesforceProviderName,
      displayName: "Salesforce User",
      externalAccountId: "00D000000000001",
      credential: await cipher.seal(scope, salesforceCredential("old-access", attemptId)),
      actorId: fixture.userOne,
      connectedAt: "2026-08-14T10:00:00.000Z",
    })
    const stored = (await credentials.load(fixture.teamOne, connectionId))!
    let finishRefresh!: (value: ReturnType<typeof accessCredential>) => void
    const oauth = {
      refresh: vi.fn().mockImplementation(() => new Promise((resolve) => {
        finishRefresh = resolve
      })),
    }
    const first = await RefreshingSalesforceAccessTokenProvider.create(
      connected.connection, stored, connections, execution, credentials, cipher, oauth as never, leases,
    )
    const second = await RefreshingSalesforceAccessTokenProvider.create(
      connected.connection, stored, connections, execution, credentials, cipher, oauth as never, leases,
    )

    const firstResult = first.refresh("old-access")
    await vi.waitFor(() => expect(oauth.refresh).toHaveBeenCalledOnce())
    const secondResult = second.refresh("old-access")
    finishRefresh(accessCredential("new-access"))

    await expect(Promise.all([firstResult, secondResult])).resolves.toEqual([
      expect.objectContaining({ accessToken: "new-access" }),
      expect.objectContaining({ accessToken: "new-access" }),
    ])
    expect(oauth.refresh).toHaveBeenCalledOnce()
    await expect(credentials.load(fixture.teamOne, connectionId)).resolves.toMatchObject({
      revision: 2,
    })
  })

  it("fences the system reauthorization transition by connection revision", async () => {
    const cipher = await cipherForTest()
    const connectionId = snapshotIntegrationIdentifier(crypto.randomUUID())
    const attemptId = snapshotIntegrationIdentifier(crypto.randomUUID())
    await authorize(fixture, attemptId)
    const provisioned = await provisioning.connect(fixture.teamOne, {
      connectionId,
      authorizationAttemptId: attemptId,
      provider: salesforceProviderName,
      displayName: "Salesforce User",
      externalAccountId: "00D000000000001",
      credential: await cipher.seal(
        { teamId: fixture.teamOne, connectionId, provider: salesforceProviderName },
        { token: "credential" },
      ),
      actorId: fixture.userOne,
      connectedAt: "2026-08-14T10:00:00.000Z",
    })

    await expect(connections.markReauthorizationRequired(
      fixture.teamOne,
      connectionId,
      provisioned.connection.revision,
      "2026-08-14T10:01:00.000Z",
    )).resolves.toMatchObject({
      revision: provisioned.connection.revision + 1,
      status: "reauthorization_required",
      lastErrorCode: "authentication_failed",
    })
    await expect(connections.markReauthorizationRequired(
      fixture.teamOne,
      connectionId,
      provisioned.connection.revision,
      "2026-08-14T10:02:00.000Z",
    )).rejects.toMatchObject({ code: "integration_connection_revision_conflict" })
  })

  async function authorize(
    values: ReturnType<typeof identifiers>,
    attemptId: ReturnType<typeof snapshotIntegrationIdentifier>,
  ) {
    await database`
      INSERT INTO integration_oauth_attempts (
        team_id, provider, attempt_id, user_id, created_at, expires_at
      ) VALUES (
        ${values.teamOne}, ${salesforceProviderName}, ${attemptId}, ${values.userOne},
        statement_timestamp(), statement_timestamp() + interval '10 minutes'
      )
      ON CONFLICT (team_id, provider) DO UPDATE
      SET attempt_id = EXCLUDED.attempt_id,
          user_id = EXCLUDED.user_id,
          created_at = EXCLUDED.created_at,
          expires_at = EXCLUDED.expires_at
    `
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

function oauthState(fixture: ReturnType<typeof identifiers>) {
  return {
    stateHash: "s".repeat(43),
    teamId: fixture.teamOne,
    attemptId: snapshotIntegrationIdentifier(crypto.randomUUID()),
    userId: fixture.userOne,
    codeVerifier: "v".repeat(64),
    redirectUri: "http://localhost:3000/api/integrations/salesforce/callback",
    returnPath: "/dashboard/forms",
  }
}

function cipherForTest() {
  return AesGcmIntegrationCredentialCipher.create(
    "test-key",
    Buffer.alloc(32, 9).toString("base64url"),
  )
}

function accessCredential(accessToken: string) {
  return snapshotSalesforceAccessCredential({
    accessToken,
    refreshToken: "refresh-token",
    instanceUrl: "https://acme.my.salesforce.com",
    identityUrl: "https://login.salesforce.com/id/00D000000000001/005000000000001",
    issuedAt: "2026-08-14T10:00:00.000Z",
  })
}

function salesforceCredential(
  accessToken: string,
  generation: ReturnType<typeof snapshotIntegrationIdentifier>,
) {
  return snapshotSalesforceCredential({ ...accessCredential(accessToken), generation })
}
