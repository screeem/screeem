import "server-only"

import type {
  IntegrationProviderReference,
  IntegrationResolver,
} from "./provider-registry"
import { snapshotIntegrationIdentifier } from "./contract"

export interface IntegrationAutomationAccess {
  open<Client>(reference: IntegrationProviderReference<Client>, signal?: AbortSignal): Promise<Client>
}

export interface IntegrationAutomationRuntime {
  forTenant(tenantId: string): IntegrationAutomationAccess
}

export class ResolverIntegrationAutomationRuntime implements IntegrationAutomationRuntime {
  private resolver: IntegrationResolver | null = null

  constructor(private readonly createResolver: () => IntegrationResolver) {}

  forTenant(tenantId: string): IntegrationAutomationAccess {
    const safeTenantId = snapshotIntegrationIdentifier(tenantId)
    return Object.freeze({
      open: async <Client>(reference: IntegrationProviderReference<Client>, signal?: AbortSignal) => (
        await (this.resolver ??= this.createResolver()).resolve(safeTenantId, reference, signal)
      ).client,
    })
  }
}

export const unavailableIntegrationAutomationRuntime: IntegrationAutomationRuntime = Object.freeze({
  forTenant: () => Object.freeze({
    async open(): Promise<never> {
      throw new Error("Integration automation runtime is unavailable")
    },
  }),
})
