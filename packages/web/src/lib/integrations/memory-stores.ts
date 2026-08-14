import "server-only"

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
  IntegrationTeamControlRevisionConflictError,
  snapshotSealedIntegrationCredential,
  snapshotStoredIntegrationCredential,
  type CreateIntegrationConnectionInput,
  type IntegrationConnectionStore,
  type IntegrationCredentialStore,
  type IntegrationTeamControlStore,
  type RecordIntegrationHealthInput,
  type SealedIntegrationCredential,
  type StoredIntegrationCredential,
  type UpdateIntegrationAuthStateInput,
} from "./stores"

export class MemoryIntegrationConnectionStore implements IntegrationConnectionStore {
  readonly #connections = new Map<IntegrationIdentifier, IntegrationConnection>()

  async list(teamId: IntegrationIdentifier): Promise<readonly IntegrationConnection[]> {
    const safeTeamId = snapshotIntegrationIdentifier(teamId)
    return Object.freeze(
      [...this.#connections.values()]
        .filter((connection) => connection.teamId === safeTeamId)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, maximumIntegrationConnections)
        .map(snapshotIntegrationConnection),
    )
  }

  async get(
    teamId: IntegrationIdentifier,
    connectionId: IntegrationIdentifier,
  ): Promise<IntegrationConnection> {
    return snapshotIntegrationConnection(this.#read(teamId, connectionId))
  }

  async getByProvider(
    teamId: IntegrationIdentifier,
    provider: IntegrationProviderName,
  ): Promise<IntegrationConnection | null> {
    const safeTeamId = snapshotIntegrationIdentifier(teamId)
    const safeProvider = snapshotIntegrationProviderName(provider)
    const connection = [...this.#connections.values()].find(
      (candidate) => candidate.teamId === safeTeamId && candidate.provider === safeProvider,
    )
    return connection ? snapshotIntegrationConnection(connection) : null
  }

  async create(
    teamId: IntegrationIdentifier,
    input: CreateIntegrationConnectionInput,
  ): Promise<IntegrationConnection> {
    const safeTeamId = snapshotIntegrationIdentifier(teamId)
    const provider = snapshotIntegrationProviderName(input.provider)
    if (
      [...this.#connections.values()].some(
        (candidate) => candidate.teamId === safeTeamId && candidate.provider === provider,
      )
    ) {
      throw new IntegrationConnectionAlreadyExistsError(provider)
    }
    const id = snapshotIntegrationIdentifier(input.id ?? crypto.randomUUID())
    if (this.#connections.has(id)) throw new IntegrationConnectionAlreadyExistsError(provider)
    const actorId = snapshotIntegrationIdentifier(input.actorId)
    const createdAt = normalizedTimestamp(input.createdAt)
    const enabled = input.enabled ?? true
    const connection = snapshotIntegrationConnection({
      id,
      teamId: safeTeamId,
      provider,
      revision: 1,
      status: input.status,
      health: input.health ?? "unknown",
      enabled,
      displayName: input.displayName ?? null,
      externalAccountId: input.externalAccountId ?? null,
      lastErrorCode: input.lastErrorCode ?? null,
      lastCheckedAt: input.lastCheckedAt ?? null,
      createdBy: actorId,
      createdAt,
      updatedBy: actorId,
      updatedAt: createdAt,
      disabledBy: enabled ? null : actorId,
      disabledAt: enabled ? null : createdAt,
      disconnectedBy: input.status === "disconnected" ? actorId : null,
      disconnectedAt: input.status === "disconnected" ? createdAt : null,
    })
    this.#connections.set(connection.id, connection)
    return snapshotIntegrationConnection(connection)
  }

  async updateAuthState(
    teamId: IntegrationIdentifier,
    connectionId: IntegrationIdentifier,
    expectedRevision: number,
    input: UpdateIntegrationAuthStateInput,
  ): Promise<IntegrationConnection> {
    const current = this.#read(teamId, connectionId)
    assertRevision(current, expectedRevision)
    const actorId = snapshotIntegrationIdentifier(input.actorId)
    const updatedAt = normalizedTimestamp(input.updatedAt)
    const connection = snapshotIntegrationConnection({
      ...current,
      revision: expectedRevision + 1,
      status: input.status,
      displayName: input.displayName,
      externalAccountId: input.externalAccountId,
      updatedBy: actorId,
      updatedAt,
      disconnectedBy: input.status === "disconnected" ? actorId : null,
      disconnectedAt: input.status === "disconnected" ? updatedAt : null,
    })
    this.#connections.set(connection.id, connection)
    return snapshotIntegrationConnection(connection)
  }

  async recordHealth(
    teamId: IntegrationIdentifier,
    connectionId: IntegrationIdentifier,
    expectedRevision: number,
    input: RecordIntegrationHealthInput,
  ): Promise<IntegrationConnection> {
    const current = this.#read(teamId, connectionId)
    assertRevision(current, expectedRevision)
    const connection = snapshotIntegrationConnection({
      ...current,
      revision: expectedRevision + 1,
      health: input.health,
      lastErrorCode: input.lastErrorCode,
      lastCheckedAt: normalizedTimestamp(input.checkedAt),
      updatedBy: snapshotIntegrationIdentifier(input.actorId),
      updatedAt: normalizedTimestamp(input.updatedAt),
    })
    this.#connections.set(connection.id, connection)
    return snapshotIntegrationConnection(connection)
  }

  async setEnabled(
    teamId: IntegrationIdentifier,
    connectionId: IntegrationIdentifier,
    expectedRevision: number,
    enabled: boolean,
    actorId: IntegrationIdentifier,
    updatedAt: string,
  ): Promise<IntegrationConnection> {
    const current = this.#read(teamId, connectionId)
    assertRevision(current, expectedRevision)
    const safeActorId = snapshotIntegrationIdentifier(actorId)
    const time = normalizedTimestamp(updatedAt)
    const connection = snapshotIntegrationConnection({
      ...current,
      revision: expectedRevision + 1,
      enabled,
      updatedBy: safeActorId,
      updatedAt: time,
      disabledBy: enabled ? null : safeActorId,
      disabledAt: enabled ? null : time,
    })
    this.#connections.set(connection.id, connection)
    return snapshotIntegrationConnection(connection)
  }

  #read(
    teamId: IntegrationIdentifier,
    connectionId: IntegrationIdentifier,
  ): IntegrationConnection {
    const safeTeamId = snapshotIntegrationIdentifier(teamId)
    const safeConnectionId = snapshotIntegrationIdentifier(connectionId)
    const connection = this.#connections.get(safeConnectionId)
    if (!connection || connection.teamId !== safeTeamId) {
      throw new IntegrationConnectionNotFoundError(safeConnectionId)
    }
    return connection
  }
}

export class MemoryIntegrationTeamControlStore implements IntegrationTeamControlStore {
  readonly #controls = new Map<IntegrationIdentifier, IntegrationTeamControl>()

