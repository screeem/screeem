import {
  createRouter,
  type ActionDefinition,
  type ActionOutput,
  type InferRuntimeType,
  type PureFunctionDefinition,
  type Router,
  type RoutingContext,
  type RuntimeType,
} from "@screeem/routing"
import type { SubmissionRoutingStatus } from "@screeem/forms"
import { Effect } from "effect"

export interface FormRoutingPublicationIdentifiers {
  readonly tenantId: string
  readonly formId: string
  readonly publicationVersion: number
}

export interface FormRoutingIdentifiers extends FormRoutingPublicationIdentifiers {
  readonly submissionId: string
}

export interface FormRoutingEvaluationIdentifiers extends FormRoutingPublicationIdentifiers {
  readonly evaluationId: string
}

export interface BeforeFormRoutingEvaluation extends FormRoutingEvaluationIdentifiers {
  readonly type: "before_evaluation"
  readonly occurredAt: string
}

export interface AfterFormRoutingEvaluation extends FormRoutingEvaluationIdentifiers {
  readonly type: "after_evaluation"
  readonly occurredAt: string
  readonly route: string | null
  readonly matchedRule: string | null
  readonly outcome: SubmissionRoutingStatus
  readonly durationMs: number
}

export interface FormRoutingActionContext extends FormRoutingIdentifiers, RoutingContext {
  readonly actionKey: string
  readonly idempotencyKey: string
}

export interface FormRoutingActionDefinition<
  Input extends RuntimeType = RuntimeType,
  Output extends ActionOutput = ActionOutput,
  Failure = unknown,
> extends Omit<ActionDefinition<Input, Output, Failure>, "run"> {
  readonly run: (options: {
    readonly input: InferRuntimeType<Input>
    readonly context: FormRoutingActionContext
  }) => Effect.Effect<Output, Failure, never>
}

export type BeforeFormRoutingHandler = (
  event: BeforeFormRoutingEvaluation,
) => Effect.Effect<void, unknown, never>

export type AfterFormRoutingHandler = (
  event: AfterFormRoutingEvaluation,
) => Effect.Effect<void, unknown, never>

type StoredAction = FormRoutingActionDefinition<RuntimeType, ActionOutput, unknown>
const MAXIMUM_FORM_ACTION_TIMEOUT_MS = 15_000

export class FormRoutingRegistry {
  private constructor(
    private readonly functions: readonly PureFunctionDefinition[],
    private readonly actions: ReadonlyMap<string, StoredAction>,
    private readonly beforeHandlers: readonly BeforeFormRoutingHandler[],
    private readonly afterHandlers: readonly AfterFormRoutingHandler[],
    private readonly eventTimeoutMs: number,
  ) {}

  static create(options: { readonly eventTimeoutMs?: number } = {}) {
    const eventTimeoutMs = options.eventTimeoutMs ?? 1_000
    if (!Number.isSafeInteger(eventTimeoutMs) || eventTimeoutMs <= 0) {
      throw new TypeError("Routing event timeout must be a positive integer")
    }
    return new FormRoutingRegistry([], new Map(), [], [], eventTimeoutMs)
  }

  registerPureFunction<Input extends readonly RuntimeType[], Output extends RuntimeType>(
    definition: PureFunctionDefinition<Input, Output>,
  ): FormRoutingRegistry {
    const registered = Object.freeze({
      name: definition.name,
      input: Object.freeze(definition.input.map(snapshotRuntimeType)),
      output: snapshotRuntimeType(definition.output),
      run: definition.run,
    }) as PureFunctionDefinition
    const functions = [...this.functions, registered]
    this.buildRouter(functions, this.actions)
    return new FormRoutingRegistry(
      Object.freeze(functions),
      this.actions,
      this.beforeHandlers,
      this.afterHandlers,
      this.eventTimeoutMs,
    )
  }

  registerAction<Input extends RuntimeType, Output extends ActionOutput, Failure>(
    definition: FormRoutingActionDefinition<Input, Output, Failure>,
  ): FormRoutingRegistry {
    if (
      definition.timeoutMs !== undefined &&
      (!Number.isSafeInteger(definition.timeoutMs) ||
        definition.timeoutMs <= 0 ||
        definition.timeoutMs > MAXIMUM_FORM_ACTION_TIMEOUT_MS)
    ) {
      throw new TypeError(
        `Form routing action timeout must be between 1 and ${MAXIMUM_FORM_ACTION_TIMEOUT_MS} milliseconds`,
      )
    }
    if (this.actions.has(definition.name)) {
      throw new Error(`A registration named ${definition.name} already exists`)
    }
    const registered = Object.freeze({
      name: definition.name,
      input: snapshotRuntimeType(definition.input),
      ...(definition.timeoutMs === undefined ? {} : { timeoutMs: definition.timeoutMs }),
      run: definition.run,
    }) as StoredAction
    const actions = new Map(this.actions)
    actions.set(registered.name, registered)
    this.buildRouter(this.functions, actions)
    return new FormRoutingRegistry(
      this.functions,
      actions,
      this.beforeHandlers,
      this.afterHandlers,
      this.eventTimeoutMs,
    )
  }

