import type { SocialCredentialBase, SocialProviderName } from "@screeem/integrations/social"
import type { InstagramCredential } from "@screeem/integrations/social/instagram"
import type { TikTokCredential } from "@screeem/integrations/social/tiktok"

import {
  snapshotIntegrationIdentifier,
  snapshotIntegrationProviderName,
  type IntegrationIdentifier,
  type IntegrationProviderName,
} from "../contract"

export const socialProviderNames = ["instagram", "tiktok"] as const
export const instagramProviderName = snapshotIntegrationProviderName("instagram")
export const tiktokProviderName = snapshotIntegrationProviderName("tiktok")

export type SupportedSocialProviderName = (typeof socialProviderNames)[number]
export type SocialCredential = InstagramCredential | TikTokCredential

export interface StoredSocialCredential {
  readonly version: 1
  readonly generation: IntegrationIdentifier
  readonly issuedAt: string
  readonly accessExpiresAt: string
  readonly refreshExpiresAt: string | null
  readonly refreshEligibleAt: string | null
  readonly credential: SocialCredential
}

export function snapshotSocialProviderName(input: unknown): SupportedSocialProviderName {
  const provider = socialProviderNames.find((candidate) => candidate === input)
  if (!provider) throw new TypeError("Unsupported social provider")
  return provider
}

export function integrationNameForSocialProvider(
  input: SupportedSocialProviderName,
): IntegrationProviderName {
  return snapshotIntegrationProviderName(snapshotSocialProviderName(input))
}

export function socialProviderDisplayName(input: SupportedSocialProviderName) {
  return snapshotSocialProviderName(input) === "instagram" ? "Instagram" : "TikTok"
}

export function snapshotSocialReturnPath(input: unknown) {
  const value = input === undefined ? "/dashboard/integrations" : input
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 512 ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\r\n]/.test(value) ||
    /%5c/i.test(value)
  ) {
    throw new TypeError("Invalid integration return path")
  }
  const base = new URL("https://integration-return.invalid")
  if (new URL(value, base).origin !== base.origin) {
    throw new TypeError("Invalid integration return path")
  }
  return value
}

export function snapshotSocialRedirectUri(input: unknown, provider?: SupportedSocialProviderName) {
  if (typeof input !== "string" || input.length === 0 || input.length > 2_048) {
    throw new TypeError("Invalid social redirect URI")
  }
  const url = new URL(input)
  const localHttp = url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)
  if (
    (url.protocol !== "https:" && !localHttp) ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new TypeError("Invalid social redirect URI")
  }
  if (
    provider === "tiktok" &&
    (url.protocol !== "https:" || url.search || url.toString().length >= 512)
  ) {
    throw new TypeError("Invalid TikTok redirect URI")
  }
  return url.toString()
}

export function snapshotStoredSocialCredential(input: unknown): StoredSocialCredential {
  const value = exactRecord(input, [
    "version",
    "generation",
    "issuedAt",
    "accessExpiresAt",
    "refreshExpiresAt",
    "refreshEligibleAt",
    "credential",
  ])
  if (value.version !== 1) throw new TypeError("Invalid social credential version")
  const credential = snapshotSocialCredential(value.credential)
  const issuedAt = timestamp(value.issuedAt, "social credential issue time")
  const accessExpiresAt = timestamp(value.accessExpiresAt, "social credential expiry")
  const refreshExpiresAt = nullableTimestamp(value.refreshExpiresAt, "social refresh expiry")
  const refreshEligibleAt = nullableTimestamp(value.refreshEligibleAt, "social refresh eligibility")
  if (Date.parse(accessExpiresAt) <= Date.parse(issuedAt)) {
    throw new TypeError("Invalid social credential expiry")
  }
  if (refreshExpiresAt !== null && Date.parse(refreshExpiresAt) <= Date.parse(issuedAt)) {
    throw new TypeError("Invalid social refresh expiry")
  }
  if (credential.provider === "instagram" && refreshEligibleAt === null) {
    throw new TypeError("Invalid Instagram refresh eligibility")
  }
  if (credential.provider === "tiktok" && refreshEligibleAt !== null) {
    throw new TypeError("Invalid TikTok refresh eligibility")
  }
  return Object.freeze({
    version: 1 as const,
    generation: snapshotIntegrationIdentifier(value.generation),
    issuedAt,
    accessExpiresAt,
    refreshExpiresAt,
    refreshEligibleAt,
    credential,
  })
}

