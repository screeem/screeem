import "server-only"

import {
  InvalidSocialConfigurationError,
  type ConnectedSocialAccount,
  type SocialAuthorization,
  type SocialAuthorizationRequest,
  type SocialCodeExchangeRequest,
  type SocialCredentialRevocation,
} from "@screeem/integrations/social"
import {
  createInstagramProvider,
  type InstagramCredential,
  type InstagramProvider,
} from "@screeem/integrations/social/instagram"
import {
  createTikTokProvider,
  type TikTokCredential,
  type TikTokProvider,
} from "@screeem/integrations/social/tiktok"
import { snapshotIntegrationType } from "@screeem/forms"
import { Effect } from "effect"

import {
  AesGcmIntegrationCredentialCipher,
  snapshotIntegrationCredentialKeyConfiguration,
} from "../credential-cipher"
import type { IntegrationProviderDefinition } from "../provider-registry"
import { defineIntegrationProvider } from "../provider-registry"
import {
  PostgresIntegrationConnectionStore,
  PostgresIntegrationExecutionStore,
} from "../postgres-store"
import { PostgresIntegrationProvisioningStore } from "../provisioning-store"
import {
  integrationNameForSocialProvider,
  SocialCredentialExpiredError,
  snapshotSocialProviderName,
  snapshotSocialRedirectUri,
  snapshotSocialReturnPath,
  snapshotStoredSocialCredential,
  socialProviderDisplayName,
  type SocialCredential,
  type SupportedSocialProviderName,
} from "./contract"
import {
  SocialConnectionService,
  SocialDisconnectRefreshInProgressError,
  type SocialConnectionProvider,
} from "./service"
import {
  PostgresSocialDisconnectLeaseStore,
  PostgresSocialOAuthStateStore,
} from "./stores"

export interface SocialIntegrationClient {
  readonly provider: SocialConnectionProvider
  readonly credential: SocialCredential
}

export function createSocialIntegrationProviderDefinition(
  providerInput: SupportedSocialProviderName,
): IntegrationProviderDefinition<SocialIntegrationClient> {
  const provider = snapshotSocialProviderName(providerInput)
  return defineIntegrationProvider({
    name: integrationNameForSocialProvider(provider),
    type: snapshotIntegrationType("social"),
    displayName: socialProviderDisplayName(provider),
    enabled: socialEnvironmentConfigured(provider),
    open: async ({ connection, credential, signal }) => {
      signal?.throwIfAborted()
      const runtime = await socialRuntime(provider)
      const envelope = snapshotStoredSocialCredential(await runtime.cipher.open(
        {
          teamId: connection.teamId,
          connectionId: connection.id,
          provider: connection.provider,
        },
        credential.credential,
      ))
      if (
        envelope.credential.provider !== provider ||
        envelope.credential.accountId !== connection.externalAccountId
      ) {
        throw new TypeError("Stored social credential does not match its connection")
      }
      if (Date.parse(envelope.accessExpiresAt) <= Date.now()) {
        throw new SocialCredentialExpiredError(provider)
      }
      signal?.throwIfAborted()
      return Object.freeze({ provider: runtime.provider, credential: envelope.credential })
    },
  })
}

export async function createSocialConnectionService(
  providerInput: SupportedSocialProviderName,
) {
  const provider = snapshotSocialProviderName(providerInput)
  if (!socialEnvironmentConfigured(provider)) {
    throw new InvalidSocialConfigurationError({
      provider,
      reason: "integration is disabled or incomplete",
    })
  }
  const runtime = await socialRuntime(provider)
  return new SocialConnectionService({
    provider: runtime.provider,
    redirectUri: callbackUri(provider),
    states: new PostgresSocialOAuthStateStore(),
    cipher: runtime.cipher,
    provisioning: new PostgresIntegrationProvisioningStore(),
    connections: new PostgresIntegrationConnectionStore(),
    execution: new PostgresIntegrationExecutionStore(),
    disconnectLeases: new PostgresSocialDisconnectLeaseStore(),
  })
}

