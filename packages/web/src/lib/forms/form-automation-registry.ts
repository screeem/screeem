import {
  createRouter,
  type ActionOutput,
  type PureFunctionDefinition,
  type Router,
  type RuntimeType,
} from "@screeem/routing"
import { Effect } from "effect"
import {
  formEventTypes,
  snapshotFormEvent,
  type FormActionDefinition,
  type FormEvent,
  type FormEventDelivery,
  type FormEventHandlerDefinition,
  type FormEventType,
  type PlannedFormEventDelivery,
} from "./form-actions"
import { maximumFormEventDeliveries } from "./form-delivery-contract"

type StoredAction = FormActionDefinition<RuntimeType, ActionOutput, unknown>
type StoredHandler = FormEventHandlerDefinition<FormEventType, FormEventDelivery, unknown>

const maximumActionTimeoutMs = 15_000
const maximumHandlerTimeoutMs = 15_000

export class FormAutomationRegistry {
  private constructor(
    private readonly functions: readonly PureFunctionDefinition[],
    private readonly actions: ReadonlyMap<string, StoredAction>,
    private readonly handlers: readonly StoredHandler[],
  ) {}

  static create() {
    return new FormAutomationRegistry([], new Map(), [])
  }

  registerPureFunction<Input extends readonly RuntimeType[], Output extends RuntimeType>(
    definition: PureFunctionDefinition<Input, Output>,
  ): FormAutomationRegistry {
    assertRegistrationName(definition.name)
    if (this.hasRegistration(definition.name)) duplicateRegistration(definition.name)
    const registered = Object.freeze({
      name: definition.name,
      input: Object.freeze(definition.input.map(snapshotRuntimeType)),
      output: snapshotRuntimeType(definition.output),
      run: definition.run,
    }) as PureFunctionDefinition
    const functions = Object.freeze([...this.functions, registered])
    this.buildRouter(functions, this.actions)
    return new FormAutomationRegistry(functions, this.actions, this.handlers)
  }

  registerAction<
    Input extends RuntimeType,
    Output extends ActionOutput,
    Failure,
  >(definition: FormActionDefinition<Input, Output, Failure>): FormAutomationRegistry {
    assertRegistrationName(definition.name)
    assertTimeout(definition.timeoutMs, maximumActionTimeoutMs, "Form action")
    if (this.hasRegistration(definition.name)) duplicateRegistration(definition.name)
    const events: readonly unknown[] = definition.events
    if (events.length !== 1 || events[0] !== "routing.matched") {
      throw new TypeError("Form action events are invalid")
    }
    const registered = Object.freeze({
      name: definition.name,
      events: Object.freeze([...new Set(definition.events)]),
      input: snapshotRuntimeType(definition.input),
      ...(definition.timeoutMs === undefined ? {} : { timeoutMs: definition.timeoutMs }),
      run: definition.run,
    }) as unknown as StoredAction
    const actions = new Map(this.actions)
    actions.set(registered.name, registered)
    this.buildRouter(this.functions, actions)
    return new FormAutomationRegistry(this.functions, actions, this.handlers)
  }

  onEvent<Event extends FormEventType, Delivery extends FormEventDelivery, Failure>(
    definition: FormEventHandlerDefinition<Event, Delivery, Failure>,
  ): FormAutomationRegistry {
    assertRegistrationName(definition.name)
    assertTimeout(definition.timeoutMs, maximumHandlerTimeoutMs, "Form event handler")
    if (this.hasRegistration(definition.name)) duplicateRegistration(definition.name)
    if (!formEventTypes.some((event) => event === definition.event)) {
      throw new TypeError("Form event type is invalid")
    }
    if (
      definition.delivery !== "inline" &&
      definition.delivery !== "isolated" &&
      definition.delivery !== "durable"
    ) {
      throw new TypeError("Form event delivery is invalid")
    }
    if (definition.event === "submission.accepted" && definition.delivery === "inline") {
      throw new TypeError("Accepted submission handlers cannot use inline delivery")
    }
    const durableForEvent = this.handlers.filter(
      ({ event, delivery }) => event === definition.event && delivery === "durable",
    ).length
    const maximumDurableHandlers = definition.event === "routing.matched" ? 10 : 20
    if (definition.delivery === "durable" && durableForEvent >= maximumDurableHandlers) {
      throw new Error(`Too many durable handlers for ${definition.event}`)
    }
    const handler = Object.freeze({ ...definition }) as unknown as StoredHandler
    return new FormAutomationRegistry(
      this.functions,
      this.actions,
      Object.freeze([...this.handlers, handler]),
    )
  }

  compilationRouter(): Router {
    return this.buildRouter(this.functions, this.actions)
  }

