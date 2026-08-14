export const integrationConnectionStatuses = [
  "connected",
  "reauthorization_required",
  "disconnected",
] as const

export const integrationHealthStatuses = ["unknown", "healthy", "degraded"] as const

export const integrationAvailabilityReasons = [
  "available",
  "global_disabled",
  "team_disabled",
  "connection_disabled",
  "connection_unavailable",
  "credentials_unavailable",
  "provider_unregistered",
] as const

export const integrationErrorCodes = [
  "authentication_failed",
  "authorization_failed",
  "invalid_configuration",
  "invalid_request",
  "provider_unavailable",
  "rate_limited",
  "unknown",
] as const

export const maximumIntegrationConnections = 50

export type IntegrationConnectionStatus = (typeof integrationConnectionStatuses)[number]
export type IntegrationHealthStatus = (typeof integrationHealthStatuses)[number]
export type IntegrationAvailabilityReason = (typeof integrationAvailabilityReasons)[number]
export type IntegrationErrorCode = (typeof integrationErrorCodes)[number]

declare const integrationIdentifier: unique symbol
declare const integrationProviderName: unique symbol

export type IntegrationIdentifier = string & { readonly [integrationIdentifier]: true }
export type IntegrationProviderName = string & { readonly [integrationProviderName]: true }

export interface IntegrationConnection {
  readonly id: IntegrationIdentifier
  readonly teamId: IntegrationIdentifier
  readonly provider: IntegrationProviderName
  readonly revision: number
  readonly status: IntegrationConnectionStatus
  readonly health: IntegrationHealthStatus
  readonly enabled: boolean
  readonly displayName: string | null
  readonly externalAccountId: string | null
  readonly lastErrorCode: IntegrationErrorCode | null
  readonly lastCheckedAt: string | null
  readonly createdBy: IntegrationIdentifier | null
  readonly createdAt: string
  readonly updatedBy: IntegrationIdentifier | null
  readonly updatedAt: string
  readonly disabledBy: IntegrationIdentifier | null
  readonly disabledAt: string | null
  readonly disconnectedBy: IntegrationIdentifier | null
  readonly disconnectedAt: string | null
}

export interface IntegrationTeamControl {
  readonly teamId: IntegrationIdentifier
  readonly revision: number | null
  readonly enabled: boolean
  readonly disabledBy: IntegrationIdentifier | null
  readonly disabledAt: string | null
  readonly updatedBy: IntegrationIdentifier | null
  readonly updatedAt: string | null
}

export interface IntegrationConnectionSummary {
  readonly id: IntegrationIdentifier
  readonly provider: IntegrationProviderName
  readonly revision: number
  readonly providerDisplayName: string
  readonly status: IntegrationConnectionStatus
  readonly health: IntegrationHealthStatus
  readonly enabled: boolean
  readonly availability: IntegrationAvailabilityReason
  readonly displayName: string | null
  readonly externalAccountId: string | null
  readonly lastErrorCode: IntegrationErrorCode | null
  readonly lastCheckedAt: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

export interface IntegrationListResponse {
  readonly integrations: readonly IntegrationConnectionSummary[]
}

export interface IntegrationStatusResponse {
  readonly integration: IntegrationConnectionSummary
}

const connectionKeys = [
  "id",
  "teamId",
  "provider",
  "revision",
  "status",
  "health",
  "enabled",
  "displayName",
  "externalAccountId",
  "lastErrorCode",
  "lastCheckedAt",
  "createdBy",
  "createdAt",
  "updatedBy",
  "updatedAt",
  "disabledBy",
  "disabledAt",
  "disconnectedBy",
  "disconnectedAt",
] as const

const teamControlKeys = [
  "teamId",
  "revision",
  "enabled",
  "disabledBy",
  "disabledAt",
  "updatedBy",
  "updatedAt",
] as const

const summaryKeys = [
  "id",
  "provider",
  "revision",
  "providerDisplayName",
  "status",
  "health",
  "enabled",
  "availability",
  "displayName",
  "externalAccountId",
  "lastErrorCode",
  "lastCheckedAt",
  "createdAt",
  "updatedAt",
] as const

export function snapshotIntegrationProviderName(input: unknown): IntegrationProviderName {
  const name = boundedString(input, 64, "integration provider")
  if (!/^[a-z][a-z0-9_-]*$/.test(name)) {
    throw new TypeError("Invalid integration provider")
  }
  return name as IntegrationProviderName
}

export function snapshotIntegrationIdentifier(input: unknown): IntegrationIdentifier {
  const value = boundedString(input, 36, "integration identifier")
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new TypeError("Invalid integration identifier")
  }
  return value.toLowerCase() as IntegrationIdentifier
}