export async function disconnectSocialConnection(
  providerInput: SupportedSocialProviderName,
  teamId: Parameters<SocialConnectionService["disconnect"]>[0],
  actorId: Parameters<SocialConnectionService["disconnect"]>[1],
) {
  const provider = snapshotSocialProviderName(providerInput)
  const providerName = integrationNameForSocialProvider(provider)
  const provisioning = new PostgresIntegrationProvisioningStore()
  const started = await provisioning.beginDisconnect(
    teamId,
    providerName,
    actorId,
    new Date().toISOString(),
  )
  if (!started || started.connection.status === "disconnected") {
    return Object.freeze({
      connection: started?.connection ?? null,
      providerAccessRemoved: null,
    })
  }
  let runtime: Awaited<ReturnType<typeof socialRuntime>>
  try {
    runtime = await socialRuntime(provider)
  } catch {
    if (!started.credential) {
      const connection = await provisioning.completeDisconnect(
        teamId,
        started.connection.id,
        started.connection.revision,
        null,
        actorId,
        new Date().toISOString(),
      )
      return Object.freeze({ connection, providerAccessRemoved: false })
    }
    const leases = new PostgresSocialDisconnectLeaseStore()
    const owner = socialDisconnectLeaseOwnerToken()
    const acquired = await leases.acquire(teamId, started.connection.id, owner)
    if (!acquired) throw new SocialDisconnectRefreshInProgressError()
    try {
      const current = await provisioning.beginDisconnect(
        teamId,
        providerName,
        actorId,
        new Date().toISOString(),
      )
      if (!current || current.connection.status === "disconnected") {
        return Object.freeze({
          connection: current?.connection ?? null,
          providerAccessRemoved: null,
        })
      }
      if (current.connection.id !== started.connection.id) {
        throw new TypeError("Social disconnect lease no longer matches its connection")
      }
      const renewed = await leases.renew(teamId, current.connection.id, owner)
      if (!renewed) throw new SocialDisconnectRefreshInProgressError()
      const connection = await provisioning.completeDisconnect(
        teamId,
        current.connection.id,
        current.connection.revision,
        current.credential?.revision ?? null,
        actorId,
        new Date().toISOString(),
      )
      return Object.freeze({ connection, providerAccessRemoved: false })
    } finally {
      await leases.release(teamId, started.connection.id, owner).catch(() => undefined)
    }
  }
  return new SocialConnectionService({
    provider: runtime.provider,
    redirectUri: null,
    states: new PostgresSocialOAuthStateStore(),
    cipher: runtime.cipher,
    provisioning,
    connections: new PostgresIntegrationConnectionStore(),
    execution: new PostgresIntegrationExecutionStore(),
    disconnectLeases: new PostgresSocialDisconnectLeaseStore(),
  }).finishDisconnect(teamId, actorId, started)
}

function socialDisconnectLeaseOwnerToken() {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url")
}

export function createSocialReturnUrl(
  returnPath: string,
  providerInput: SupportedSocialProviderName,
  status: "connected" | "error",
  reason?: "account_in_use" | "account_switch" | "configuration" | "disconnecting" | "forbidden",
) {
  const provider = snapshotSocialProviderName(providerInput)
  const url = new URL(snapshotSocialReturnPath(returnPath), publicSiteOrigin())
  url.searchParams.set("integration", provider)
  url.searchParams.set("status", status)
  if (status === "error" && reason) url.searchParams.set("reason", reason)
  return url
}

export function socialEnvironmentConfigured(providerInput: SupportedSocialProviderName) {
  const provider = snapshotSocialProviderName(providerInput)
  const common = Boolean(
    process.env.INTEGRATION_CREDENTIAL_KEY_ID &&
    process.env.INTEGRATION_CREDENTIAL_KEY &&
    (process.env.NEXT_PUBLIC_SITE_URL || process.env.NODE_ENV !== "production"),
  )
  const providerConfigured = provider === "instagram"
    ? process.env.INSTAGRAM_INTEGRATION_ENABLED === "true" &&
      validProviderIdentifier(process.env.INSTAGRAM_CLIENT_ID) &&
      validProviderSecret(process.env.INSTAGRAM_CLIENT_SECRET)
    : process.env.TIKTOK_INTEGRATION_ENABLED === "true" &&
      validProviderIdentifier(process.env.TIKTOK_CLIENT_KEY) &&
      validProviderSecret(process.env.TIKTOK_CLIENT_SECRET) &&
      Boolean(process.env.TIKTOK_VERIFIED_MEDIA_URL_PREFIXES)
  if (!common || !providerConfigured) return false
  try {
    callbackUri(provider)
    snapshotIntegrationCredentialKeyConfiguration(
      process.env.INTEGRATION_CREDENTIAL_KEY_ID,
      process.env.INTEGRATION_CREDENTIAL_KEY,
    )
    if (
      provider === "instagram" &&
      process.env.INSTAGRAM_API_VERSION !== undefined &&
      !/^v(?:[1-9]|[1-9][0-9])\.0$/.test(process.env.INSTAGRAM_API_VERSION)
    ) return false
    if (provider === "tiktok") {
      const prefixes = verifiedMediaUrlPrefixes()
      if (prefixes.length === 0) return false
      prefixes.forEach(validateVerifiedMediaUrlPrefix)
    }
    return true
  } catch {
    return false
  }
}

async function socialRuntime(provider: SupportedSocialProviderName) {
  const key = snapshotIntegrationCredentialKeyConfiguration(
    requiredEnvironment("INTEGRATION_CREDENTIAL_KEY_ID"),
    requiredEnvironment("INTEGRATION_CREDENTIAL_KEY"),
  )
  const cipher = await AesGcmIntegrationCredentialCipher.create(key.keyId, key.encodedKey)
  return Object.freeze({ provider: await socialProvider(provider), cipher })
}