  async get(teamId: IntegrationIdentifier): Promise<IntegrationTeamControl> {
    const safeTeamId = snapshotIntegrationIdentifier(teamId)
    return snapshotIntegrationTeamControl(
      this.#controls.get(safeTeamId) ?? {
        teamId: safeTeamId,
        revision: null,
        enabled: true,
        disabledBy: null,
        disabledAt: null,
        updatedBy: null,
        updatedAt: null,
      },
    )
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
    const time = normalizedTimestamp(updatedAt)
    const current = this.#controls.get(safeTeamId)
    const currentRevision = current?.revision ?? null
    if (currentRevision !== expectedRevision) {
      throw new IntegrationTeamControlRevisionConflictError(
        safeTeamId,
        expectedRevision,
        currentRevision,
      )
    }
    const control = snapshotIntegrationTeamControl({
      teamId: safeTeamId,
      revision: (currentRevision ?? 0) + 1,
      enabled,
      disabledBy: enabled ? null : safeActorId,
      disabledAt: enabled ? null : time,
      updatedBy: safeActorId,
      updatedAt: time,
    })
    this.#controls.set(safeTeamId, control)
    return snapshotIntegrationTeamControl(control)
  }
}

export class MemoryIntegrationCredentialStore implements IntegrationCredentialStore {
  readonly #credentials = new Map<
    IntegrationIdentifier,
    Map<IntegrationIdentifier, StoredIntegrationCredential>
  >()

