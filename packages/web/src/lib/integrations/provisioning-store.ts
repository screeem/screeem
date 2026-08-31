import "server-only"

import { getDatabase } from "../db/database"
import {
  snapshotIntegrationIdentifier,
  snapshotIntegrationProviderName,
  type IntegrationConnection,
  type IntegrationIdentifier,
  type IntegrationProviderName,
} from "./contract"
import {
  IntegrationConnectionRevisionConflictError,
  IntegrationCredentialRevisionConflictError,
  snapshotSealedIntegrationCredential,
  type RecordIntegrationHealthInput,
  type SealedIntegrationCredential,
  type StoredIntegrationCredential,
} from "./stores"
import {
  mapIntegrationConnectionRow,
  mapIntegrationCredentialRow,
  type IntegrationConnectionRow,
  type IntegrationCredentialRow,
} from "./postgres-store"

export interface ConnectIntegrationInput {
  readonly connectionId: IntegrationIdentifier
  readonly authorizationAttemptId: IntegrationIdentifier
  readonly provider: IntegrationProviderName
  readonly displayName: string
  readonly externalAccountId: string
  readonly credential: SealedIntegrationCredential
  readonly actorId: IntegrationIdentifier
  readonly connectedAt: string
}

export interface DisconnectedIntegration {
  readonly connection: IntegrationConnection
  readonly credential: StoredIntegrationCredential | null
}

export interface DisconnectingIntegration extends DisconnectedIntegration {
  readonly connection: IntegrationConnection
}

export interface ProvisionedIntegration {
  readonly connection: IntegrationConnection
  readonly previousCredential: StoredIntegrationCredential | null
}

export interface IntegrationProvisioningStore {
  connect(
    teamId: IntegrationIdentifier,
    input: ConnectIntegrationInput,
  ): Promise<ProvisionedIntegration>
  disconnect(
    teamId: IntegrationIdentifier,
    provider: IntegrationProviderName,
    actorId: IntegrationIdentifier,
    disconnectedAt: string,
  ): Promise<DisconnectedIntegration | null>
  recordHealth(
    teamId: IntegrationIdentifier,
    connectionId: IntegrationIdentifier,
    expectedRevision: number,
    input: RecordIntegrationHealthInput,
  ): Promise<IntegrationConnection>
}

export interface SocialIntegrationProvisioningStore extends IntegrationProvisioningStore {
  beginDisconnect(
    teamId: IntegrationIdentifier,
    provider: IntegrationProviderName,
    actorId: IntegrationIdentifier,
    disconnectedAt: string,
  ): Promise<DisconnectingIntegration | null>
  completeDisconnect(
    teamId: IntegrationIdentifier,
    connectionId: IntegrationIdentifier,
    expectedRevision: number,
    expectedCredentialRevision: number | null,
    actorId: IntegrationIdentifier,
    disconnectedAt: string,
  ): Promise<IntegrationConnection>
  updateDisconnectCredential(
    teamId: IntegrationIdentifier,
    connectionId: IntegrationIdentifier,
    expectedConnectionRevision: number,
    expectedCredentialRevision: number,
    credential: SealedIntegrationCredential,
    actorId: IntegrationIdentifier,
    updatedAt: string,
  ): Promise<StoredIntegrationCredential>
}

type Database = ReturnType<typeof getDatabase>

const connectionColumns = `
  id, team_id, provider, revision, status, health, enabled,
  display_name, external_account_id, last_error_code, last_checked_at,
  created_by, created_at, updated_by, updated_at,
  disabled_by, disabled_at, disconnected_by, disconnected_at
`

export class PostgresIntegrationProvisioningStore implements IntegrationProvisioningStore {
  constructor(private readonly database: Database = getDatabase()) {}

