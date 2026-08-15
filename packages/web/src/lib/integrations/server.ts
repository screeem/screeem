import "server-only"

import {
  PostgresIntegrationConnectionStore,
  PostgresIntegrationCredentialStore,
  PostgresIntegrationExecutionStore,
  PostgresIntegrationTeamControlStore,
} from "./postgres-store"
import { PostgresIntegrationProvisioningStore } from "./provisioning-store"
import {
  createIntegrationProviderRegistry,
  defineIntegrationProvider,
  IntegrationResolver,
} from "./provider-registry"
import { ResolverIntegrationAutomationRuntime } from "./automation-runtime"
import {
  AesGcmIntegrationCredentialCipher,
  snapshotIntegrationCredentialKeyConfiguration,
} from "./credential-cipher"
import { SalesforceOAuthAdapter } from "./salesforce/oauth"
import { createSalesforceProviderDefinition } from "./salesforce/provider"
import { SalesforceConnectionService } from "./salesforce/service"
import {
  PostgresSalesforceOAuthStateStore,
  PostgresSalesforceRefreshLeaseStore,
} from "./salesforce/stores"
import { salesforceProviderName } from "./salesforce/contract"
import {
  snapshotSalesforceAccessCredential,
  snapshotSalesforceCredential,
  snapshotSalesforcePublicSiteOrigin,
  snapshotSalesforceReturnPath,
  type SalesforceAccessCredential,
} from "./salesforce/contract"
import { SalesforceHttpClient } from "./salesforce/client"
import { snapshotIntegrationIdentifier, type IntegrationIdentifier } from "./contract"
import { SalesforceActionPreviewService } from "./salesforce/action-preview-service"
import { crmIntegrationType } from "./crm/contract"

const salesforceIntegrationProviderDefinition = defineIntegrationProvider({
  name: salesforceProviderName,
  type: crmIntegrationType,
  displayName: "Salesforce",
  enabled: salesforceEnvironmentConfigured(),
  open: async (options) => (await salesforceProvider()).open(options),
})

export const productionIntegrationProviderRegistry = createIntegrationProviderRegistry()
  .register(salesforceIntegrationProviderDefinition)

export const salesforceIntegrationProvider = productionIntegrationProviderRegistry.reference(
  salesforceIntegrationProviderDefinition,
)

export function createIntegrationResolver() {
  return new IntegrationResolver(
    productionIntegrationProviderRegistry,
    createIntegrationConnectionStore(),
    createIntegrationTeamControlStore(),
    createIntegrationCredentialStore(),
  )
}

export const productionIntegrationAutomationRuntime = new ResolverIntegrationAutomationRuntime(
  createIntegrationResolver,
)

let salesforceProviderPromise: ReturnType<typeof buildSalesforceProvider> | null = null

export function createIntegrationConnectionStore() {
  return new PostgresIntegrationConnectionStore()
}

export function createIntegrationTeamControlStore() {
  return new PostgresIntegrationTeamControlStore()
}

export function createIntegrationCredentialStore() {
  return new PostgresIntegrationCredentialStore()
}

export function createIntegrationExecutionStore() {
  return new PostgresIntegrationExecutionStore()
}

export function createSalesforceActionPreviewService() {
  const resolver = createIntegrationResolver()
  return new SalesforceActionPreviewService({
    externalIdField: process.env.SALESFORCE_LEAD_EXTERNAL_ID_FIELD,
    resolve: async (teamId, signal) => {
      const resolved = await resolver.resolve(teamId, salesforceIntegrationProvider, signal)
      return Object.freeze({ connection: resolved.connection, client: resolved.client })
    },
  })
}

export async function createSalesforceConnectionService() {
  const connections = createIntegrationConnectionStore()
  const credentials = createIntegrationCredentialStore()
  const execution = createIntegrationExecutionStore()
  const controls = createIntegrationTeamControlStore()
  const resolver = new IntegrationResolver(
    productionIntegrationProviderRegistry,
    connections,
    controls,
    credentials,
  )
  const runtime = salesforceConfiguration()
  return new SalesforceConnectionService({
    oauth: runtime.oauth,
    states: new PostgresSalesforceOAuthStateStore(),
    cipher: runtime.cipher,
    provisioning: new PostgresIntegrationProvisioningStore(),
    connections,
    execution,
    identify: (credential) => salesforceIdentityClient(credential, runtime.oauth).identity(),
    resolveClient: async (teamId) => (
      await resolver.resolve(teamId, salesforceIntegrationProvider)
    ).client,
  })
}

function salesforceIdentityClient(
  credential: SalesforceAccessCredential,
  oauth: SalesforceOAuthAdapter,
) {
  const safe = snapshotSalesforceAccessCredential(credential)
  return new SalesforceHttpClient(
    {
      async get() { return safe },
      async refresh() { return safe },
    },
    (token, signal) => oauth.revoke(token, signal),
  )
}