export function snapshotIntegrationConnection(input: unknown): IntegrationConnection {
  const value = exactRecord(input, connectionKeys, "integration connection")
  const connection: IntegrationConnection = {
    id: snapshotIntegrationIdentifier(value.id),
    teamId: snapshotIntegrationIdentifier(value.teamId),
    provider: snapshotIntegrationProviderName(value.provider),
    revision: positiveInteger(value.revision, "integration connection revision"),
    status: connectionStatus(value.status),
    health: healthStatus(value.health),
    enabled: booleanValue(value.enabled, "integration enabled state"),
    displayName: nullableString(value.displayName, 160, "integration display name"),
    externalAccountId: nullableString(
      value.externalAccountId,
      256,
      "integration external account ID",
    ),
    lastErrorCode: nullableErrorCode(value.lastErrorCode),
    lastCheckedAt: nullableTimestamp(value.lastCheckedAt, "integration check time"),
    createdBy: nullableIdentifier(value.createdBy),
    createdAt: timestamp(value.createdAt, "integration creation time"),
    updatedBy: nullableIdentifier(value.updatedBy),
    updatedAt: timestamp(value.updatedAt, "integration update time"),
    disabledBy: nullableIdentifier(value.disabledBy),
    disabledAt: nullableTimestamp(value.disabledAt, "integration disabled time"),
    disconnectedBy: nullableIdentifier(value.disconnectedBy),
    disconnectedAt: nullableTimestamp(value.disconnectedAt, "integration disconnected time"),
  }
  if (connection.enabled === (connection.disabledAt !== null)) {
    throw new TypeError("Invalid integration disabled state")
  }
  if ((connection.status === "disconnected") !== (connection.disconnectedAt !== null)) {
    throw new TypeError("Invalid integration disconnected state")
  }
  return Object.freeze(connection)
}

export function snapshotIntegrationTeamControl(input: unknown): IntegrationTeamControl {
  const value = exactRecord(input, teamControlKeys, "integration team control")
  const control: IntegrationTeamControl = {
    teamId: snapshotIntegrationIdentifier(value.teamId),
    revision: nullableRevision(value.revision),
    enabled: booleanValue(value.enabled, "integration team enabled state"),
    disabledBy: nullableIdentifier(value.disabledBy),
    disabledAt: nullableTimestamp(value.disabledAt, "integration disabled time"),
    updatedBy: nullableIdentifier(value.updatedBy),
    updatedAt: nullableTimestamp(value.updatedAt, "integration update time"),
  }
  if (control.revision === null) {
    if (
      !control.enabled ||
      control.disabledBy !== null ||
      control.disabledAt !== null ||
      control.updatedBy !== null ||
      control.updatedAt !== null
    ) {
      throw new TypeError("Invalid default integration team control")
    }
  } else {
    if (control.enabled === (control.disabledAt !== null) || control.updatedAt === null) {
      throw new TypeError("Invalid integration team control state")
    }
  }
  return Object.freeze(control)
}

export function snapshotIntegrationConnectionSummary(
  input: unknown,
): IntegrationConnectionSummary {
  const value = exactRecord(input, summaryKeys, "integration connection summary")
  return Object.freeze({
    id: snapshotIntegrationIdentifier(value.id),
    provider: snapshotIntegrationProviderName(value.provider),
    revision: positiveInteger(value.revision, "integration connection revision"),
    providerDisplayName: boundedString(
      value.providerDisplayName,
      80,
      "integration provider display name",
    ),
    status: connectionStatus(value.status),
    health: healthStatus(value.health),
    enabled: booleanValue(value.enabled, "integration enabled state"),
    availability: availabilityReason(value.availability),
    displayName: nullableString(value.displayName, 160, "integration display name"),
    externalAccountId: nullableString(
      value.externalAccountId,
      256,
      "integration external account ID",
    ),
    lastErrorCode: nullableErrorCode(value.lastErrorCode),
    lastCheckedAt: nullableTimestamp(value.lastCheckedAt, "integration check time"),
    createdAt: timestamp(value.createdAt, "integration creation time"),
    updatedAt: timestamp(value.updatedAt, "integration update time"),
  })
}

