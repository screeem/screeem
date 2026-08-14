import "server-only"

import {
  PostgresIntegrationConnectionStore,
  PostgresIntegrationCredentialStore,
  PostgresIntegrationTeamControlStore,
} from "./postgres-store"
import { createIntegrationProviderRegistry } from "./provider-registry"

export const productionIntegrationProviderRegistry = createIntegrationProviderRegistry()

export function createIntegrationConnectionStore() {
  return new PostgresIntegrationConnectionStore()
}

export function createIntegrationTeamControlStore() {
  return new PostgresIntegrationTeamControlStore()
}

export function createIntegrationCredentialStore() {
  return new PostgresIntegrationCredentialStore()
}
