import "server-only"
import { schemaFromForm, type ActionOutput } from "@screeem/routing"
import {
  snapshotFormDefinition,
  snapshotFormRoutingDefinition,
  snapshotSubmissionRoutingResult,
  type FormDefinition,
  type FormRoutingDefinition,
  type SubmissionRoutingResult,
} from "@screeem/forms"
import type { FormRoutingIdentifiers, FormRoutingRegistry } from "./routing-registry"
import { productionFormRoutingRegistry } from "./routing-registrations"

const MAXIMUM_ACTION_OUTPUT_BYTES = 64 * 1024

export interface PlannedFormRoutingAction {
  readonly key: string
  readonly name: string
  readonly index: number
  readonly ruleId: string
}

export interface FormRoutingActionExecutionStore {
  claim(
    identifiers: FormRoutingIdentifiers,
    action: PlannedFormRoutingAction,
  ): Promise<{ readonly attempt: number } | null>
  succeed(
    identifiers: FormRoutingIdentifiers,
    action: PlannedFormRoutingAction,
    attempt: number,
    output: ActionOutput,
  ): Promise<void>
  fail(
    identifiers: FormRoutingIdentifiers,
    action: PlannedFormRoutingAction,
    attempt: number,
    errorCode: string,
  ): Promise<void>
}

export interface FormRoutingActionRecoveryStore extends FormRoutingActionExecutionStore {
  listPending(limit: number): Promise<readonly PendingRoutingActionExecution[]>
  loadPublication(
    identifiers: Pick<FormRoutingIdentifiers, "tenantId" | "formId" | "publicationVersion">,
  ): Promise<{ readonly definition: unknown; readonly routing: unknown }>
}

export function planFormRoutingActions(
  routing: FormRoutingDefinition | null,
  result: SubmissionRoutingResult,
): readonly PlannedFormRoutingAction[] {
  if (routing === null || result.status !== "matched" || result.matchedRule === null) return []
  const rule = routing.rules.find(({ id }) => id === result.matchedRule)
  if (!rule) return []
  return Object.freeze(
    (rule.actions ?? []).map((action, index) =>
      Object.freeze({
        key: `${rule.id}:${index}`,
        name: action.use,
        index,
        ruleId: rule.id,
      }),
    ),
  )
}

export async function executeFormRoutingActions(options: {
  readonly identifiers: FormRoutingIdentifiers
  readonly definition: FormDefinition
  readonly routing: FormRoutingDefinition
  readonly result: SubmissionRoutingResult
  readonly submission: Readonly<Record<string, string | number | boolean>>
  readonly actions: readonly PlannedFormRoutingAction[]
  readonly store: FormRoutingActionExecutionStore
  readonly registry?: FormRoutingRegistry
}): Promise<void> {
  const registry = options.registry ?? productionFormRoutingRegistry
  for (const planned of options.actions) {
    const rule = options.routing.rules.find(({ id }) => id === planned.ruleId)
    const action = rule?.actions?.[planned.index]
    if (!rule || !action || action.use !== planned.name || options.result.route === null) continue

    const claim = await options.store.claim(options.identifiers, planned)
    if (!claim) continue

    let output: ActionOutput
    try {
      const compiled = await registry.actionRouter(options.identifiers, planned.key).compile({
        version: 1,
        schema: schemaFromForm(options.definition),
        rules: [
          {
            id: rule.id,
            when: rule.when,
            route: options.result.route,
            actions: [action],
          },
        ],
        fallback: options.result.route,
      })
      const executed = await compiled.run(options.submission)
      const executedAction = executed.actions[0]
      if (
        executed.matchedRule !== rule.id ||
        executed.route !== options.result.route ||
        executed.actions.length !== 1 ||
        executedAction?.action !== action.use
      ) {
        throw new Error("Persisted routing result no longer matches")
      }
      output = executedAction.output
      if (encodedBytes(output) > MAXIMUM_ACTION_OUTPUT_BYTES) {
        throw new Error("Action output is too large")
      }
    } catch {
      await options.store.fail(
        options.identifiers,
        planned,
        claim.attempt,
        "action_execution_failed",
      )
      return
    }
    await options.store.succeed(options.identifiers, planned, claim.attempt, output)
  }
}

function encodedBytes(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value ?? null)).byteLength
}

export async function drainPendingFormRoutingActions(
  store: FormRoutingActionRecoveryStore,
  limit = 25,
  registry: FormRoutingRegistry = productionFormRoutingRegistry,
  startBefore = Number.POSITIVE_INFINITY,
): Promise<number> {
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 100)
  const rows = await store.listPending(safeLimit)
  const groups = new Map<string, PendingRoutingActionExecution[]>()
  for (const row of rows) {
    const key = `${row.tenantId}:${row.formId}:${row.publicationVersion}`
    groups.set(key, [...(groups.get(key) ?? []), row])
  }
  let processed = 0
  const failures: unknown[] = []

  await runBounded([...groups.values()], 2, () => Date.now() < startBefore, async (rows) => {
    const first = rows[0]
    if (!first) return
    try {
      const publication = await store.loadPublication({
        tenantId: first.tenantId,
        formId: first.formId,
        publicationVersion: first.publicationVersion,
      })
      const definition = snapshotFormDefinition(publication.definition, { publishable: true })
      const routing = snapshotFormRoutingDefinition(publication.routing)
      await runBounded(rows, 4, () => Date.now() < startBefore, async (row) => {
        const result = snapshotSubmissionRoutingResult({
          status: row.routing.status,
          route: row.routing.route,
          matchedRule: row.routing.matchedRule,
          error: row.routing.error,
        })
        const planned = planFormRoutingActions(routing, result).find(
          (action) =>
            action.key === row.action.key &&
            action.name === row.action.name &&
            action.index === row.action.index &&
            action.ruleId === row.action.ruleId,
        )
        if (!planned) throw new Error("Pending action does not match its publication")
        processed += 1
        await executeFormRoutingActions({
          identifiers: {
            tenantId: row.tenantId,
            formId: row.formId,
            publicationVersion: row.publicationVersion,
            submissionId: row.submissionId,
          },
          definition,
          routing,
          result,
          submission: row.submission,
          actions: [planned],
          store,
          registry,
        })
      })
    } catch (error) {
      failures.push(error)
    }
  })
  if (failures.length > 0) {
    throw new Error("Could not process every pending routing action")
  }
  return processed
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
  if (failures.length > 0) {
    throw new AggregateError(failures, "Bounded routing action work failed")
  }
}

export interface PendingRoutingActionExecution {
  readonly tenantId: string
  readonly formId: string
  readonly submissionId: string
  readonly publicationVersion: number
  readonly action: PlannedFormRoutingAction
  readonly submission: Readonly<Record<string, string | number | boolean>>
  readonly routing: SubmissionRoutingResult
}
