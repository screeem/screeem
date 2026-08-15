import "server-only"

import {
  snapshotFormActionTestContext,
  snapshotFormActionTestResult,
  type FormActionTestContext,
  type FormActionTestResult,
} from "@screeem/forms"
import type { IntegrationConnection, IntegrationIdentifier } from "../contract"
import {
  crmUpsertLeadActionName,
  snapshotCrmUpsertLeadInput,
} from "../crm/contract"
import { SalesforceError, type SalesforceObjectDescription } from "./contract"
import { snapshotSalesforceApiName } from "./client"

type PreviewSalesforceClient = Readonly<Pick<
  import("./client").SalesforceClient,
  "describeObject"
>>

export interface SalesforceActionPreviewDependencies {
  readonly externalIdField: string | undefined
  readonly resolve: (
    teamId: IntegrationIdentifier,
    signal: AbortSignal,
  ) => Promise<{
    readonly connection: IntegrationConnection
    readonly client: PreviewSalesforceClient
  }>
}

export class SalesforceActionPreviewService {
  constructor(private readonly dependencies: SalesforceActionPreviewDependencies) {}

  async previewLead(
    teamId: IntegrationIdentifier,
    input: unknown,
    signal: AbortSignal,
  ): Promise<FormActionTestResult> {
    const context = snapshotFormActionTestContext(input, signal)
    if (context.action.use !== crmUpsertLeadActionName) {
      throw new TypeError("Invalid CRM action preview")
    }
    signal.throwIfAborted()
    const externalIdField = configuredExternalIdField(this.dependencies.externalIdField)
    const resolved = await this.dependencies.resolve(teamId, signal)
    signal.throwIfAborted()
    const description = await resolved.client.describeObject("Lead", signal)
    signal.throwIfAborted()
    return previewResult(context, resolved.connection, description, externalIdField)
  }
}

function previewResult(
  context: FormActionTestContext,
  connection: IntegrationConnection,
  description: SalesforceObjectDescription,
  externalIdField: string,
) {
  const values = proposedLeadValues(context)
  const availableFields = new Map(description.fields.map((field) => [field.name, field]))
  const missingInputs = Object.entries(values)
    .filter(([, value]) => value === null)
    .map(([name]) => name)
  const missingFields = ["LastName", "Company", "Email", externalIdField].filter(
    (name) => !availableFields.has(name),
  )
  const incompatibleFields = ["LastName", "Company", "Email"].filter((name) => {
    const field = availableFields.get(name)
    return field && (!field.createable || !field.updateable)
  })
  const externalId = availableFields.get(externalIdField)
  if (
    externalId &&
    (!externalId.externalId || !externalId.unique || !externalId.createable || !externalId.updateable)
  ) {
    incompatibleFields.push(externalIdField)
  }
  const warning =
    missingInputs.length > 0 || missingFields.length > 0 || incompatibleFields.length > 0
  const organization = connection.displayName ?? connection.externalAccountId ?? "Connected organization"

  return snapshotFormActionTestResult({
    status: warning ? "warning" : "success",
    summary: warning
      ? "Salesforce is connected, but this Lead action needs attention."
      : "Salesforce is ready for this Lead action.",
    details: [
      { label: "Operation", value: "Upsert Lead" },
      { label: "Organization", value: organization },
      { label: "Destination", value: context.routing.route ?? "No route" },
      { label: "External ID", value: `${externalIdField} · generated when submitted` },
      { label: "Last name", value: values.lastName ?? "Not mapped" },
      { label: "Company", value: values.company ?? "Not mapped" },
      { label: "Email", value: values.email ?? "Not mapped" },
      ...(missingFields.length > 0
        ? [{ label: "Missing fields", value: missingFields.join(", ") }]
        : []),
      ...(incompatibleFields.length > 0
        ? [{ label: "Incompatible fields", value: incompatibleFields.join(", ") }]
        : []),
    ],
  })
}

function proposedLeadValues(context: FormActionTestContext) {
  const input = snapshotCrmUpsertLeadInput(context.action.input, { allowEmpty: true })
  return Object.freeze({
    lastName: input.lastName || null,
    company: input.company || null,
    email: input.email || null,
  })
}

function configuredExternalIdField(input: string | undefined) {
  if (!input) throw new SalesforceError("invalid_configuration", false)
  try {
    return snapshotSalesforceApiName(input)
  } catch {
    throw new SalesforceError("invalid_configuration", false)
  }
}