  async connect(teamId: IntegrationIdentifier, input: ConnectIntegrationInput) {
    const safeTeamId = snapshotIntegrationIdentifier(teamId)
    const connectionId = snapshotIntegrationIdentifier(input.connectionId)
    const attemptId = snapshotIntegrationIdentifier(input.authorizationAttemptId)
    const provider = snapshotIntegrationProviderName(input.provider)
    const actorId = snapshotIntegrationIdentifier(input.actorId)
    const credential = snapshotSealedIntegrationCredential(input.credential)
    const connectedAt = date(input.connectedAt)
    const displayName = bounded(input.displayName, 160)
    const externalAccountId = bounded(input.externalAccountId, 256)
    let row: ProvisionedIntegration
    try {
      row = await this.database.begin(async (transaction) => {
        const attempts = await transaction<{ readonly attempt_id: string }[]>`
          SELECT attempt_id
          FROM integration_oauth_attempts
          WHERE team_id = ${safeTeamId}
            AND provider = ${provider}
            AND attempt_id = ${attemptId}
            AND user_id = ${actorId}
            AND expires_at > statement_timestamp()
          FOR UPDATE
        `
        if (!attempts[0]) throw new IntegrationAuthorizationAttemptError("superseded")
        const memberships = await transaction<{ readonly present: boolean }[]>`
          SELECT true AS present
          FROM team_members
          WHERE team_id = ${safeTeamId}
            AND user_id = ${actorId}
            AND role IN ('owner', 'admin')
          LIMIT 1
        `
        if (!memberships[0]) throw new IntegrationAuthorizationAttemptError("forbidden")
        const existing = await transaction<IntegrationConnectionRow[]>`
          SELECT ${transaction.unsafe(connectionColumns)}
          FROM integration_connections
          WHERE team_id = ${safeTeamId} AND provider = ${provider}
          FOR UPDATE
        `
        let connection: IntegrationConnectionRow
        if (existing[0]) {
          if (existing[0].id !== connectionId) throw new TypeError("Integration connection mismatch")
          if (existing[0].status === "disconnecting") {
            throw new IntegrationDisconnectInProgressError(provider)
          }
          if (
            existing[0].status !== "disconnected" &&
            existing[0].external_account_id !== null &&
            existing[0].external_account_id !== externalAccountId
          ) {
            throw new IntegrationExternalAccountConflictError(provider, "team")
          }
          const updated = await transaction<IntegrationConnectionRow[]>`
            UPDATE integration_connections
            SET revision = revision + 1,
                status = 'connected', health = 'healthy', enabled = true,
                display_name = ${displayName}, external_account_id = ${externalAccountId},
                last_error_code = NULL, last_checked_at = ${connectedAt},
                updated_by = ${actorId}, updated_at = ${connectedAt},
                disabled_by = NULL, disabled_at = NULL,
                disconnected_by = NULL, disconnected_at = NULL
            WHERE team_id = ${safeTeamId} AND id = ${existing[0].id}
            RETURNING ${transaction.unsafe(connectionColumns)}
          `
          connection = required(updated)
        } else {
          const inserted = await transaction<IntegrationConnectionRow[]>`
            INSERT INTO integration_connections (
              id, team_id, provider, status, health, enabled, display_name,
              external_account_id, last_checked_at, created_by, created_at,
              updated_by, updated_at
            ) VALUES (
              ${connectionId}, ${safeTeamId}, ${provider}, 'connected', 'healthy', true, ${displayName},
              ${externalAccountId}, ${connectedAt}, ${actorId}, ${connectedAt},
              ${actorId}, ${connectedAt}
            )
            RETURNING ${transaction.unsafe(connectionColumns)}
          `
          connection = required(inserted)
        }
        const previousRows = await transaction<IntegrationCredentialRow[]>`
          SELECT team_id, connection_id, key_id, sealed_payload, revision, updated_at
          FROM integration_credentials
          WHERE team_id = ${safeTeamId} AND connection_id = ${connection.id}
          FOR UPDATE
        `
        await transaction`
          INSERT INTO integration_credentials (
            team_id, connection_id, key_id, sealed_payload, revision, updated_at
          ) VALUES (
            ${safeTeamId}, ${connection.id}, ${credential.keyId}, ${credential.sealed}, 1, ${connectedAt}
          )
          ON CONFLICT (team_id, connection_id) DO UPDATE
          SET key_id = EXCLUDED.key_id,
              sealed_payload = EXCLUDED.sealed_payload,
              revision = integration_credentials.revision + 1,
              updated_at = EXCLUDED.updated_at
        `
        await transaction`
          DELETE FROM integration_oauth_attempts
          WHERE team_id = ${safeTeamId} AND provider = ${provider} AND attempt_id = ${attemptId}
        `
        return Object.freeze({
          connection: mapIntegrationConnectionRow(connection),
          previousCredential: previousRows[0]
            ? mapIntegrationCredentialRow(previousRows[0])
            : null,
        })
      })
    } catch (error) {
      if (
        databaseCode(error) === "23505" &&
        databaseConstraint(error) === "integration_connections_provider_external_account_active_key"
      ) {
        throw new IntegrationExternalAccountConflictError(provider, "global")
      }
      throw error
    }
    return row
  }

