import {
  defineIntegrationAction,
  snapshotIntegrationType,
} from "@screeem/forms"

export const crmIntegrationType = snapshotIntegrationType("crm")
export const crmUpsertLeadActionName = "crm.upsertLead"
export const crmUpsertLeadInputNames = ["lastName", "company", "email"] as const

export type CrmUpsertLeadInput = Readonly<{
  [Name in (typeof crmUpsertLeadInputNames)[number]]: string
}>

export interface CrmOperationContext {
  readonly externalId: string
  readonly signal?: AbortSignal
}

export interface CrmLeadWriter {
  upsertLead(
    input: CrmUpsertLeadInput,
    context: CrmOperationContext,
  ): Promise<{ readonly id: string | null; readonly created: boolean }>
}

export function snapshotCrmUpsertLeadInput(
  input: unknown,
  options: { readonly allowEmpty?: boolean } = {},
): CrmUpsertLeadInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Invalid CRM lead input")
  }
  const value = input as Record<string, unknown>
  const keys = Object.keys(value)
  if (
    keys.length !== crmUpsertLeadInputNames.length ||
    !crmUpsertLeadInputNames.every((name) => keys.includes(name))
  ) {
    throw new TypeError("Invalid CRM lead input")
  }
  return Object.freeze(Object.fromEntries(
    crmUpsertLeadInputNames.map((name) => [
      name,
      requiredString(value[name], options.allowEmpty === true),
    ]),
  )) as CrmUpsertLeadInput
}

export const crmUpsertLeadAction = defineIntegrationAction({
  use: crmUpsertLeadActionName,
  integrationType: crmIntegrationType,
  capability: "upsertLead",
  label: "Upsert CRM lead",
  description: "Create or update a lead in this team’s connected CRM.",
  inputs: [
    {
      name: crmUpsertLeadInputNames[0],
      label: "Last name",
      required: true,
      fieldTypes: ["string"],
      fieldControls: ["text"],
      suggestedFieldNames: ["lastName", "last_name", "surname", "familyName"],
    },
    {
      name: crmUpsertLeadInputNames[1],
      label: "Company",
      required: true,
      fieldTypes: ["string"],
      fieldControls: ["text"],
      suggestedFieldNames: ["company", "companyName", "company_name", "organisation", "organization"],
    },
    {
      name: crmUpsertLeadInputNames[2],
      label: "Email",
      required: true,
      fieldTypes: ["string"],
      fieldControls: ["email"],
      suggestedFieldNames: ["email", "workEmail", "work_email", "businessEmail"],
    },
  ],
})

export const crmIntegrationActions = Object.freeze([crmUpsertLeadAction])

function requiredString(input: unknown, allowEmpty: boolean) {
  if (
    typeof input !== "string" ||
    (!allowEmpty && input.length === 0) ||
    input.length > 16_384
  ) {
    throw new TypeError("Invalid CRM lead input")
  }
  return input
}
