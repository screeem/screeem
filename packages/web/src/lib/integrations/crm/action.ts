import { type as runtimeType, routingActionFailure, type RoutingActionFailure } from "@screeem/routing"
import { Effect } from "effect"
import type { FormActionDefinition } from "../../forms/form-actions"
import { IntegrationOperationError } from "../action-contract"
import {
  IntegrationResolutionError,
  type IntegrationProviderReference,
} from "../provider-registry"
import {
  crmUpsertLeadAction,
  crmUpsertLeadActionName,
  crmIntegrationType,
  type CrmLeadWriter,
  snapshotCrmUpsertLeadInput,
} from "./contract"

export function createCrmUpsertLeadAction(
  provider: IntegrationProviderReference<CrmLeadWriter>,
  options: {
    readonly name?: string
    readonly configured?: boolean
    readonly providerFailureNamespace?: "integration" | "salesforce"
  } = {},
): FormActionDefinition {
  if (provider.type !== crmIntegrationType) {
    throw new TypeError("CRM actions require a CRM integration provider")
  }
  const fields = Object.fromEntries(
    crmUpsertLeadAction.inputs.map((input) => [input.name, runtimeType.string()]),
  )
  const providerFailureNamespace = options.providerFailureNamespace ?? "integration"
  return {
    name: options.name ?? crmUpsertLeadActionName,
    events: ["routing.matched"],
    input: runtimeType.object(fields),
    timeoutMs: 14_000,
    run: ({ input, context }) => Effect.tryPromise({
      try: async () => {
        if (options.configured === false) {
          throw routingActionFailure({
            code: `${providerFailureNamespace}_invalid_configuration`,
            retryable: false,
            retryAfterMs: null,
          })
        }
        const client = await context.integrations.open(provider, context.signal)
        return client.upsertLead(snapshotCrmUpsertLeadInput(input), {
          externalId: context.idempotencyKey,
          signal: context.signal,
        })
      },
      catch: (error) => integrationActionFailure(error, providerFailureNamespace),
    }),
  } as FormActionDefinition
}

function integrationActionFailure(
  error: unknown,
  providerFailureNamespace: "integration" | "salesforce",
): RoutingActionFailure {
  try {
    return routingActionFailure(error)
  } catch {}
  if (error instanceof IntegrationOperationError) {
    return routingActionFailure({
      code: error.code === "authentication_failed"
        ? `${providerFailureNamespace}_reauthorization_required`
        : `${providerFailureNamespace}_${error.code}`,
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
    code: "integration_unknown",
    retryable: true,
    retryAfterMs: null,
  })
}
