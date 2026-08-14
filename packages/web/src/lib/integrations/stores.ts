import "server-only"

import {
  snapshotIntegrationIdentifier,
  type IntegrationConnection,
  IntegrationConnectionStatus,
  IntegrationErrorCode,
  IntegrationHealthStatus,
  IntegrationIdentifier,
  IntegrationProviderName,
  IntegrationTeamControl,
} from "./contract"

export interface CreateIntegrationConnectionInput {
  readonly id?: IntegrationIdentifier
  readonly provider: IntegrationProviderName
  readonly status: IntegrationConnectionStatus
  readonly health?: IntegrationHealthStatus
  readonly enabled?: boolean
  readonly displayName?: string | null
  readonly externalAccountId?: string | null
  readonly lastErrorCode?: IntegrationErrorCode | null
  readonly lastCheckedAt?: string | null
  readonly actorId: IntegrationIdentifier
  readonly createdAt: string
}

export interface UpdateIntegrationAuthStateInput {
  readonly status: IntegrationConnectionStatus
  readonly displayName: string | null
  readonly externalAccountId: string | null
  readonly actorId: IntegrationIdentifier
  readonly updatedAt: string
}

export interface RecordIntegrationHealthInput {
  readonly health: IntegrationHealthStatus
  readonly lastErrorCode: IntegrationErrorCode | null
  readonly checkedAt: string
  readonly actorId: IntegrationIdentifier
  readonly updatedAt: string
}

export interface IntegrationConnectionStore {
  list(teamId: IntegrationIdentifier): Promise<readonly IntegrationConnection[]>
  get(teamId: IntegrationIdentifier, connectionId: IntegrationIdentifier): Promise<IntegrationConnection>
  getByProvider(
    teamId: IntegrationIdentifier,
    provider: IntegrationProviderName,
  ): Promise<IntegrationConnection | null>
  create(
    teamId: IntegrationIdentifier,
    input: CreateIntegrationConnectionInput,
  ): Promise<IntegrationConnection>
  updateAuthState(
    teamId: IntegrationIdentifier,
    connectionId: IntegrationIdentifier,
    expectedRevision: number,
    input: UpdateIntegrationAuthStateInput,
  ): Promise<IntegrationConnection>
  recordHealth(
    teamId: IntegrationIdentifier,
    connectionId: IntegrationIdentifier,
    expectedRevision: number,
    input: RecordIntegrationHealthInput,
  ): Promise<IntegrationConnection>
  setEnabled(
    teamId: IntegrationIdentifier,
    connectionId: IntegrationIdentifier,
    expectedRevision: number,
    enabled: boolean,
    actorId: IntegrationIdentifier,
    updatedAt: string,
  ): Promise<IntegrationConnection>
}

export interface IntegrationTeamControlStore {
  get(teamId: IntegrationIdentifier): Promise<IntegrationTeamControl>
  setEnabled(
    teamId: IntegrationIdentifier,
    expectedRevision: number | null,
    enabled: boolean,
    actorId: IntegrationIdentifier,
    updatedAt: string,
  ): Promise<IntegrationTeamControl>
}

export class SealedIntegrationCredential {
  readonly #keyId: string
  readonly #sealed: string

  private constructor(keyId: string, sealed: string) {
    this.#keyId = keyId
    this.#sealed = sealed
    Object.freeze(this)
  }

  static create(keyId: unknown, sealed: unknown): SealedIntegrationCredential {
    validateSealedCredentialFields(keyId, sealed)
    return new SealedIntegrationCredential(keyId as string, sealed as string)
  }

  get keyId(): string {
    return this.#keyId
  }

  get sealed(): string {
    return this.#sealed
  }

  toJSON(): string {
    return "[REDACTED]"
  }
}

export interface StoredIntegrationCredential {
  readonly teamId: IntegrationIdentifier
  readonly connectionId: IntegrationIdentifier
  readonly credential: SealedIntegrationCredential
  readonly revision: number
  readonly updatedAt: string
}

export interface IntegrationCredentialStore {
  load(
    teamId: IntegrationIdentifier,
    connectionId: IntegrationIdentifier,
  ): Promise<StoredIntegrationCredential | null>
  listPresentConnectionIds(
    teamId: IntegrationIdentifier,
    connectionIds: readonly IntegrationIdentifier[],
  ): Promise<ReadonlySet<IntegrationIdentifier>>
  compareAndSet(
    teamId: IntegrationIdentifier,
    connectionId: IntegrationIdentifier,
    expectedRevision: number | null,
    credential: SealedIntegrationCredential,
    updatedAt: string,
  ): Promise<StoredIntegrationCredential>
  delete(
    teamId: IntegrationIdentifier,
    connectionId: IntegrationIdentifier,
    expectedRevision: number,
  ): Promise<void>
}

export type IntegrationStoreErrorCode =
  | "integration_connection_not_found"
  | "integration_connection_already_exists"
  | "integration_connection_revision_conflict"
  | "integration_team_control_revision_conflict"
  | "integration_credential_revision_conflict"
  | "integration_store_error"
  | "invalid_stored_integration_credential"

export class IntegrationStoreError extends Error {
  constructor(
    readonly code: IntegrationStoreErrorCode,
    message: string,
  ) {
    super(message)
    this.name = "IntegrationStoreError"
  }
}