  constructor(private readonly connections: IntegrationConnectionStore) {}

  async load(
    teamId: IntegrationIdentifier,
    connectionId: IntegrationIdentifier,
  ): Promise<StoredIntegrationCredential | null> {
    const safeTeamId = snapshotIntegrationIdentifier(teamId)
    const safeConnectionId = snapshotIntegrationIdentifier(connectionId)
    const credential = this.#credentials.get(safeTeamId)?.get(safeConnectionId)
    return credential ? snapshotStoredIntegrationCredential(credential) : null
  }

  async listPresentConnectionIds(
    teamId: IntegrationIdentifier,
    connectionIds: readonly IntegrationIdentifier[],
  ): Promise<ReadonlySet<IntegrationIdentifier>> {
    const safeTeamId = snapshotIntegrationIdentifier(teamId)
    if (connectionIds.length > maximumIntegrationConnections) {
      throw new TypeError("Too many integration connection identifiers")
    }
    const present = new Set<IntegrationIdentifier>()
    for (const connectionId of connectionIds.map(snapshotIntegrationIdentifier)) {
      if (this.#credentials.get(safeTeamId)?.has(connectionId)) present.add(connectionId)
    }
    return present
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
    const teamCredentials = this.#credentials.get(safeTeamId) ?? new Map()
    const current = teamCredentials.get(safeConnectionId)
    const currentRevision = current?.revision ?? null
    if (currentRevision !== expectedRevision) {
      throw new IntegrationCredentialRevisionConflictError(
        safeConnectionId,
        expectedRevision,
        currentRevision,
      )
    }
    const stored = Object.freeze({
      teamId: safeTeamId,
      connectionId: safeConnectionId,
      credential: snapshotSealedIntegrationCredential(credential),
      revision: (currentRevision ?? 0) + 1,
      updatedAt: normalizedTimestamp(updatedAt),
    })
    teamCredentials.set(safeConnectionId, stored)
    this.#credentials.set(safeTeamId, teamCredentials)
    return snapshotStoredIntegrationCredential(stored)
  }

  async delete(
    teamId: IntegrationIdentifier,
    connectionId: IntegrationIdentifier,
    expectedRevision: number,
  ): Promise<void> {
    const safeTeamId = snapshotIntegrationIdentifier(teamId)
    const safeConnectionId = snapshotIntegrationIdentifier(connectionId)
    const teamCredentials = this.#credentials.get(safeTeamId)
    const current = teamCredentials?.get(safeConnectionId)
    if ((current?.revision ?? null) !== expectedRevision) {
      throw new IntegrationCredentialRevisionConflictError(
        safeConnectionId,
        expectedRevision,
        current?.revision ?? null,
      )
    }
    teamCredentials?.delete(safeConnectionId)
    if (teamCredentials?.size === 0) this.#credentials.delete(safeTeamId)
  }
}

function assertRevision(connection: IntegrationConnection, expectedRevision: number): void {
  if (connection.revision !== expectedRevision) {
    throw new IntegrationConnectionRevisionConflictError(
      connection.id,
      expectedRevision,
      connection.revision,
    )
  }
}

function normalizedTimestamp(input: string): string {
  const milliseconds = Date.parse(input)
  if (!Number.isFinite(milliseconds)) throw new TypeError("Invalid integration timestamp")
  return new Date(milliseconds).toISOString()
}