  async disconnect(
    teamId: IntegrationIdentifier,
    provider: IntegrationProviderName,
    actorId: IntegrationIdentifier,
    disconnectedAt: string,
  ) {
    const safeTeamId = snapshotIntegrationIdentifier(teamId)
    const safeProvider = snapshotIntegrationProviderName(provider)
    const safeActorId = snapshotIntegrationIdentifier(actorId)
    const time = date(disconnectedAt)
    const result = await this.database.begin(async (transaction) => {
      const memberships = await transaction<{ readonly present: boolean }[]>`
        SELECT true AS present
        FROM team_members
        WHERE team_id = ${safeTeamId}
          AND user_id = ${safeActorId}
          AND role IN ('owner', 'admin')
        LIMIT 1
      `
      if (!memberships[0]) throw new IntegrationAuthorizationAttemptError("forbidden")
      await transaction`
        DELETE FROM integration_oauth_attempts
        WHERE team_id = ${safeTeamId} AND provider = ${safeProvider}
      `
      const rows = await transaction<IntegrationConnectionRow[]>`
        SELECT ${transaction.unsafe(connectionColumns)}
        FROM integration_connections
        WHERE team_id = ${safeTeamId} AND provider = ${safeProvider}
        FOR UPDATE
      `
      if (!rows[0]) return null
      const credentials = await transaction<IntegrationCredentialRow[]>`
        SELECT team_id, connection_id, key_id, sealed_payload, revision, updated_at
        FROM integration_credentials
        WHERE team_id = ${safeTeamId} AND connection_id = ${rows[0].id}
        FOR UPDATE
      `
      const updated = await transaction<IntegrationConnectionRow[]>`
        UPDATE integration_connections
        SET revision = revision + 1,
            status = 'disconnected', health = 'unknown', enabled = false,
            last_error_code = NULL, last_checked_at = ${time},
            updated_by = ${safeActorId}, updated_at = ${time},
            disabled_by = ${safeActorId}, disabled_at = ${time},
            disconnected_by = ${safeActorId}, disconnected_at = ${time}
        WHERE team_id = ${safeTeamId} AND id = ${rows[0].id}
        RETURNING ${transaction.unsafe(connectionColumns)}
      `
      await transaction`
        DELETE FROM integration_credentials
        WHERE team_id = ${safeTeamId} AND connection_id = ${rows[0].id}
      `
      await transaction`
        DELETE FROM integration_refresh_leases
        WHERE team_id = ${safeTeamId} AND connection_id = ${rows[0].id}
      `
      return {
        connection: required(updated),
        credential: credentials[0] ?? null,
      }
    })
    if (!result) return null
    return Object.freeze({
      connection: mapIntegrationConnectionRow(result.connection),
      credential: result.credential ? mapIntegrationCredentialRow(result.credential) : null,
    })
  }