  onBeforeEvaluation(handler: BeforeFormRoutingHandler): FormRoutingRegistry {
    return new FormRoutingRegistry(
      this.functions,
      this.actions,
      Object.freeze([...this.beforeHandlers, handler]),
      this.afterHandlers,
      this.eventTimeoutMs,
    )
  }

  onAfterEvaluation(handler: AfterFormRoutingHandler): FormRoutingRegistry {
    return new FormRoutingRegistry(
      this.functions,
      this.actions,
      this.beforeHandlers,
      Object.freeze([...this.afterHandlers, handler]),
      this.eventTimeoutMs,
    )
  }

  compilationRouter(): Router {
    return this.buildRouter(this.functions, this.actions)
  }

  actionRouter(
    identifiers: FormRoutingIdentifiers,
    actionKey: string,
  ): Router {
    return this.buildRouter(this.functions, this.actions, { identifiers, actionKey })
  }

  async emitBefore(event: BeforeFormRoutingEvaluation): Promise<void> {
    await this.emit(this.beforeHandlers, event)
  }

  async emitAfter(event: AfterFormRoutingEvaluation): Promise<void> {
    await this.emit(this.afterHandlers, event)
  }

  private buildRouter(
    functions: readonly PureFunctionDefinition[],
    actions: ReadonlyMap<string, StoredAction>,
    execution?: {
      readonly identifiers: FormRoutingIdentifiers
      readonly actionKey: string
    },
  ): Router {
    let router = createRouter()
    for (const definition of functions) router = router.registerPureFunction(definition)
    for (const definition of actions.values()) {
      router = router.registerAction({
        name: definition.name,
        input: definition.input,
        ...(definition.timeoutMs === undefined ? {} : { timeoutMs: definition.timeoutMs }),
        run: ({ input, context }) => {
          if (!execution) return Effect.die("Routing actions cannot run during compilation")
          return definition.run({
            input,
            context: {
              ...execution.identifiers,
              actionKey: execution.actionKey,
              idempotencyKey: `${execution.identifiers.submissionId}:${execution.actionKey}`,
              submission: context.submission,
              ruleId: context.ruleId,
              route: context.route,
              signal: context.signal,
            },
          })
        },
      })
    }
    return router
  }

  private async emit<Event>(
    handlers: readonly ((event: Event) => Effect.Effect<void, unknown, never>)[],
    event: Event,
  ) {
    const snapshot =
      typeof event === "object" && event !== null
        ? Object.freeze({ ...event }) as Event
        : event
    await Promise.all(
      handlers.map(async (handler) => {
        try {
          const effect = handler(snapshot)
          if (!Effect.isEffect(effect)) return
          await Effect.runPromise(
            effect.pipe(
              Effect.disconnect,
              Effect.timeout(this.eventTimeoutMs),
              Effect.catchAllCause(() => Effect.void),
            ),
          )
        } catch {}
      }),
    )
  }
}

function snapshotRuntimeType(runtimeType: RuntimeType): RuntimeType {
  switch (runtimeType.kind) {
    case "string":
    case "number":
    case "boolean":
      return Object.freeze({ kind: runtimeType.kind }) as RuntimeType
    case "enum":
      return Object.freeze({
        kind: "enum",
        values: Object.freeze([...runtimeType.values]),
      }) as RuntimeType
    case "array":
      return Object.freeze({
        kind: "array",
        item: snapshotRuntimeType(runtimeType.item),
      }) as RuntimeType
    case "object":
      return Object.freeze({
        kind: "object",
        properties: Object.freeze(
          Object.fromEntries(
            Object.entries(runtimeType.properties).map(([name, value]) => [
              name,
              snapshotRuntimeType(value),
            ]),
          ),
        ),
      }) as RuntimeType
  }
}

export function createFormRoutingRegistry(options: { readonly eventTimeoutMs?: number } = {}) {
  return FormRoutingRegistry.create(options)
}
