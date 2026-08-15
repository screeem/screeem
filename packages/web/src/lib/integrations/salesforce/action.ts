import type { SalesforceClient } from "./client"
import type { IntegrationProviderReference } from "../provider-registry"
import { createCrmUpsertLeadAction } from "../crm/action"
import { snapshotSalesforceApiName } from "./client"
import { salesforceUpsertLeadActionName } from "./action-contract"

export { salesforceUpsertLeadActionName } from "./action-contract"

export function createSalesforceUpsertLeadAction(
  provider: IntegrationProviderReference<SalesforceClient>,
  externalIdField: string | undefined,
) {
  return createCrmUpsertLeadAction(provider, {
    name: salesforceUpsertLeadActionName,
    configured: salesforceLeadActionConfigured(externalIdField),
    providerFailureNamespace: "salesforce",
  })
}

export function salesforceLeadActionConfigured(input: string | undefined) {
  if (!input) return false
  try {
    snapshotSalesforceApiName(input)
    return true
  } catch {
    return false
  }
}