export class IntegrationConnectionNotFoundError extends IntegrationStoreError {
  constructor(readonly connectionId: IntegrationIdentifier) {
    super("integration_connection_not_found", `Integration connection ${connectionId} was not found`)
  }
}

export class IntegrationConnectionAlreadyExistsError extends IntegrationStoreError {
  constructor(readonly provider: IntegrationProviderName) {
    super(
      "integration_connection_already_exists",
      `An integration connection already exists for ${provider}`,
    )
  }
}

export class IntegrationConnectionRevisionConflictError extends IntegrationStoreError {
  constructor(
    readonly connectionId: IntegrationIdentifier,
    readonly expectedRevision: number,
    readonly currentRevision: number | null,
  ) {
    super(
      "integration_connection_revision_conflict",
      `Integration connection revision conflict for ${connectionId}`,
    )
  }
}

export class IntegrationCredentialRevisionConflictError extends IntegrationStoreError {
  constructor(
    readonly connectionId: IntegrationIdentifier,
    readonly expectedRevision: number | null,
    readonly currentRevision: number | null,
  ) {
    super(
      "integration_credential_revision_conflict",
      `Integration credential revision conflict for ${connectionId}`,
    )
  }
}

export class IntegrationTeamControlRevisionConflictError extends IntegrationStoreError {
  constructor(
    readonly teamId: IntegrationIdentifier,
    readonly expectedRevision: number | null,
    readonly currentRevision: number | null,
  ) {
    super(
      "integration_team_control_revision_conflict",
      `Integration team control revision conflict for ${teamId}`,
    )
  }
}

export function snapshotSealedIntegrationCredential(input: unknown): SealedIntegrationCredential {
  if (input instanceof SealedIntegrationCredential) {
    return SealedIntegrationCredential.create(input.keyId, input.sealed)
  }
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new TypeError("Invalid sealed integration credential")
  }
  const descriptors = safeDescriptors(input, "sealed integration credential")
  const keys = Object.keys(descriptors)
  let symbols: readonly symbol[]
  try {
    symbols = Object.getOwnPropertySymbols(input)
  } catch {
    throw new TypeError("Invalid sealed integration credential")
  }
  if (
    keys.length !== 2 ||
    !("keyId" in descriptors) ||
    !("sealed" in descriptors) ||
    symbols.length > 0
  ) {
    throw new TypeError("Invalid sealed integration credential")
  }
  const keyId = dataValue(descriptors.keyId, "sealed integration credential")
  const sealed = dataValue(descriptors.sealed, "sealed integration credential")
  return SealedIntegrationCredential.create(keyId, sealed)
}

export function snapshotStoredIntegrationCredential(input: unknown): StoredIntegrationCredential {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new TypeError("Invalid stored integration credential")
  }
  const descriptors = safeDescriptors(input, "stored integration credential")
  const keys = Object.keys(descriptors)
  let symbols: readonly symbol[]
  try {
    symbols = Object.getOwnPropertySymbols(input)
  } catch {
    throw new TypeError("Invalid stored integration credential")
  }
  const expected = ["teamId", "connectionId", "credential", "revision", "updatedAt"]
  if (keys.length !== expected.length || expected.some((key) => !(key in descriptors)) || symbols.length) {
    throw new TypeError("Invalid stored integration credential")
  }
  const revision = dataValue(descriptors.revision, "stored integration credential")
  const updatedAt = dataValue(descriptors.updatedAt, "stored integration credential")
  if (!Number.isSafeInteger(revision) || (revision as number) < 1) {
    throw new TypeError("Invalid stored integration credential")
  }
  if (typeof updatedAt !== "string" || !Number.isFinite(Date.parse(updatedAt))) {
    throw new TypeError("Invalid stored integration credential")
  }
  return Object.freeze({
    teamId: snapshotIntegrationIdentifier(
      dataValue(descriptors.teamId, "stored integration credential"),
    ),
    connectionId: snapshotIntegrationIdentifier(
      dataValue(descriptors.connectionId, "stored integration credential"),
    ),
    credential: snapshotSealedIntegrationCredential(
      dataValue(descriptors.credential, "stored integration credential"),
    ),
    revision: revision as number,
    updatedAt: new Date(updatedAt).toISOString(),
  })
}

function safeDescriptors(input: object, name: string): PropertyDescriptorMap {
  try {
    return Object.getOwnPropertyDescriptors(input)
  } catch {
    throw new TypeError(`Invalid ${name}`)
  }
}

function dataValue(descriptor: PropertyDescriptor | undefined, name: string): unknown {
  if (!descriptor || !("value" in descriptor)) throw new TypeError(`Invalid ${name}`)
  return descriptor.value
}

function validateSealedCredentialFields(keyId: unknown, sealed: unknown): void {
  if (typeof keyId !== "string" || !/^[A-Za-z0-9._-]{1,128}$/.test(keyId)) {
    throw new TypeError("Invalid sealed integration credential")
  }
  if (
    typeof sealed !== "string" ||
    !/^v[0-9]+\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/.test(sealed) ||
    new TextEncoder().encode(sealed).byteLength > 131_072
  ) {
    throw new TypeError("Invalid sealed integration credential")
  }
}
