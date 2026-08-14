import "server-only"

import { getDatabase } from "../db/database"
import {
  maximumIntegrationConnections,
  snapshotIntegrationConnection,
  snapshotIntegrationIdentifier,
  snapshotIntegrationProviderName,
  snapshotIntegrationTeamControl,
  type IntegrationConnection,
  type IntegrationIdentifier,
  type IntegrationProviderName,
  type IntegrationTeamControl,
} from "./contract"
import {
  IntegrationConnectionAlreadyExistsError,
  IntegrationConnectionNotFoundError,
  IntegrationConnectionRevisionConflictError,
  IntegrationCredentialRevisionConflictError,
  IntegrationStoreError,
  IntegrationTeamControlRevisionConflictError,
  snapshotSealedIntegrationCredential,
  snapshotStoredIntegrationCredential,
  type CreateIntegrationConnectionInput,
  type IntegrationConnectionStore,
  type IntegrationCredentialStore,
  type IntegrationTeamControlStore,
  type SealedIntegrationCredential,
  type StoredIntegrationCredential,
  type RecordIntegrationHealthInput,
  type UpdateIntegrationAuthStateInput,
} from "./stores"

type Database = ReturnType<typeof getDatabase>

interface ConnectionRow {
  readonly id: string
  readonly team_id: string
  readonly provider: string
  readonly revision: number | string
  readonly status: string
  readonly health: string
  readonly enabled: boolean
  readonly display_name: string | null
  readonly external_account_id: string | null
  readonly last_error_code: string | null
  readonly last_checked_at: Date | null
  readonly created_by: string | null
  readonly created_at: Date
  readonly updated_by: string | null
  readonly updated_at: Date
  readonly disabled_by: string | null
  readonly disabled_at: Date | null
  readonly disconnected_by: string | null
  readonly disconnected_at: Date | null
}

interface TeamControlRow {
  readonly team_id: string
  readonly revision: number | string
  readonly enabled: boolean
  readonly disabled_by: string | null
  readonly disabled_at: Date | null
  readonly updated_by: string | null
  readonly updated_at: Date
}

interface CredentialRow {
  readonly team_id: string
  readonly connection_id: string
  readonly key_id: string
  readonly sealed_payload: string
  readonly revision: number | string
  readonly updated_at: Date
}

export class PostgresIntegrationConnectionStore implements IntegrationConnectionStore {
  constructor(private readonly database: Database = getDatabase()) {}

  async list(teamId: IntegrationIdentifier): Promise<readonly IntegrationConnection[]> {
    const safeTeamId = snapshotIntegrationIdentifier(teamId)
    const rows = await safeDatabaseCall(() => this.database<ConnectionRow[]>`
      SELECT
        id, team_id, provider, revision, status, health, enabled,
        display_name, external_account_id, last_error_code, last_checked_at,
        created_by, created_at, updated_by, updated_at,
        disabled_by, disabled_at, disconnected_by, disconnected_at
      FROM integration_connections
      WHERE team_id = ${safeTeamId}
      ORDER BY created_at DESC
      LIMIT ${maximumIntegrationConnections}
    `)
    return Object.freeze(rows.map(mapConnectionRow))
  }

  async get(
    teamId: IntegrationIdentifier,
    connectionId: IntegrationIdentifier,
  ): Promise<IntegrationConnection> {
    const safeTeamId = snapshotIntegrationIdentifier(teamId)
    const safeConnectionId = snapshotIntegrationIdentifier(connectionId)
    const rows = await safeDatabaseCall(() => this.database<ConnectionRow[]>`
      SELECT
        id, team_id, provider, revision, status, health, enabled,
        display_name, external_account_id, last_error_code, last_checked_at,
        created_by, created_at, updated_by, updated_at,
        disabled_by, disabled_at, disconnected_by, disconnected_at
      FROM integration_connections
      WHERE team_id = ${safeTeamId}
        AND id = ${safeConnectionId}
      LIMIT 1
    `)
    const row = rows[0]
    if (!row) throw new IntegrationConnectionNotFoundError(safeConnectionId)
    return mapConnectionRow(row)
  }

