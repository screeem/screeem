import "server-only"

import {
  snapshotFormDefinition,
  snapshotFormRoutingDefinition,
  type FormDefinition,
  type FormRoutingDefinition,
  type SubmissionRoutingResult,
} from "@screeem/forms"
import {
  ActionExecutionError,
  routingActionFailure,
  routingActionFailureOrDefault,
  schemaFromForm,
  type ActionOutput,
  type RoutingActionFailure,
} from "@screeem/routing"
import type {
  PendingFormEventDelivery,
  PlannedFormEventDelivery,
  StoredFormEventDelivery,
  FormEvent,
  FormPublicationScope,
} from "./form-actions"
import { maximumFormEventDeliveries } from "./form-delivery-contract"
import type { FormAutomationRegistry } from "./form-automation-registry"
import { productionFormAutomationRegistry } from "./form-registrations"

const maximumActionOutputBytes = 64 * 1024

export interface FormEventDeliveryStore {
  claim(delivery: PendingFormEventDelivery | StoredFormEventDelivery): Promise<{
    readonly attempt: number
  } | null>
  succeed(
    delivery: PendingFormEventDelivery | StoredFormEventDelivery,
    attempt: number,
    output: ActionOutput,
  ): Promise<void>
  fail(
    delivery: PendingFormEventDelivery | StoredFormEventDelivery,
    attempt: number,
    failure: RoutingActionFailure,
  ): Promise<void>
}

export interface FormEventDeliveryRecoveryStore extends FormEventDeliveryStore {
  listPending(limit: number): Promise<{
    readonly deliveries: readonly PendingFormEventDelivery[]
    readonly invalidCount: number
  }>
  loadPublication(
    scope: FormPublicationScope,
  ): Promise<{ readonly definition: unknown; readonly routing: unknown }>
}

export function planFormRoutingDeliveries(
  routing: FormRoutingDefinition | null,
  result: SubmissionRoutingResult,
  event: FormEvent<"routing.matched"> | null,
  registry: FormAutomationRegistry = productionFormAutomationRegistry,
): readonly PlannedFormEventDelivery[] {
  if (routing === null || result.status !== "matched" || result.matchedRule === null || !event) {
    return []
  }
  const rule = routing.rules.find(({ id }) => id === result.matchedRule)
  if (!rule) return []
  const actions = (rule.actions ?? []).map((action, sequence) =>
    Object.freeze({
      event,
      kind: "routing_action" as const,
      registrationName: action.use,
      deliveryKey: `${event.eventId}:${sequence}`,
      sequence,
    }),
  )
  return Object.freeze([...actions, ...registry.planDurable(event, actions.length)])
}

export function orderFormEventDeliveries(
  deliveries: readonly PlannedFormEventDelivery[],
  scope: {
    readonly tenantId: string
    readonly formId: string
    readonly publicationVersion: number | null
    readonly submissionId: string
  },
): readonly StoredFormEventDelivery[] {
  if (deliveries.length > maximumFormEventDeliveries) {
    throw new Error(`A submission cannot have more than ${maximumFormEventDeliveries} deliveries`)
  }
  return Object.freeze(
    deliveries.map((delivery, streamSequence) =>
      Object.freeze({ ...delivery, ...scope, streamSequence }),
    ),
  )
}

export async function executeFormEventDeliveries(options: {
  readonly definition: FormDefinition | null
  readonly routing: FormRoutingDefinition | null
  readonly deliveries: readonly (PendingFormEventDelivery | StoredFormEventDelivery)[]
  readonly store: FormEventDeliveryStore
  readonly registry?: FormAutomationRegistry
}): Promise<number> {
  const registry = options.registry ?? productionFormAutomationRegistry
  let claimed = 0
  const blockedRoutingEvents = new Set<string>()
  for (const delivery of options.deliveries) {
    if (delivery.kind === "routing_action" && blockedRoutingEvents.has(delivery.event.eventId)) {
      continue
    }
    const claim = await options.store.claim(delivery)
    if (!claim) continue
    claimed += 1
    const succeeded = await executeClaimedDelivery(options, delivery, claim.attempt, registry)
    if (!succeeded && delivery.kind === "routing_action") {
      blockedRoutingEvents.add(delivery.event.eventId)
    }
  }
  return claimed
}

async function executeClaimedDelivery(
  options: {
    readonly definition: FormDefinition | null
    readonly routing: FormRoutingDefinition | null
    readonly store: FormEventDeliveryStore
  },
  delivery: PendingFormEventDelivery | StoredFormEventDelivery,
  attempt: number,
  registry: FormAutomationRegistry,
) {
  let output: ActionOutput
  try {
    output = await executeDelivery(options, delivery, registry)
    if (encodedBytes(output) > maximumActionOutputBytes) {
      throw new Error("Form delivery output is too large")
    }
  } catch (error) {
    await options.store.fail(delivery, attempt, deliveryFailure(error))
    if (error instanceof FormEventDeliveryContractError) throw error
    return false
  }
  await options.store.succeed(delivery, attempt, output)
  return true
}