  async beginDisconnect(
    teamId: IntegrationIdentifier,
    provider: IntegrationProviderName,
    actorId: IntegrationIdentifier,
    disconnectedAt: string,
  ) {
    const safeTeamId = snapshotIntegrationIdentifier(teamId)
    const safeProvider = snapshotIntegrationProviderName(provider)
    const safeActorId = snapshotIntegrationIdentifier(actorId)
    const time = date(disconnectedAt)
    const result = await this.database.begin(async (transaction) => {
      const memberships = await transaction<{ readonly present: boolean }[]>`
        SELECT true AS present
        FROM team_members
        WHERE team_id = ${safeTeamId}
          AND user_id = ${safeActorId}
          AND role IN ('owner', 'admin')
        LIMIT 1
      `
      if (!memberships[0]) throw new IntegrationAuthorizationAttemptError("forbidden")
      await transaction`
        DELETE FROM integration_oauth_attempts
        WHERE team_id = ${safeTeamId} AND provider = ${safeProvider}
      `
      const rows = await transaction<IntegrationConnectionRow[]>`
        SELECT ${transaction.unsafe(connectionColumns)}
        FROM integration_connections
        WHERE team_id = ${safeTeamId} AND provider = ${safeProvider}
        FOR UPDATE
      `
      if (!rows[0]) return null
      const credentials = await transaction<IntegrationCredentialRow[]>`
        SELECT team_id, connection_id, key_id, sealed_payload, revision, updated_at
        FROM integration_credentials
        WHERE team_id = ${safeTeamId} AND connection_id = ${rows[0].id}
        FOR UPDATE
      `
      if (rows[0].status === "disconnected") {
        return { connection: rows[0], credential: null }
      }
      if (rows[0].status === "disconnecting") {
        return { connection: rows[0], credential: credentials[0] ?? null }
      }
      const updated = await transaction<IntegrationConnectionRow[]>`
        UPDATE integration_connections
        SET revision = revision + 1,
            status = 'disconnecting', health = 'unknown', enabled = false,
            last_error_code = NULL, last_checked_at = ${time},
            updated_by = ${safeActorId}, updated_at = ${time},
            disabled_by = ${safeActorId}, disabled_at = ${time},
            disconnected_by = NULL, disconnected_at = NULL
        WHERE team_id = ${safeTeamId} AND id = ${rows[0].id}
        RETURNING ${transaction.unsafe(connectionColumns)}
      `
      return { connection: required(updated), credential: credentials[0] ?? null }
    })
    if (!result) return null
    return Object.freeze({
      connection: mapIntegrationConnectionRow(result.connection),
      credential: result.credential ? mapIntegrationCredentialRow(result.credential) : null,
    })
  }

  async completeDisconnect(
    teamId: IntegrationIdentifier,
    connectionId: IntegrationIdentifier,
    expectedRevision: number,
    expectedCredentialRevision: number | null,
    actorId: IntegrationIdentifier,
    disconnectedAt: string,
  ) {
    const safeTeamId = snapshotIntegrationIdentifier(teamId)
    const safeConnectionId = snapshotIntegrationIdentifier(connectionId)
    const safeActorId = snapshotIntegrationIdentifier(actorId)
    const revision = positiveRevision(expectedRevision)
    const credentialRevision = expectedCredentialRevision === null
      ? null
      : positiveRevision(expectedCredentialRevision)
    const time = date(disconnectedAt)
    return this.database.begin(async (transaction) => {
      const memberships = await transaction<{ readonly present: boolean }[]>`
        SELECT true AS present
        FROM team_members
        WHERE team_id = ${safeTeamId}
          AND user_id = ${safeActorId}
          AND role IN ('owner', 'admin')
        LIMIT 1
      `
      if (!memberships[0]) throw new IntegrationAuthorizationAttemptError("forbidden")
      const connections = await transaction<IntegrationConnectionRow[]>`
        SELECT ${transaction.unsafe(connectionColumns)}
        FROM integration_connections
        WHERE team_id = ${safeTeamId} AND id = ${safeConnectionId}
        FOR UPDATE
      `
      if (connections[0]?.status === "disconnected") {
        return mapIntegrationConnectionRow(connections[0])
      }
      const credentials = await transaction<{ readonly revision: number | string }[]>`
        SELECT revision
        FROM integration_credentials
        WHERE team_id = ${safeTeamId} AND connection_id = ${safeConnectionId}
        FOR UPDATE
      `
      const currentCredentialRevision = credentials[0]
        ? numericRevision(credentials[0].revision)
        : null
      if (currentCredentialRevision !== credentialRevision) {
        throw new IntegrationCredentialRevisionConflictError(
          safeConnectionId,
          credentialRevision,
          currentCredentialRevision,
        )
      }
      const updated = await transaction<IntegrationConnectionRow[]>`
        UPDATE integration_connections
        SET revision = revision + 1,
            status = 'disconnected', health = 'unknown', enabled = false,
            last_error_code = NULL, last_checked_at = ${time},
            updated_by = ${safeActorId}, updated_at = ${time},
            disconnected_by = ${safeActorId}, disconnected_at = ${time}
        WHERE team_id = ${safeTeamId}
          AND id = ${safeConnectionId}
          AND revision = ${revision}
          AND status = 'disconnecting'
          AND NOT enabled
        RETURNING ${transaction.unsafe(connectionColumns)}
      `
      if (!updated[0]) {
        const current = await transaction<{ readonly revision: number | string }[]>`
          SELECT revision FROM integration_connections
          WHERE team_id = ${safeTeamId} AND id = ${safeConnectionId}
        `
        throw new IntegrationConnectionRevisionConflictError(
          safeConnectionId,
          revision,
          current[0] ? numericRevision(current[0].revision) : null,
        )
      }
      await transaction`
        DELETE FROM integration_credentials
        WHERE team_id = ${safeTeamId} AND connection_id = ${safeConnectionId}
      `
      await transaction`
        DELETE FROM integration_refresh_leases
        WHERE team_id = ${safeTeamId} AND connection_id = ${safeConnectionId}
      `
      return mapIntegrationConnectionRow(updated[0])
    })
  }

