import "server-only"
import {
  productionIntegrationAutomationRuntime,
  salesforceIntegrationProvider,
} from "../integrations/server"
import {
  createSalesforceUpsertLeadAction,
  salesforceLeadActionConfigured,
} from "../integrations/salesforce/action"
import { createCrmUpsertLeadAction } from "../integrations/crm/action"
import { createFormAutomationRegistry } from "./form-automation-registry"

export const productionFormAutomationRegistry = createFormAutomationRegistry(
  productionIntegrationAutomationRuntime,
).registerAction(
  createCrmUpsertLeadAction(salesforceIntegrationProvider, {
    configured: salesforceLeadActionConfigured(
      process.env.SALESFORCE_LEAD_EXTERNAL_ID_FIELD,
    ),
  }),
).registerAction(
  createSalesforceUpsertLeadAction(
    salesforceIntegrationProvider,
    process.env.SALESFORCE_LEAD_EXTERNAL_ID_FIELD,
  ),
)