  async getByProvider(
    teamId: IntegrationIdentifier,
    provider: IntegrationProviderName,
  ): Promise<IntegrationConnection | null> {
    const safeTeamId = snapshotIntegrationIdentifier(teamId)
    const safeProvider = snapshotIntegrationProviderName(provider)
    const rows = await safeDatabaseCall(() => this.database<ConnectionRow[]>`
      SELECT
        id, team_id, provider, revision, status, health, enabled,
        display_name, external_account_id, last_error_code, last_checked_at,
        created_by, created_at, updated_by, updated_at,
        disabled_by, disabled_at, disconnected_by, disconnected_at
      FROM integration_connections
      WHERE team_id = ${safeTeamId}
        AND provider = ${safeProvider}
      LIMIT 1
    `)
    return rows[0] ? mapConnectionRow(rows[0]) : null
  }

  async create(
    teamId: IntegrationIdentifier,
    input: CreateIntegrationConnectionInput,
  ): Promise<IntegrationConnection> {
    const safeTeamId = snapshotIntegrationIdentifier(teamId)
    const actorId = snapshotIntegrationIdentifier(input.actorId)
    const createdAt = normalizeDate(input.createdAt, "integration creation time")
    const candidate = snapshotIntegrationConnection({
      id: input.id ?? crypto.randomUUID(),
      teamId: safeTeamId,
      provider: input.provider,
      revision: 1,
      status: input.status,
      health: input.health ?? "unknown",
      enabled: input.enabled ?? true,
      displayName: input.displayName ?? null,
      externalAccountId: input.externalAccountId ?? null,
      lastErrorCode: input.lastErrorCode ?? null,
      lastCheckedAt: input.lastCheckedAt ?? null,
      createdBy: actorId,
      createdAt: createdAt.toISOString(),
      updatedBy: actorId,
      updatedAt: createdAt.toISOString(),
      disabledBy: input.enabled === false ? actorId : null,
      disabledAt: input.enabled === false ? createdAt.toISOString() : null,
      disconnectedBy: input.status === "disconnected" ? actorId : null,
      disconnectedAt: input.status === "disconnected" ? createdAt.toISOString() : null,
    })
    try {
      const rows = await this.database<ConnectionRow[]>`
        INSERT INTO integration_connections (
          id, team_id, provider, revision, status, health, enabled,
          display_name, external_account_id, last_error_code, last_checked_at,
          created_by, created_at, updated_by, updated_at,
          disabled_by, disabled_at, disconnected_by, disconnected_at
        ) VALUES (
          ${candidate.id}, ${candidate.teamId}, ${candidate.provider}, ${candidate.revision}, ${candidate.status},
          ${candidate.health}, ${candidate.enabled}, ${candidate.displayName},
          ${candidate.externalAccountId}, ${candidate.lastErrorCode},
          ${nullableDate(candidate.lastCheckedAt)}, ${candidate.createdBy}, ${createdAt},
          ${candidate.updatedBy}, ${createdAt}, ${candidate.disabledBy},
          ${nullableDate(candidate.disabledAt)}, ${candidate.disconnectedBy},
          ${nullableDate(candidate.disconnectedAt)}
        )
        RETURNING
          id, team_id, provider, revision, status, health, enabled,
          display_name, external_account_id, last_error_code, last_checked_at,
          created_by, created_at, updated_by, updated_at,
          disabled_by, disabled_at, disconnected_by, disconnected_at
      `
      return mapConnectionRow(requireRow(rows, "create integration connection"))
    } catch (error) {
      if (databaseCode(error) === "23505") {
        throw new IntegrationConnectionAlreadyExistsError(candidate.provider)
      }
      throw mapDatabaseError(error)
    }
  }

