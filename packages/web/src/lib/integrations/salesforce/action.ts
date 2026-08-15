import "server-only"

import {
  routingActionFailure,
  type as runtimeType,
  type RoutingActionFailure,
} from "@screeem/routing"
import { Effect } from "effect"
import type { FormActionDefinition } from "../../forms/form-actions"
import {
  IntegrationResolutionError,
  type IntegrationProviderReference,
} from "../provider-registry"
import { snapshotSalesforceApiName, type SalesforceClient } from "./client"
import {
  SalesforceError,
  integrationErrorCodeForSalesforce,
} from "./contract"

export const salesforceUpsertLeadActionName = "salesforceUpsertLead"

export function createSalesforceUpsertLeadAction(
  provider: IntegrationProviderReference<SalesforceClient>,
  externalIdField: string | undefined,
): FormActionDefinition<
  ReturnType<typeof salesforceLeadInput>,
  { readonly id: string | null; readonly created: boolean },
  RoutingActionFailure
> {
  const safeExternalIdField = validExternalIdField(externalIdField)
  return {
    name: salesforceUpsertLeadActionName,
    events: ["routing.matched"],
    input: salesforceLeadInput(),
    timeoutMs: 14_000,
    run: ({ input, context }) => Effect.tryPromise({
      try: async () => {
        if (!safeExternalIdField) {
          throw routingActionFailure({
            code: "salesforce_invalid_configuration",
            retryable: false,
            retryAfterMs: null,
          })
        }
        const client = await context.integrations.open(provider, context.signal)
        return client.upsertRecord(
          "Lead",
          safeExternalIdField,
          context.idempotencyKey,
          {
            LastName: input.lastName,
            Company: input.company,
            Email: input.email,
          },
          context.signal,
        )
      },
      catch: salesforceActionFailure,
    }),
  }
}

function salesforceLeadInput() {
  return runtimeType.object({
    lastName: runtimeType.string(),
    company: runtimeType.string(),
    email: runtimeType.string(),
  })
}

function salesforceActionFailure(error: unknown): RoutingActionFailure {
  try {
    return routingActionFailure(error)
  } catch {}
  if (error instanceof SalesforceError) {
    const errorCode = integrationErrorCodeForSalesforce(error)
    return routingActionFailure({
      code: errorCode === "authentication_failed"
        ? "salesforce_reauthorization_required"
        : `salesforce_${errorCode}`,
      retryable: error.retryable,
      retryAfterMs: error.retryAfterMs,
    })
  }
  if (error instanceof IntegrationResolutionError) {
    return routingActionFailure({
      code: `integration_${error.reason}`,
      retryable: false,
      retryAfterMs: null,
    })
  }
  return routingActionFailure({
    code: "salesforce_unknown",
    retryable: true,
    retryAfterMs: null,
  })
}

function validExternalIdField(input: string | undefined): string | null {
  if (!input) return null
  try {
    return snapshotSalesforceApiName(input)
  } catch {
    return null
  }
}
