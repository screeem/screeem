import { defineIntegrationAction } from "@screeem/forms"
import { crmUpsertLeadAction } from "./crm/contract"
import { salesforceUpsertLeadActionName } from "./salesforce/action-contract"

/**
 * Client-safe authoring catalog for the current production provider composition.
 *
 * The authored identity stays provider-neutral. The runtime registration records
 * the concrete provider executor selected for the immutable publication. Keeping
 * the existing Salesforce executor name also makes mixed-version rollout safe.
 */
const formIntegrationActionBindings = [
  defineIntegrationAction({
    ...crmUpsertLeadAction,
    runtimeUse: salesforceUpsertLeadActionName,
  }),
] as const

const runtimeRegistrations = new Set<string>()
for (const { runtimeUse, use } of formIntegrationActionBindings) {
  const registrationName = runtimeUse ?? use
  if (runtimeRegistrations.has(registrationName)) {
    throw new TypeError("Integration executor bindings must be unique")
  }
  runtimeRegistrations.add(registrationName)
}

export const formIntegrationActions = Object.freeze(formIntegrationActionBindings)

/**
 * Converts an immutable runtime registration into the action identity authored
 * by the user. Runtime names stay provider-specific so old publications remain
 * replayable, while API and UI surfaces stay provider-neutral.
 */
export function integrationActionNameForRegistration(registrationName: string): string {
  const matches = formIntegrationActions.filter(
    ({ runtimeUse, use }) => (runtimeUse ?? use) === registrationName,
  )
  return matches[0]?.use ?? registrationName
}