  async updateAuthState(
    teamId: IntegrationIdentifier,
    connectionId: IntegrationIdentifier,
    expectedRevision: number,
    input: UpdateIntegrationAuthStateInput,
  ): Promise<IntegrationConnection> {
    const safeTeamId = snapshotIntegrationIdentifier(teamId)
    const safeConnectionId = snapshotIntegrationIdentifier(connectionId)
    const actorId = snapshotIntegrationIdentifier(input.actorId)
    const updatedAt = normalizeDate(input.updatedAt, "integration update time")
    const rows = await safeDatabaseCall(() => this.database<ConnectionRow[]>`
      UPDATE integration_connections
      SET revision = revision + 1,
          status = ${input.status},
          display_name = ${input.displayName},
          external_account_id = ${input.externalAccountId},
          updated_by = ${actorId},
          updated_at = ${updatedAt},
          disconnected_by = ${input.status === "disconnected" ? actorId : null},
          disconnected_at = ${input.status === "disconnected" ? updatedAt : null}
      WHERE team_id = ${safeTeamId}
        AND id = ${safeConnectionId}
        AND revision = ${expectedRevision}
      RETURNING
        id, team_id, provider, revision, status, health, enabled,
        display_name, external_account_id, last_error_code, last_checked_at,
        created_by, created_at, updated_by, updated_at,
        disabled_by, disabled_at, disconnected_by, disconnected_at
    `)
    if (!rows[0]) await this.throwMutationMiss(safeTeamId, safeConnectionId, expectedRevision)
    return mapConnectionRow(rows[0])
  }

  async recordHealth(
    teamId: IntegrationIdentifier,
    connectionId: IntegrationIdentifier,
    expectedRevision: number,
    input: RecordIntegrationHealthInput,
  ): Promise<IntegrationConnection> {
    const safeTeamId = snapshotIntegrationIdentifier(teamId)
    const safeConnectionId = snapshotIntegrationIdentifier(connectionId)
    const actorId = snapshotIntegrationIdentifier(input.actorId)
    const checkedAt = normalizeDate(input.checkedAt, "integration check time")
    const updatedAt = normalizeDate(input.updatedAt, "integration update time")
    const rows = await safeDatabaseCall(() => this.database<ConnectionRow[]>`
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
      RETURNING
        id, team_id, provider, revision, status, health, enabled,
        display_name, external_account_id, last_error_code, last_checked_at,
        created_by, created_at, updated_by, updated_at,
        disabled_by, disabled_at, disconnected_by, disconnected_at
    `)
    if (!rows[0]) await this.throwMutationMiss(safeTeamId, safeConnectionId, expectedRevision)
    return mapConnectionRow(rows[0])
  }

  async setEnabled(
    teamId: IntegrationIdentifier,
    connectionId: IntegrationIdentifier,
    expectedRevision: number,
    enabled: boolean,
    actorId: IntegrationIdentifier,
    updatedAt: string,
  ): Promise<IntegrationConnection> {
    const safeTeamId = snapshotIntegrationIdentifier(teamId)
    const safeConnectionId = snapshotIntegrationIdentifier(connectionId)
    const safeActorId = snapshotIntegrationIdentifier(actorId)
    const time = normalizeDate(updatedAt, "integration update time")
    const rows = await safeDatabaseCall(() => this.database<ConnectionRow[]>`
      UPDATE integration_connections
      SET revision = revision + 1,
          enabled = ${enabled},
          updated_by = ${safeActorId},
          updated_at = ${time},
          disabled_by = ${enabled ? null : safeActorId},
          disabled_at = ${enabled ? null : time}
      WHERE team_id = ${safeTeamId}
        AND id = ${safeConnectionId}
        AND revision = ${expectedRevision}
      RETURNING
        id, team_id, provider, revision, status, health, enabled,
        display_name, external_account_id, last_error_code, last_checked_at,
        created_by, created_at, updated_by, updated_at,
        disabled_by, disabled_at, disconnected_by, disconnected_at
    `)
    if (!rows[0]) await this.throwMutationMiss(safeTeamId, safeConnectionId, expectedRevision)
    return mapConnectionRow(rows[0])
  }

