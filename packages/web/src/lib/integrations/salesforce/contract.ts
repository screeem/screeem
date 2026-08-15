import "server-only"

import {
  snapshotIntegrationIdentifier,
  snapshotIntegrationProviderName,
  type IntegrationErrorCode,
  type IntegrationIdentifier,
} from "../contract"

export const salesforceProviderName = snapshotIntegrationProviderName("salesforce")
export const salesforceApiVersion = "v65.0"

export interface SalesforceAccessCredential {
  readonly accessToken: string
  readonly refreshToken: string
  readonly instanceUrl: string
  readonly identityUrl: string
  readonly issuedAt: string
}

export interface SalesforceCredential extends SalesforceAccessCredential {
  readonly generation: IntegrationIdentifier
}

export interface SalesforceIdentity {
  readonly organizationId: string
  readonly userId: string
  readonly displayName: string
  readonly username: string
}

export interface SalesforceObjectDescription {
  readonly name: string
  readonly label: string
  readonly fields: readonly SalesforceFieldDescription[]
}

export interface SalesforceFieldDescription {
  readonly name: string
  readonly label: string
  readonly type: string
  readonly createable: boolean
  readonly updateable: boolean
  readonly nillable: boolean
  readonly externalId: boolean
  readonly unique: boolean
}

export interface SalesforceUpsertResult {
  readonly id: string | null
  readonly created: boolean
}

export interface SalesforceApiLimits {
  readonly remaining: number | null
  readonly maximum: number | null
}

export type SalesforceErrorCode =
  | Exclude<IntegrationErrorCode, "unknown">
  | "invalid_provider_response"

export class SalesforceError extends Error {
  constructor(
    readonly code: SalesforceErrorCode,
    readonly retryable: boolean,
    readonly retryAfterMs: number | null = null,
  ) {
    super(`Salesforce request failed: ${code}`)
    this.name = "SalesforceError"
  }
}

export function integrationErrorCodeForSalesforce(error: unknown): IntegrationErrorCode {
  if (!(error instanceof SalesforceError)) return "unknown"
  if (error.code === "invalid_provider_response") return "provider_unavailable"
  return error.code
}

export function snapshotSalesforceCredential(input: unknown): SalesforceCredential {
  const value = exactRecord(input, [
    "accessToken",
    "refreshToken",
    "instanceUrl",
    "identityUrl",
    "issuedAt",
    "generation",
  ])
  return Object.freeze({
    ...snapshotSalesforceAccessCredential({
      accessToken: value.accessToken,
      refreshToken: value.refreshToken,
      instanceUrl: value.instanceUrl,
      identityUrl: value.identityUrl,
      issuedAt: value.issuedAt,
    }),
    generation: snapshotIntegrationIdentifier(value.generation),
  })
}

export function snapshotSalesforceAccessCredential(input: unknown): SalesforceAccessCredential {
  const value = exactRecord(input, [
    "accessToken",
    "refreshToken",
    "instanceUrl",
    "identityUrl",
    "issuedAt",
  ])
  return Object.freeze({
    accessToken: secret(value.accessToken, 16_384),
    refreshToken: secret(value.refreshToken, 16_384),
    instanceUrl: snapshotSalesforceInstanceUrl(value.instanceUrl),
    identityUrl: snapshotSalesforceIdentityUrl(value.identityUrl),
    issuedAt: timestamp(value.issuedAt),
  })
}

export function snapshotSalesforceIdentity(input: unknown): SalesforceIdentity {
  const value = exactRecord(input, ["organizationId", "userId", "displayName", "username"])
  return Object.freeze({
    organizationId: boundedString(value.organizationId, 128),
    userId: boundedString(value.userId, 128),
    displayName: boundedString(value.displayName, 160),
    username: boundedString(value.username, 320),
  })
}

export function snapshotSalesforceInstanceUrl(input: unknown): string {
  const url = safeUrl(input)
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    !isSalesforceInstanceHost(url.hostname)
  ) {
    throw new TypeError("Invalid Salesforce instance URL")
  }
  return url.origin
}

