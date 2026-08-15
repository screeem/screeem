import "server-only"

import type { IntegrationCredentialCipher } from "../credential-cipher"
import type {
  IntegrationConnectionStore,
  IntegrationCredentialStore,
  IntegrationExecutionStore,
} from "../stores"
import { defineIntegrationProvider } from "../provider-registry"
import { SalesforceHttpClient, type SalesforceApiLimitObserver } from "./client"
import { salesforceProviderName } from "./contract"
import type { SalesforceOAuthClient } from "./oauth"
import type { SalesforceRefreshLeaseStore } from "./stores"
import { RefreshingSalesforceAccessTokenProvider } from "./token-provider"

export interface SalesforceProviderDependencies {
  readonly enabled: boolean
  readonly connections: IntegrationConnectionStore
  readonly execution: IntegrationExecutionStore
  readonly credentials: IntegrationCredentialStore
  readonly cipher: IntegrationCredentialCipher
  readonly oauth: SalesforceOAuthClient
  readonly leases: SalesforceRefreshLeaseStore
  readonly fetcher?: typeof fetch
  readonly observeLimits?: SalesforceApiLimitObserver
}

export function createSalesforceProviderDefinition(dependencies: SalesforceProviderDependencies) {
  return defineIntegrationProvider({
    name: salesforceProviderName,
    displayName: "Salesforce",
    enabled: dependencies.enabled,
    open: async ({ connection, credential, signal }) => {
      const tokens = await RefreshingSalesforceAccessTokenProvider.create(
        connection,
        credential,
        dependencies.connections,
        dependencies.execution,
        dependencies.credentials,
        dependencies.cipher,
        dependencies.oauth,
        dependencies.leases,
        signal,
      )
      return new SalesforceHttpClient(
        tokens,
        (token, signal) => dependencies.oauth.revoke(token, signal),
        dependencies.fetcher,
        dependencies.observeLimits,
      )
    },
  })
}