  private async throwMutationMiss(
    teamId: IntegrationIdentifier,
    connectionId: IntegrationIdentifier,
    expectedRevision: number,
  ): Promise<never> {
    const current = await this.get(teamId, connectionId)
    throw new IntegrationConnectionRevisionConflictError(
      connectionId,
      expectedRevision,
      current.revision,
    )
  }
}

export class PostgresIntegrationTeamControlStore implements IntegrationTeamControlStore {
  constructor(private readonly database: Database = getDatabase()) {}

  async get(teamId: IntegrationIdentifier): Promise<IntegrationTeamControl> {
    const safeTeamId = snapshotIntegrationIdentifier(teamId)
    const rows = await safeDatabaseCall(() => this.database<TeamControlRow[]>`
      SELECT team_id, revision, enabled, disabled_by, disabled_at, updated_by, updated_at
      FROM integration_team_controls
      WHERE team_id = ${safeTeamId}
      LIMIT 1
    `)
    return rows[0]
      ? mapTeamControlRow(rows[0])
      : snapshotIntegrationTeamControl({
          teamId: safeTeamId,
          revision: null,
          enabled: true,
          disabledBy: null,
          disabledAt: null,
          updatedBy: null,
          updatedAt: null,
        })
  }

  async setEnabled(
    teamId: IntegrationIdentifier,
    expectedRevision: number | null,
    enabled: boolean,
    actorId: IntegrationIdentifier,
    updatedAt: string,
  ): Promise<IntegrationTeamControl> {
    const safeTeamId = snapshotIntegrationIdentifier(teamId)
    const safeActorId = snapshotIntegrationIdentifier(actorId)
    const time = normalizeDate(updatedAt, "integration control update time")
    const rows = await safeDatabaseCall(async () =>
      expectedRevision === null
        ? await this.database<TeamControlRow[]>`
            INSERT INTO integration_team_controls (
              team_id, revision, enabled, disabled_by, disabled_at, updated_by, updated_at
            ) VALUES (
              ${safeTeamId}, 1, ${enabled}, ${enabled ? null : safeActorId},
              ${enabled ? null : time}, ${safeActorId}, ${time}
            )
            ON CONFLICT (team_id) DO NOTHING
            RETURNING team_id, revision, enabled, disabled_by, disabled_at, updated_by, updated_at
          `
        : await this.database<TeamControlRow[]>`
            UPDATE integration_team_controls
            SET revision = revision + 1,
                enabled = ${enabled},
                disabled_by = ${enabled ? null : safeActorId},
                disabled_at = ${enabled ? null : time},
                updated_by = ${safeActorId},
                updated_at = ${time}
            WHERE team_id = ${safeTeamId}
              AND revision = ${expectedRevision}
            RETURNING team_id, revision, enabled, disabled_by, disabled_at, updated_by, updated_at
          `,
    )
    if (rows[0]) return mapTeamControlRow(rows[0])
    const current = await this.get(safeTeamId)
    throw new IntegrationTeamControlRevisionConflictError(
      safeTeamId,
      expectedRevision,
      current.revision,
    )
  }
}

export class PostgresIntegrationCredentialStore implements IntegrationCredentialStore {
  constructor(
    private readonly database: Database = getDatabase(),
    private readonly connections: IntegrationConnectionStore = new PostgresIntegrationConnectionStore(
      database,
    ),
  ) {}