  actionRouter(event: FormEvent<"routing.matched">, deliveryKey: string): Router {
    const safeEvent = snapshotFormEvent(event) as FormEvent<"routing.matched">
    return this.buildRouter(this.functions, this.actions, { event: safeEvent, deliveryKey })
  }

  async runInline(event: FormEvent): Promise<void> {
    const safeEvent = snapshotFormEvent(event)
    for (const handler of this.handlersFor(safeEvent, "inline")) {
      await runHandler(handler, safeEvent, `${safeEvent.eventId}:${handler.name}`)
    }
  }

  async runIsolated(event: FormEvent): Promise<void> {
    const safeEvent = snapshotFormEvent(event)
    await Promise.all(
      this.handlersFor(safeEvent, "isolated").map(async (handler) => {
        try {
          await runHandler(handler, safeEvent, `${safeEvent.eventId}:${handler.name}`)
        } catch {}
      }),
    )
  }

  planDurable(event: FormEvent, firstSequence = 0): readonly PlannedFormEventDelivery[] {
    const safeEvent = snapshotFormEvent(event)
    const handlers = this.handlersFor(safeEvent, "durable")
    if (firstSequence + handlers.length > maximumFormEventDeliveries) {
      throw new Error(
        `A form event cannot have more than ${maximumFormEventDeliveries} durable deliveries`,
      )
    }
    return Object.freeze(
      handlers.map((handler, offset) => {
        const sequence = firstSequence + offset
        return Object.freeze({
          event: safeEvent,
          kind: "event_handler" as const,
          registrationName: handler.name,
          deliveryKey: `${safeEvent.eventId}:${sequence}`,
          sequence,
        })
      }),
    )
  }

  async runDurableHandler(delivery: PlannedFormEventDelivery): Promise<ActionOutput> {
    const handler = this.handlers.find(
      ({ name, event, delivery: mode }) =>
        name === delivery.registrationName && event === delivery.event.type && mode === "durable",
    )
    if (!handler) throw new Error("Durable form event handler is not registered")
    await runHandler(handler, snapshotFormEvent(delivery.event), delivery.deliveryKey)
    return undefined
  }

  private hasRegistration(name: string) {
    return (
      this.functions.some((definition) => definition.name === name) ||
      this.actions.has(name) ||
      this.handlers.some((handler) => handler.name === name)
    )
  }

  private handlersFor(event: FormEvent, delivery: FormEventDelivery) {
    return this.handlers.filter(
      (handler) => handler.event === event.type && handler.delivery === delivery,
    )
  }

  private buildRouter(
    functions: readonly PureFunctionDefinition[],
    actions: ReadonlyMap<string, StoredAction>,
    execution?: {
      readonly event: FormEvent<"routing.matched">
      readonly deliveryKey: string
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
          if (!execution) return Effect.die("Form actions cannot run during compilation")
          return definition.run({
            input,
            context: {
              event: execution.event,
              deliveryKey: execution.deliveryKey,
              idempotencyKey: execution.deliveryKey,
              signal: context.signal,
            },
          })
        },
      })
    }
    return router
  }
}

async function runHandler(
  handler: StoredHandler,
  event: FormEvent,
  deliveryKey: string,
) {
  const controller = new AbortController()
  const effect = handler.run({
    event,
    context: {
      event,
      deliveryKey,
      idempotencyKey: deliveryKey,
      signal: controller.signal,
    },
  })
  if (!Effect.isEffect(effect)) throw new TypeError("Form event handler must return an Effect")
  const timeoutMs = handler.timeoutMs ?? 1_000
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  const run = Effect.runPromise(
    effect.pipe(
      Effect.disconnect,
      Effect.timeout(timeoutMs),
    ),
  ).finally(() => clearTimeout(timeout))
  await run
}

function assertRegistrationName(name: string) {
  if (name.length === 0 || name.length > 128) throw new TypeError("Invalid registration name")
}

function assertTimeout(timeoutMs: number | undefined, maximum: number, label: string) {
  if (
    timeoutMs !== undefined &&
    (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > maximum)
  ) {
    throw new TypeError(`${label} timeout must be between 1 and ${maximum} milliseconds`)
  }
}

function duplicateRegistration(name: string): never {
  throw new Error(`A registration named ${name} already exists`)
}

function snapshotRuntimeType(runtimeType: RuntimeType): RuntimeType {
  switch (runtimeType.kind) {
    case "string":
    case "number":
    case "boolean":
      return Object.freeze({ kind: runtimeType.kind }) as RuntimeType
    case "enum":
      return Object.freeze({ kind: "enum", values: Object.freeze([...runtimeType.values]) }) as RuntimeType
    case "array":
      return Object.freeze({ kind: "array", item: snapshotRuntimeType(runtimeType.item) }) as RuntimeType
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

export function createFormAutomationRegistry() {
  return FormAutomationRegistry.create()
}