  async updateDisconnectCredential(
    teamId: IntegrationIdentifier,
    connectionId: IntegrationIdentifier,
    expectedConnectionRevision: number,
    expectedCredentialRevision: number,
    credentialInput: SealedIntegrationCredential,
    actorId: IntegrationIdentifier,
    updatedAt: string,
  ) {
    const safeTeamId = snapshotIntegrationIdentifier(teamId)
    const safeConnectionId = snapshotIntegrationIdentifier(connectionId)
    const connectionRevision = positiveRevision(expectedConnectionRevision)
    const credentialRevision = positiveRevision(expectedCredentialRevision)
    const credential = snapshotSealedIntegrationCredential(credentialInput)
    const safeActorId = snapshotIntegrationIdentifier(actorId)
    const time = date(updatedAt)
    return this.database.begin(async (transaction) => {
      const memberships = await transaction<{ readonly present: boolean }[]>`
        SELECT true AS present
        FROM team_members
        WHERE team_id = ${safeTeamId}
          AND user_id = ${safeActorId}
          AND role IN ('owner', 'admin')
        LIMIT 1
      `
      if (!memberships[0]) throw new IntegrationAuthorizationAttemptError("forbidden")
      const connections = await transaction<{ readonly revision: number | string }[]>`
        SELECT revision
        FROM integration_connections
        WHERE team_id = ${safeTeamId}
          AND id = ${safeConnectionId}
          AND revision = ${connectionRevision}
          AND status = 'disconnecting'
          AND NOT enabled
        FOR UPDATE
      `
      if (!connections[0]) {
        const current = await transaction<{ readonly revision: number | string }[]>`
          SELECT revision
          FROM integration_connections
          WHERE team_id = ${safeTeamId} AND id = ${safeConnectionId}
        `
        throw new IntegrationConnectionRevisionConflictError(
          safeConnectionId,
          connectionRevision,
          current[0] ? numericRevision(current[0].revision) : null,
        )
      }
      const updated = await transaction<IntegrationCredentialRow[]>`
        UPDATE integration_credentials
        SET key_id = ${credential.keyId},
            sealed_payload = ${credential.sealed},
            revision = revision + 1,
            updated_at = ${time}
        WHERE team_id = ${safeTeamId}
          AND connection_id = ${safeConnectionId}
          AND revision = ${credentialRevision}
        RETURNING team_id, connection_id, key_id, sealed_payload, revision, updated_at
      `
      if (!updated[0]) {
        const current = await transaction<{ readonly revision: number | string }[]>`
          SELECT revision
          FROM integration_credentials
          WHERE team_id = ${safeTeamId} AND connection_id = ${safeConnectionId}
        `
        throw new IntegrationCredentialRevisionConflictError(
          safeConnectionId,
          credentialRevision,
          current[0] ? numericRevision(current[0].revision) : null,
        )
      }
      return mapIntegrationCredentialRow(updated[0])
    })
  }