  async load(
    teamId: IntegrationIdentifier,
    connectionId: IntegrationIdentifier,
  ): Promise<StoredIntegrationCredential | null> {
    const safeTeamId = snapshotIntegrationIdentifier(teamId)
    const safeConnectionId = snapshotIntegrationIdentifier(connectionId)
    const rows = await safeDatabaseCall(() => this.database<CredentialRow[]>`
      SELECT team_id, connection_id, key_id, sealed_payload, revision, updated_at
      FROM integration_credentials
      WHERE team_id = ${safeTeamId}
        AND connection_id = ${safeConnectionId}
      LIMIT 1
    `)
    return rows[0] ? mapCredentialRow(rows[0]) : null
  }

  async listPresentConnectionIds(
    teamId: IntegrationIdentifier,
    connectionIds: readonly IntegrationIdentifier[],
  ): Promise<ReadonlySet<IntegrationIdentifier>> {
    const safeTeamId = snapshotIntegrationIdentifier(teamId)
    const safeIds = connectionIds.map(snapshotIntegrationIdentifier)
    if (safeIds.length === 0) return new Set()
    if (safeIds.length > maximumIntegrationConnections) {
      throw new TypeError("Too many integration connection identifiers")
    }
    const rows = await safeDatabaseCall(() => this.database<{ readonly connection_id: string }[]>`
      SELECT connection_id
      FROM integration_credentials
      WHERE team_id = ${safeTeamId}
        AND connection_id = ANY(${safeIds}::uuid[])
    `)
    return new Set(rows.map((row) => snapshotIntegrationIdentifier(row.connection_id)))
  }

  async compareAndSet(
    teamId: IntegrationIdentifier,
    connectionId: IntegrationIdentifier,
    expectedRevision: number | null,
    credential: SealedIntegrationCredential,
    updatedAt: string,
  ): Promise<StoredIntegrationCredential> {
    const safeTeamId = snapshotIntegrationIdentifier(teamId)
    const safeConnectionId = snapshotIntegrationIdentifier(connectionId)
    await this.connections.get(safeTeamId, safeConnectionId)
    const safe = snapshotSealedIntegrationCredential(credential)
    const time = normalizeDate(updatedAt, "integration credential update time")
    const rows = await safeDatabaseCall(async () =>
      expectedRevision === null
        ? await this.database<CredentialRow[]>`
            INSERT INTO integration_credentials (
              team_id, connection_id, key_id, sealed_payload, revision, updated_at
            ) VALUES (
              ${safeTeamId}, ${safeConnectionId}, ${safe.keyId}, ${safe.sealed}, 1, ${time}
            )
            ON CONFLICT (team_id, connection_id) DO NOTHING
            RETURNING team_id, connection_id, key_id, sealed_payload, revision, updated_at
          `
        : await this.database<CredentialRow[]>`
            UPDATE integration_credentials
            SET key_id = ${safe.keyId},
                sealed_payload = ${safe.sealed},
                revision = revision + 1,
                updated_at = ${time}
            WHERE team_id = ${safeTeamId}
              AND connection_id = ${safeConnectionId}
              AND revision = ${expectedRevision}
            RETURNING team_id, connection_id, key_id, sealed_payload, revision, updated_at
          `,
    )
    if (rows[0]) return mapCredentialRow(rows[0])
    const current = await this.load(safeTeamId, safeConnectionId)
    throw new IntegrationCredentialRevisionConflictError(
      safeConnectionId,
      expectedRevision,
      current?.revision ?? null,
    )
  }

  async delete(
    teamId: IntegrationIdentifier,
    connectionId: IntegrationIdentifier,
    expectedRevision: number,
  ): Promise<void> {
    const safeTeamId = snapshotIntegrationIdentifier(teamId)
    const safeConnectionId = snapshotIntegrationIdentifier(connectionId)
    const rows = await safeDatabaseCall(() => this.database<{ readonly revision: number | string }[]>`
      DELETE FROM integration_credentials
      WHERE team_id = ${safeTeamId}
        AND connection_id = ${safeConnectionId}
        AND revision = ${expectedRevision}
      RETURNING revision
    `)
    if (rows.length === 0) {
      const current = await this.load(safeTeamId, safeConnectionId)
      throw new IntegrationCredentialRevisionConflictError(
        safeConnectionId,
        expectedRevision,
        current?.revision ?? null,
      )
    }
  }
}