async function socialProvider(provider: SupportedSocialProviderName): Promise<SocialConnectionProvider> {
  if (provider === "instagram") {
    const resolved = await Effect.runPromise(createInstagramProvider({
      clientId: requiredEnvironment("INSTAGRAM_CLIENT_ID"),
      clientSecret: requiredEnvironment("INSTAGRAM_CLIENT_SECRET"),
      apiVersion: process.env.INSTAGRAM_API_VERSION,
    }))
    return instagramBoundary(resolved)
  }
  const resolved = await Effect.runPromise(createTikTokProvider({
    clientKey: requiredEnvironment("TIKTOK_CLIENT_KEY"),
    clientSecret: requiredEnvironment("TIKTOK_CLIENT_SECRET"),
    verifiedMediaUrlPrefixes: verifiedMediaUrlPrefixes(),
  }))
  return tiktokBoundary(resolved)
}

function instagramBoundary(provider: InstagramProvider): SocialConnectionProvider {
  return Object.freeze({
    name: "instagram" as const,
    authorizationUrl: (request: SocialAuthorizationRequest): Promise<SocialAuthorization> =>
      Effect.runPromise(provider.authorizationUrl(request)),
    exchangeCode: async (request: SocialCodeExchangeRequest) =>
      Effect.runPromise(provider.exchangeCode(request)) as Promise<ConnectedSocialAccount<SocialCredential>>,
    refreshCredential: (credential: SocialCredential): Promise<SocialCredential> => {
      if (credential.provider !== "instagram") throw new TypeError("Invalid Instagram credential")
      return Effect.runPromise(provider.refreshCredential(credential as InstagramCredential))
    },
    revokeCredential: (credential: SocialCredential): Promise<SocialCredentialRevocation> => {
      if (credential.provider !== "instagram") throw new TypeError("Invalid Instagram credential")
      return Effect.runPromise(provider.revokeCredential(credential as InstagramCredential))
    },
  })
}

function tiktokBoundary(provider: TikTokProvider): SocialConnectionProvider {
  return Object.freeze({
    name: "tiktok" as const,
    authorizationUrl: (request: SocialAuthorizationRequest): Promise<SocialAuthorization> =>
      Effect.runPromise(provider.authorizationUrl(request)),
    exchangeCode: async (request: SocialCodeExchangeRequest) =>
      Effect.runPromise(provider.exchangeCode(request)) as Promise<ConnectedSocialAccount<SocialCredential>>,
    refreshCredential: (credential: SocialCredential): Promise<SocialCredential> => {
      if (credential.provider !== "tiktok") throw new TypeError("Invalid TikTok credential")
      return Effect.runPromise(provider.refreshCredential(credential as TikTokCredential))
    },
    revokeCredential: (credential: SocialCredential): Promise<SocialCredentialRevocation> => {
      if (credential.provider !== "tiktok") throw new TypeError("Invalid TikTok credential")
      return Effect.runPromise(provider.revokeCredential(credential as TikTokCredential))
    },
  })
}

function callbackUri(provider: SupportedSocialProviderName) {
  return snapshotSocialRedirectUri(
    new URL(`/api/integrations/${provider}/callback`, publicSiteOrigin()).toString(),
    provider,
  )
}

function publicSiteOrigin() {
  const configured = process.env.NEXT_PUBLIC_SITE_URL
  if (!configured && process.env.NODE_ENV === "production") {
    throw new Error("Missing NEXT_PUBLIC_SITE_URL")
  }
  const url = new URL(configured ?? "http://localhost:3000")
  const localHttp = process.env.NODE_ENV !== "production" &&
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1"].includes(url.hostname)
  if (
    (url.protocol !== "https:" && !localHttp) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new TypeError("Invalid public site origin")
  }
  return url.origin
}

function verifiedMediaUrlPrefixes() {
  return Object.freeze(
    requiredEnvironment("TIKTOK_VERIFIED_MEDIA_URL_PREFIXES")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  )
}

function validateVerifiedMediaUrlPrefix(input: string) {
  if (input.length > 4_096) throw new TypeError("Invalid TikTok media URL prefix")
  const url = new URL(input)
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    !url.pathname.endsWith("/") ||
    !url.hostname.includes(".") ||
    /^\d+(?:\.\d+){3}$/.test(url.hostname) ||
    url.hostname.includes(":") ||
    /%(?:25|2e|2f|5c)/i.test(url.pathname)
  ) {
    throw new TypeError("Invalid TikTok media URL prefix")
  }
}

function validProviderIdentifier(input: string | undefined) {
  return input !== undefined && input.length <= 256 && /^[A-Za-z0-9._~-]+$/.test(input)
}

function validProviderSecret(input: string | undefined) {
  return input !== undefined &&
    input.length > 0 &&
    input.length <= 16_384 &&
    !/\p{Cc}/u.test(input)
}

function requiredEnvironment(name: string) {
  const value = process.env[name]
  if (!value) throw new Error(`Missing ${name}`)
  return value
}