export function snapshotIntegrationListResponse(input: unknown): IntegrationListResponse {
  const value = exactRecord(input, ["integrations"], "integration list response")
  if (!Array.isArray(value.integrations) || value.integrations.length > maximumIntegrationConnections) {
    throw new TypeError("Invalid integration list response")
  }
  return Object.freeze({
    integrations: Object.freeze(value.integrations.map(snapshotIntegrationConnectionSummary)),
  })
}

export function snapshotIntegrationStatusResponse(input: unknown): IntegrationStatusResponse {
  const value = exactRecord(input, ["integration"], "integration status response")
  return Object.freeze({
    integration: snapshotIntegrationConnectionSummary(value.integration),
  })
}

function connectionStatus(input: unknown): IntegrationConnectionStatus {
  const status = integrationConnectionStatuses.find((candidate) => candidate === input)
  if (!status) throw new TypeError("Invalid integration connection status")
  return status
}

function healthStatus(input: unknown): IntegrationHealthStatus {
  const health = integrationHealthStatuses.find((candidate) => candidate === input)
  if (!health) throw new TypeError("Invalid integration health status")
  return health
}

function availabilityReason(input: unknown): IntegrationAvailabilityReason {
  const reason = integrationAvailabilityReasons.find((candidate) => candidate === input)
  if (!reason) throw new TypeError("Invalid integration availability")
  return reason
}

function nullableErrorCode(input: unknown): IntegrationErrorCode | null {
  if (input === null) return null
  const code = integrationErrorCodes.find((candidate) => candidate === input)
  if (!code) throw new TypeError("Invalid integration error code")
  return code
}

function nullableIdentifier(input: unknown): IntegrationIdentifier | null {
  return input === null ? null : snapshotIntegrationIdentifier(input)
}

function positiveInteger(input: unknown, name: string): number {
  if (!Number.isSafeInteger(input) || (input as number) < 1) throw new TypeError(`Invalid ${name}`)
  return input as number
}

function nullableRevision(input: unknown): number | null {
  return input === null ? null : positiveInteger(input, "integration revision")
}

function timestamp(input: unknown, name: string): string {
  const value = boundedString(input, 64, name)
  const milliseconds = Date.parse(value)
  if (!Number.isFinite(milliseconds)) throw new TypeError(`Invalid ${name}`)
  return new Date(milliseconds).toISOString()
}

function nullableTimestamp(input: unknown, name: string): string | null {
  return input === null ? null : timestamp(input, name)
}

function nullableString(input: unknown, maximum: number, name: string): string | null {
  return input === null ? null : boundedString(input, maximum, name)
}

function boundedString(input: unknown, maximum: number, name: string): string {
  if (typeof input !== "string" || input.length === 0 || input.length > maximum) {
    throw new TypeError(`Invalid ${name}`)
  }
  return input
}

function booleanValue(input: unknown, name: string): boolean {
  if (typeof input !== "boolean") throw new TypeError(`Invalid ${name}`)
  return input
}

function exactRecord<const Keys extends readonly string[]>(
  input: unknown,
  keys: Keys,
  name: string,
): { readonly [Key in Keys[number]]: unknown } {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new TypeError(`Invalid ${name}`)
  }
  let descriptors: PropertyDescriptorMap
  try {
    descriptors = Object.getOwnPropertyDescriptors(input)
  } catch {
    throw new TypeError(`Invalid ${name}`)
  }
  let symbols: readonly symbol[]
  try {
    symbols = Object.getOwnPropertySymbols(input)
  } catch {
    throw new TypeError(`Invalid ${name}`)
  }
  if (symbols.length > 0) throw new TypeError(`Invalid ${name}`)
  const names = Object.keys(descriptors)
  if (names.length !== keys.length || keys.some((key) => !(key in descriptors))) {
    throw new TypeError(`Invalid ${name}`)
  }
  const result: Record<string, unknown> = Object.create(null)
  for (const key of keys) {
    const descriptor = descriptors[key]
    if (!descriptor || !("value" in descriptor)) throw new TypeError(`Invalid ${name}`)
    result[key] = descriptor.value
  }
  return result as { readonly [Key in Keys[number]]: unknown }
}