  async recordHealth(
    teamId: IntegrationIdentifier,
    connectionId: IntegrationIdentifier,
    expectedRevision: number,
    input: RecordIntegrationHealthInput,
  ) {
    const safeTeamId = snapshotIntegrationIdentifier(teamId)
    const safeConnectionId = snapshotIntegrationIdentifier(connectionId)
    const actorId = snapshotIntegrationIdentifier(input.actorId)
    const checkedAt = date(input.checkedAt)
    const updatedAt = date(input.updatedAt)
    return this.database.begin(async (transaction) => {
      const memberships = await transaction<{ readonly present: boolean }[]>`
        SELECT true AS present
        FROM team_members
        WHERE team_id = ${safeTeamId}
          AND user_id = ${actorId}
          AND role IN ('owner', 'admin')
        LIMIT 1
      `
      if (!memberships[0]) throw new IntegrationAuthorizationAttemptError("forbidden")
      const rows = await transaction<IntegrationConnectionRow[]>`
        UPDATE integration_connections
        SET revision = revision + 1,
            health = ${input.health},
            last_error_code = ${input.lastErrorCode},
            last_checked_at = ${checkedAt},
            updated_by = ${actorId},
            updated_at = ${updatedAt}
        WHERE team_id = ${safeTeamId}
          AND id = ${safeConnectionId}
          AND revision = ${expectedRevision}
        RETURNING ${transaction.unsafe(connectionColumns)}
      `
      if (!rows[0]) {
        const current = await transaction<{ readonly revision: number | string }[]>`
          SELECT revision FROM integration_connections
          WHERE team_id = ${safeTeamId} AND id = ${safeConnectionId}
        `
        throw new IntegrationConnectionRevisionConflictError(
          safeConnectionId,
          expectedRevision,
          current[0] ? Number(current[0].revision) : null,
        )
      }
      return mapIntegrationConnectionRow(rows[0])
    })
  }
}

export class IntegrationAuthorizationAttemptError extends Error {
  constructor(readonly reason: "superseded" | "forbidden") {
    super("Integration authorization attempt is no longer current")
    this.name = "IntegrationAuthorizationAttemptError"
  }
}

export class IntegrationDisconnectInProgressError extends Error {
  constructor(readonly provider: IntegrationProviderName) {
    super(`Integration ${provider} is disconnecting`)
    this.name = "IntegrationDisconnectInProgressError"
  }
}

export class IntegrationExternalAccountConflictError extends Error {
  constructor(
    readonly provider: IntegrationProviderName,
    readonly scope: "team" | "global",
  ) {
    super(`Integration account is already connected for ${provider}`)
    this.name = "IntegrationExternalAccountConflictError"
  }
}

function required<T>(rows: readonly T[]) {
  if (!rows[0]) throw new Error("Integration transaction did not return a row")
  return rows[0]
}

function bounded(input: string, maximum: number) {
  if (typeof input !== "string" || input.length === 0 || input.length > maximum) {
    throw new TypeError("Invalid integration metadata")
  }
  return input
}

function date(input: string) {
  const value = new Date(input)
  if (!Number.isFinite(value.getTime()) || value.toISOString() !== input) {
    throw new TypeError("Invalid integration time")
  }
  return value
}

function positiveRevision(input: number) {
  if (!Number.isSafeInteger(input) || input < 1) {
    throw new TypeError("Invalid integration revision")
  }
  return input
}

function numericRevision(input: number | string) {
  const value = typeof input === "number" ? input : Number(input)
  return positiveRevision(value)
}

function databaseCode(error: unknown) {
  return databaseErrorField(error, "code")
}

function databaseConstraint(error: unknown) {
  return databaseErrorField(error, "constraint_name") ?? databaseErrorField(error, "constraint")
}

function databaseErrorField(error: unknown, field: string): string | null {
  if (typeof error !== "object" || error === null) return null
  const descriptor = Object.getOwnPropertyDescriptor(error, field)
  return descriptor && "value" in descriptor && typeof descriptor.value === "string"
    ? descriptor.value
    : null
}