export function snapshotSalesforceIdentityUrl(input: unknown): string {
  const url = safeUrl(input)
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    !isSalesforceIdentityHost(url.hostname) ||
    !url.pathname.startsWith("/id/")
  ) {
    throw new TypeError("Invalid Salesforce identity URL")
  }
  return url.toString()
}

export function snapshotSalesforceReturnPath(input: unknown): string {
  if (input === undefined || input === null || input === "") return "/dashboard/forms"
  const value = boundedString(input, 512)
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    throw new TypeError("Invalid integration return path")
  }
  const url = new URL(value, "https://local.invalid")
  if (url.origin !== "https://local.invalid") throw new TypeError("Invalid integration return path")
  return `${url.pathname}${url.search}${url.hash}`
}

export function snapshotSalesforcePublicSiteOrigin(input: unknown, allowLocalHttp: boolean): string {
  const url = safeUrl(input)
  const localHttp = allowLocalHttp &&
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1"].includes(url.hostname)
  if (
    (url.protocol !== "https:" && !localHttp) ||
    url.username || url.password || url.pathname !== "/" || url.search || url.hash
  ) throw new TypeError("Invalid public site URL")
  return url.origin
}

export function snapshotSalesforceIdentityResponse(input: unknown): SalesforceIdentity {
  const value = exactRecord(input, [
    "id",
    "asserted_user",
    "user_id",
    "organization_id",
    "username",
    "nick_name",
    "display_name",
    "email",
    "email_verified",
    "first_name",
    "last_name",
    "timezone",
    "photos",
    "addr_street",
    "addr_city",
    "addr_state",
    "addr_country",
    "addr_zip",
    "mobile_phone",
    "mobile_phone_verified",
    "is_lightning_login_user",
    "status",
    "urls",
    "active",
    "user_type",
    "language",
    "locale",
    "utcOffset",
    "last_modified_date",
    "is_app_installed",
  ], true)
  return snapshotSalesforceIdentity({
    organizationId: value.organization_id,
    userId: value.user_id,
    displayName: value.display_name,
    username: value.username,
  })
}

function isSalesforceInstanceHost(hostname: string) {
  const host = hostname.toLowerCase()
  return [".salesforce.com"].some(
    (suffix) => host.endsWith(suffix) && host.length > suffix.length,
  )
}

function isSalesforceIdentityHost(hostname: string) {
  const host = hostname.toLowerCase()
  return host === "login.salesforce.com" || host === "test.salesforce.com"
}

function safeUrl(input: unknown) {
  const value = boundedString(input, 2_048)
  try {
    return new URL(value)
  } catch {
    throw new TypeError("Invalid Salesforce URL")
  }
}

function exactRecord(input: unknown, keys: readonly string[], allowUnknown = false) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("Invalid Salesforce value")
  const descriptors = Object.getOwnPropertyDescriptors(input)
  if (Object.getOwnPropertySymbols(input).length > 0) throw new TypeError("Invalid Salesforce value")
  if (!allowUnknown && Object.keys(descriptors).some((key) => !keys.includes(key))) {
    throw new TypeError("Invalid Salesforce value")
  }
  const result: Record<string, unknown> = {}
  for (const key of keys) {
    const descriptor = descriptors[key]
    if (descriptor && "value" in descriptor) result[key] = descriptor.value
  }
  return result
}

function boundedString(input: unknown, maximum: number) {
  if (typeof input !== "string" || input.length === 0 || input.length > maximum) {
    throw new TypeError("Invalid Salesforce value")
  }
  return input
}

function secret(input: unknown, maximum: number) {
  return boundedString(input, maximum)
}

function timestamp(input: unknown) {
  const value = boundedString(input, 64)
  const date = new Date(value)
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) throw new TypeError("Invalid Salesforce timestamp")
  return value
}