export function mapIntegrationConnectionRow(row: ConnectionRow): IntegrationConnection {
  return mapConnectionRow(row)
}

function mapConnectionRow(row: ConnectionRow): IntegrationConnection {
  return mapStoredValue(() =>
    snapshotIntegrationConnection({
      id: row.id,
      teamId: row.team_id,
      provider: row.provider,
      revision: Number(row.revision),
      status: row.status,
      health: row.health,
      enabled: row.enabled,
      displayName: row.display_name,
      externalAccountId: row.external_account_id,
      lastErrorCode: row.last_error_code,
      lastCheckedAt: row.last_checked_at?.toISOString() ?? null,
      createdBy: row.created_by,
      createdAt: row.created_at.toISOString(),
      updatedBy: row.updated_by,
      updatedAt: row.updated_at.toISOString(),
      disabledBy: row.disabled_by,
      disabledAt: row.disabled_at?.toISOString() ?? null,
      disconnectedBy: row.disconnected_by,
      disconnectedAt: row.disconnected_at?.toISOString() ?? null,
    }),
  )
}

function mapTeamControlRow(row: TeamControlRow): IntegrationTeamControl {
  return mapStoredValue(() =>
    snapshotIntegrationTeamControl({
      teamId: row.team_id,
      revision: Number(row.revision),
      enabled: row.enabled,
      disabledBy: row.disabled_by,
      disabledAt: row.disabled_at?.toISOString() ?? null,
      updatedBy: row.updated_by,
      updatedAt: row.updated_at.toISOString(),
    }),
  )
}

function mapCredentialRow(row: CredentialRow): StoredIntegrationCredential {
  return mapStoredValue(() => {
    const revision = Number(row.revision)
    if (!Number.isSafeInteger(revision) || revision < 1) {
      throw new TypeError("Invalid integration credential revision")
    }
    return snapshotStoredIntegrationCredential({
      teamId: snapshotIntegrationIdentifier(row.team_id),
      connectionId: snapshotIntegrationIdentifier(row.connection_id),
      credential: snapshotSealedIntegrationCredential({
        keyId: row.key_id,
        sealed: row.sealed_payload,
      }),
      revision,
      updatedAt: row.updated_at.toISOString(),
    })
  }, "invalid_stored_integration_credential")
}

function requireRow<Row>(rows: readonly Row[], operation: string): Row {
  const row = rows[0]
  if (!row) throw new IntegrationStoreError("integration_store_error", `Failed to ${operation}`)
  return row
}

function normalizeDate(input: string, name: string): Date {
  const milliseconds = Date.parse(input)
  if (!Number.isFinite(milliseconds)) throw new TypeError(`Invalid ${name}`)
  return new Date(milliseconds)
}

function nullableDate(input: string | null): Date | null {
  return input === null ? null : normalizeDate(input, "integration timestamp")
}

function databaseCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null
  const descriptor = Object.getOwnPropertyDescriptor(error, "code")
  return descriptor && "value" in descriptor && typeof descriptor.value === "string"
    ? descriptor.value
    : null
}

function mapDatabaseError(error: unknown): IntegrationStoreError {
  if (error instanceof IntegrationStoreError) return error
  return new IntegrationStoreError("integration_store_error", "Integration storage failed")
}

async function safeDatabaseCall<Value>(operation: () => Promise<Value>): Promise<Value> {
  try {
    return await operation()
  } catch (error) {
    throw mapDatabaseError(error)
  }
}

function mapStoredValue<Value>(
  operation: () => Value,
  code: "integration_store_error" | "invalid_stored_integration_credential" = "integration_store_error",
): Value {
  try {
    return operation()
  } catch (error) {
    if (error instanceof IntegrationStoreError) throw error
    throw new IntegrationStoreError(code, "Stored integration data is invalid")
  }
}