async function executeDelivery(
  options: {
    readonly definition: FormDefinition | null
    readonly routing: FormRoutingDefinition | null
  },
  delivery: PendingFormEventDelivery | StoredFormEventDelivery,
  registry: FormAutomationRegistry,
): Promise<ActionOutput> {
  if (delivery.kind === "event_handler") {
    return registry.runDurableHandler(delivery)
  }
  if (delivery.event.type !== "routing.matched") {
    throw new FormEventDeliveryContractError("Form event delivery is not registered")
  }
  if (options.definition === null || options.routing === null) {
    throw new FormEventDeliveryContractError("Routing action publication is unavailable")
  }
  const event = delivery.event
  const rule = options.routing.rules.find(({ id }) => id === event.payload.ruleId)
  const action = rule?.actions?.[delivery.sequence]
  if (
    !rule ||
    rule.route !== event.payload.route ||
    !action ||
    action.use !== delivery.registrationName
  ) {
    throw new FormEventDeliveryContractError("Routing action does not match its delivery")
  }
  const compiled = await registry.actionRouter(event, delivery.deliveryKey).compile({
    version: 1,
    schema: schemaFromForm(options.definition),
    rules: [
      {
        id: rule.id,
        when: rule.when,
        route: rule.route,
        actions: [action],
      },
    ],
    fallback: rule.route,
  })
  const executed = await compiled.run(event.payload.submission)
  const executedAction = executed.actions[0]
  if (
    executed.matchedRule !== rule.id ||
    executed.route !== event.payload.route ||
    executed.actions.length !== 1 ||
    executedAction?.action !== action.use
  ) {
    throw new FormEventDeliveryContractError("Persisted routing event no longer matches")
  }
  return executedAction.output
}

class FormEventDeliveryContractError extends Error {}

function deliveryFailure(error: unknown): RoutingActionFailure {
  if (error instanceof FormEventDeliveryContractError) {
    return routingActionFailure({
      code: "delivery_contract_invalid",
      retryable: false,
      retryAfterMs: null,
    })
  }
  if (error instanceof ActionExecutionError) return error.failure
  return routingActionFailureOrDefault(error)
}

function encodedBytes(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value ?? null)).byteLength
}

export async function drainPendingFormEventDeliveries(
  store: FormEventDeliveryRecoveryStore,
  limit = 25,
  registry: FormAutomationRegistry = productionFormAutomationRegistry,
  startBefore = Number.POSITIVE_INFINITY,
): Promise<number> {
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 100)
  const pending = await store.listPending(safeLimit)
  const rows = pending.deliveries
  const streams = new Map<string, PendingFormEventDelivery[]>()
  for (const row of rows) {
    const key = `${row.tenantId}:${row.formId}:${row.submissionId}`
    streams.set(key, [...(streams.get(key) ?? []), row])
  }
  let processed = 0
  const failures: unknown[] = []
  if (pending.invalidCount > 0) failures.push(new Error("Invalid stored form event deliveries"))
  await runBounded([...streams.values()], 4, () => Date.now() < startBefore, async (stream) => {
    const ordered = [...stream].sort((left, right) => left.streamSequence - right.streamSequence)
    const first = ordered[0]
    if (!first) return
    try {
      let definition: FormDefinition | null = null
      let routing: FormRoutingDefinition | null = null
      const blockedRoutingEvents = new Set<string>()
      for (const delivery of ordered) {
        if (Date.now() >= startBefore) break
        if (
          delivery.kind === "routing_action" &&
          blockedRoutingEvents.has(delivery.event.eventId)
        ) {
          continue
        }
        const claim = await store.claim(delivery)
        if (!claim) continue
        processed += 1
        if (delivery.kind === "routing_action") {
          try {
            if (definition === null || routing === null) {
              const publication = await store.loadPublication(requiredPublicationScope(delivery))
              definition = snapshotFormDefinition(publication.definition, { publishable: true })
              routing = snapshotFormRoutingDefinition(publication.routing)
            }
          } catch (error) {
            await store.fail(delivery, claim.attempt, routingActionFailure({
              code: "delivery_publication_unavailable",
              retryable: true,
              retryAfterMs: null,
            }))
            throw error
          }
        }
        const succeeded = await executeClaimedDelivery({
          definition,
          routing,
          store,
        }, delivery, claim.attempt, registry)
        if (!succeeded && delivery.kind === "routing_action") {
          blockedRoutingEvents.add(delivery.event.eventId)
        }
      }
    } catch (error) {
      failures.push(error)
    }
  })
  if (failures.length > 0) throw new Error("Could not process every pending form event delivery")
  return processed
}

function requiredPublicationScope(delivery: PendingFormEventDelivery): FormPublicationScope {
  if (delivery.publicationVersion === null) {
    throw new Error("Pending routing delivery has no publication")
  }
  return {
    tenantId: delivery.tenantId,
    formId: delivery.formId,
    publicationVersion: delivery.publicationVersion,
  }
}

async function runBounded<Value>(
  values: readonly Value[],
  concurrency: number,
  shouldStart: () => boolean,
  run: (value: Value) => Promise<void>,
) {
  let nextIndex = 0
  const failures: unknown[] = []
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      for (;;) {
        if (!shouldStart()) return
        const index = nextIndex
        nextIndex += 1
        if (index >= values.length) return
        try {
          await run(values[index]!)
        } catch (error) {
          failures.push(error)
        }
      }
    }),
  )
  if (failures.length > 0) throw new AggregateError(failures, "Form event delivery work failed")
}