export function createStoredSocialCredential(
  generation: IntegrationIdentifier,
  credentialInput: SocialCredential,
  issuedAtInput: string,
) {
  const credential = snapshotSocialCredential(credentialInput)
  const issuedAt = timestamp(issuedAtInput, "social credential issue time")
  const issuedAtMilliseconds = Date.parse(issuedAt)
  return snapshotStoredSocialCredential({
    version: 1,
    generation,
    issuedAt,
    accessExpiresAt: addSeconds(issuedAtMilliseconds, credential.expiresInSeconds),
    refreshExpiresAt: credential.refreshExpiresInSeconds === null
      ? null
      : addSeconds(issuedAtMilliseconds, credential.refreshExpiresInSeconds),
    refreshEligibleAt: credential.provider === "instagram"
      ? addSeconds(issuedAtMilliseconds, 24 * 60 * 60)
      : null,
    credential,
  })
}

function snapshotSocialCredential(input: unknown): SocialCredential {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Invalid social credential")
  }
  const value = input as Record<string, unknown>
  const provider = snapshotSocialProviderName(value.provider)
  const base: SocialCredentialBase = {
    provider,
    accessToken: secret(value.accessToken, "social access token"),
    refreshToken: value.refreshToken === null
      ? null
      : secret(value.refreshToken, "social refresh token"),
    expiresInSeconds: positiveInteger(value.expiresInSeconds, "social access lifetime"),
    refreshExpiresInSeconds: value.refreshExpiresInSeconds === null
      ? null
      : positiveInteger(value.refreshExpiresInSeconds, "social refresh lifetime"),
    scopes: scopeList(value.scopes),
    accountId: identifier(value.accountId, "social account ID", 256),
  }
  if (provider === "instagram") {
    if (base.refreshToken !== null || base.refreshExpiresInSeconds !== null) {
      throw new TypeError("Invalid Instagram credential")
    }
    return Object.freeze({ ...base, provider, refreshToken: null, refreshExpiresInSeconds: null })
  }
  if (base.refreshToken === null || base.refreshExpiresInSeconds === null) {
    throw new TypeError("Invalid TikTok credential")
  }
  return Object.freeze({
    ...base,
    provider,
    refreshToken: base.refreshToken,
    refreshExpiresInSeconds: base.refreshExpiresInSeconds,
  })
}

function exactRecord<const Keys extends readonly string[]>(input: unknown, keys: Keys) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Invalid social credential")
  }
  const descriptors = Object.getOwnPropertyDescriptors(input)
  if (
    Object.getOwnPropertySymbols(input).length > 0 ||
    Object.keys(descriptors).length !== keys.length ||
    !keys.every((key) => key in descriptors && "value" in descriptors[key])
  ) {
    throw new TypeError("Invalid social credential")
  }
  return input as { readonly [Key in Keys[number]]: unknown }
}

function secret(input: unknown, label: string) {
  if (typeof input !== "string" || input.length === 0 || input.length > 16_384) {
    throw new TypeError(`Invalid ${label}`)
  }
  return input
}

function identifier(input: unknown, label: string, maximum: number) {
  if (
    typeof input !== "string" ||
    input.length === 0 ||
    input.length > maximum ||
    !/^[A-Za-z0-9._~-]+$/.test(input)
  ) {
    throw new TypeError(`Invalid ${label}`)
  }
  return input
}

function positiveInteger(input: unknown, label: string) {
  if (!Number.isSafeInteger(input) || (input as number) < 1) {
    throw new TypeError(`Invalid ${label}`)
  }
  return input as number
}

function scopeList(input: unknown) {
  if (!Array.isArray(input) || input.length === 0 || input.length > 32) {
    throw new TypeError("Invalid social scopes")
  }
  const values = input.map((scope) => identifier(scope, "social scope", 128))
  if (new Set(values).size !== values.length) throw new TypeError("Invalid social scopes")
  return Object.freeze(values)
}

function timestamp(input: unknown, label: string) {
  if (typeof input !== "string" || input.length === 0 || input.length > 64) {
    throw new TypeError(`Invalid ${label}`)
  }
  const date = new Date(input)
  if (!Number.isFinite(date.getTime())) throw new TypeError(`Invalid ${label}`)
  return date.toISOString()
}

function nullableTimestamp(input: unknown, label: string) {
  return input === null ? null : timestamp(input, label)
}

function addSeconds(start: number, seconds: number) {
  const value = new Date(start + positiveInteger(seconds, "social credential lifetime") * 1_000)
  if (!Number.isFinite(value.getTime())) throw new TypeError("Invalid social credential lifetime")
  return value.toISOString()
}

export function isSocialProviderName(input: string): input is SocialProviderName {
  return socialProviderNames.some((candidate) => candidate === input)
}

export class SocialCredentialExpiredError extends Error {
  constructor(readonly provider: SupportedSocialProviderName) {
    super(`${socialProviderDisplayName(provider)} credentials have expired`)
    this.name = "SocialCredentialExpiredError"
  }
}