export async function disconnectSalesforceConnection(
  teamId: IntegrationIdentifier,
  actorId: IntegrationIdentifier,
) {
  const safeTeamId = snapshotIntegrationIdentifier(teamId)
  const disconnected = await new PostgresIntegrationProvisioningStore().disconnect(
    safeTeamId,
    salesforceProviderName,
    snapshotIntegrationIdentifier(actorId),
    new Date().toISOString(),
  )
  if (!disconnected?.credential) return disconnected?.connection ?? null
  try {
    const runtime = rawSalesforceConfiguration()
    const credential = snapshotSalesforceCredential(await runtime.cipher.open(
      {
        teamId: safeTeamId,
        connectionId: disconnected.connection.id,
        provider: salesforceProviderName,
      },
      disconnected.credential.credential,
    ))
    await runtime.oauth.revoke(credential.refreshToken)
  } catch {
    // Local credential removal is authoritative when remote revocation is unavailable.
  }
  return disconnected.connection
}

export function createSalesforceReturnUrl(returnPath: string, status: "connected" | "error") {
  const url = new URL(snapshotSalesforceReturnPath(returnPath), publicSiteOrigin())
  url.searchParams.set("integration", "salesforce")
  url.searchParams.set("status", status)
  return url
}

function salesforceProvider() {
  salesforceProviderPromise ??= buildSalesforceProvider()
  return salesforceProviderPromise
}

async function buildSalesforceProvider() {
  const runtime = salesforceConfiguration()
  return createSalesforceProviderDefinition({
    enabled: true,
    connections: createIntegrationConnectionStore(),
    execution: createIntegrationExecutionStore(),
    credentials: createIntegrationCredentialStore(),
    cipher: runtime.cipher,
    oauth: runtime.oauth,
    leases: new PostgresSalesforceRefreshLeaseStore(),
    observeLimits: (limits) => {
      if (limits.remaining !== null && limits.maximum !== null) {
        console.info("Salesforce API limits", limits)
      }
    },
    leadExternalIdField: process.env.SALESFORCE_LEAD_EXTERNAL_ID_FIELD,
  })
}

function salesforceConfiguration() {
  if (!salesforceEnvironmentConfigured()) throw new Error("Salesforce integration is disabled")
  return rawSalesforceConfiguration()
}

function rawSalesforceConfiguration() {
  const oauthConfiguration = salesforceOAuthConfiguration()
  const key = snapshotIntegrationCredentialKeyConfiguration(
    requiredEnvironment("INTEGRATION_CREDENTIAL_KEY_ID"),
    requiredEnvironment("INTEGRATION_CREDENTIAL_KEY"),
  )
  const cipher = new LazyIntegrationCredentialCipher(
    AesGcmIntegrationCredentialCipher.create(key.keyId, key.encodedKey),
  )
  return {
    cipher,
    oauth: new SalesforceOAuthAdapter(oauthConfiguration),
  }
}

function salesforceOAuthConfiguration() {
  return {
    clientId: requiredEnvironment("SALESFORCE_CLIENT_ID"),
    clientSecret: process.env.SALESFORCE_CLIENT_SECRET || undefined,
    loginUrl: process.env.SALESFORCE_LOGIN_URL ?? "https://login.salesforce.com",
    callbackUrl: new URL(
      "/api/integrations/salesforce/callback",
      publicSiteOrigin(),
    ).toString(),
  }
}

function publicSiteOrigin() {
  const configured = process.env.NEXT_PUBLIC_SITE_URL
  if (!configured && process.env.NODE_ENV === "production") {
    throw new Error("Missing NEXT_PUBLIC_SITE_URL")
  }
  return snapshotSalesforcePublicSiteOrigin(
    configured ?? "http://localhost:3000",
    process.env.NODE_ENV !== "production",
  )
}

function salesforceEnvironmentConfigured() {
  const configured = process.env.SALESFORCE_INTEGRATION_ENABLED === "true" &&
    Boolean(process.env.SALESFORCE_CLIENT_ID) &&
    Boolean(process.env.INTEGRATION_CREDENTIAL_KEY_ID) &&
    Boolean(process.env.INTEGRATION_CREDENTIAL_KEY)
  if (!configured) return false
  try {
    new SalesforceOAuthAdapter(salesforceOAuthConfiguration())
    snapshotIntegrationCredentialKeyConfiguration(
      process.env.INTEGRATION_CREDENTIAL_KEY_ID,
      process.env.INTEGRATION_CREDENTIAL_KEY,
    )
    return true
  } catch {
    return false
  }
}

function requiredEnvironment(name: string) {
  const value = process.env[name]
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

class LazyIntegrationCredentialCipher {
  constructor(
    private readonly cipher: Promise<AesGcmIntegrationCredentialCipher>,
  ) {}

  async seal(...arguments_: Parameters<AesGcmIntegrationCredentialCipher["seal"]>) {
    return (await this.cipher).seal(...arguments_)
  }

  async open(...arguments_: Parameters<AesGcmIntegrationCredentialCipher["open"]>) {
    return (await this.cipher).open(...arguments_)
  }
}
