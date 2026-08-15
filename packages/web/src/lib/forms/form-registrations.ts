import "server-only"
import {
  productionIntegrationAutomationRuntime,
  salesforceIntegrationProvider,
} from "../integrations/server"
import { createSalesforceUpsertLeadAction } from "../integrations/salesforce/action"
import { createFormAutomationRegistry } from "./form-automation-registry"

export const productionFormAutomationRegistry = createFormAutomationRegistry(
  productionIntegrationAutomationRuntime,
).registerAction(
  createSalesforceUpsertLeadAction(
    salesforceIntegrationProvider,
    process.env.SALESFORCE_LEAD_EXTERNAL_ID_FIELD,
  ),
)
