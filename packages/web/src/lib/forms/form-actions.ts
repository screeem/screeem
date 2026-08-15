import type {
  ActionDefinition,
  ActionOutput,
  InferRuntimeType,
  RuntimeType,
} from "@screeem/routing"
import {
  snapshotSubmissionRoutingResult,
  type SubmissionRoutingResult,
  type SubmissionRoutingStatus,
} from "@screeem/forms"
import type { Effect } from "effect"
import type { IntegrationAutomationAccess } from "../integrations/automation-runtime"
import type { FormEventDeliveryKind } from "./form-delivery-contract"

export const formEventTypes = [
  "routing.evaluation.before",
  "routing.evaluation.after",
  "routing.matched",
  "submission.before_save",
  "submission.accepted",
] as const

export type FormEventType = (typeof formEventTypes)[number]
export type FormEventDelivery = "inline" | "isolated" | "durable"

export interface FormScope {
  readonly tenantId: string
  readonly formId: string
}

export interface FormPublicationScope extends FormScope {
  readonly publicationVersion: number
}

export interface FormEventPayloadMap {
  readonly "routing.evaluation.before": {
    readonly publicationVersion: number
    readonly evaluationId: string
    readonly submissionId: string
  }
  readonly "routing.evaluation.after": {
    readonly publicationVersion: number
    readonly evaluationId: string
    readonly submissionId: string
    readonly route: string | null
    readonly matchedRule: string | null
    readonly outcome: SubmissionRoutingStatus
    readonly durationMs: number
  }
  readonly "routing.matched": {
    readonly publicationVersion: number
    readonly submissionId: string
    readonly submission: Readonly<Record<string, string | number | boolean>>
    readonly ruleId: string
    readonly route: string
  }
  readonly "submission.before_save": FormSubmissionEventPayload
  readonly "submission.accepted": FormSubmissionEventPayload
}

export interface FormSubmissionEventPayload {
  readonly publicationVersion: number | null
  readonly submissionId: string
  readonly submission: Readonly<Record<string, unknown>>
  readonly routing: SubmissionRoutingResult
}

type FormEventEnvelope<Type extends FormEventType> = FormScope & {
  readonly eventId: string
  readonly type: Type
  readonly occurredAt: string
  readonly payload: FormEventPayloadMap[Type]
}

export type FormEvent<Type extends FormEventType = FormEventType> = {
  readonly [EventType in Type]: FormEventEnvelope<EventType>
}[Type]

export interface FormDeliveryContext<Type extends FormEventType = FormEventType> {
  readonly event: FormEvent<Type>
  readonly deliveryKey: string
  readonly idempotencyKey: string
  readonly signal: AbortSignal
}

export interface FormActionContext<Type extends FormEventType = FormEventType>
  extends FormDeliveryContext<Type> {
  readonly integrations: IntegrationAutomationAccess
}

export type FormEventHandlerContext<
  Type extends FormEventType,
  Delivery extends FormEventDelivery,
> = Delivery extends "durable" ? FormActionContext<Type> : FormDeliveryContext<Type>

export interface FormActionDefinition<
  Input extends RuntimeType = RuntimeType,
  Output extends ActionOutput = ActionOutput,
  Failure = unknown,
> extends Omit<ActionDefinition<Input, Output, Failure>, "run"> {
  readonly events: readonly ["routing.matched"]
  readonly run: (options: {
    readonly input: InferRuntimeType<Input>
    readonly context: FormActionContext<"routing.matched">
  }) => Effect.Effect<Output, Failure, never>
}

export interface FormEventHandlerDefinition<
  Event extends FormEventType = FormEventType,
  Delivery extends FormEventDelivery = FormEventDelivery,
  Failure = unknown,
> {
  readonly name: string
  readonly event: Event
  readonly delivery: Delivery
  readonly timeoutMs?: number
  readonly run: (options: {
    readonly event: FormEvent<Event>
    readonly context: FormEventHandlerContext<Event, Delivery>
  }) => Effect.Effect<void, Failure, never>
}

export interface PlannedFormEventDelivery {
  readonly event: FormEvent
  readonly kind: FormEventDeliveryKind
  readonly registrationName: string
  readonly deliveryKey: string
  readonly sequence: number
}

export interface StoredFormEventDelivery extends FormScope, PlannedFormEventDelivery {
  readonly publicationVersion: number | null
  readonly submissionId: string
  readonly streamSequence: number
}

export type PendingFormEventDelivery = StoredFormEventDelivery

export function snapshotFormEvent(input: unknown): FormEvent {
  if (!isRecord(input)) throw new TypeError("Invalid form event")
  const type = input.type
  if (!isFormEventType(type) || !isRecord(input.payload)) {
    throw new TypeError("Invalid form event")
  }
  const envelope = {
    eventId: boundedString(input.eventId, 256),
    type,
    occurredAt: boundedString(input.occurredAt, 64),
    tenantId: boundedString(input.tenantId, 128),
    formId: boundedString(input.formId, 128),
  }
  switch (type) {
    case "routing.evaluation.before":
      return freezeEvent({
        ...envelope,
        type,
        payload: {
          publicationVersion: positiveInteger(input.payload.publicationVersion),
          evaluationId: boundedString(input.payload.evaluationId, 128),
          submissionId: boundedString(input.payload.submissionId, 128),
        },
      })
    case "routing.evaluation.after":
      const routing = snapshotSubmissionRoutingResult({
        status: input.payload.outcome,
        route: input.payload.route,
        matchedRule: input.payload.matchedRule,
        error: input.payload.outcome === "failed" ? "routing_evaluation_failed" : null,
      })
      return freezeEvent({
        ...envelope,
        type,
        payload: {
          publicationVersion: positiveInteger(input.payload.publicationVersion),
          evaluationId: boundedString(input.payload.evaluationId, 128),
          submissionId: boundedString(input.payload.submissionId, 128),
          route: routing.route,
          matchedRule: routing.matchedRule,
          outcome: routing.status,
          durationMs: nonNegativeNumber(input.payload.durationMs),
        },
      })
    case "routing.matched":
      return freezeEvent({
        ...envelope,
        type,
        payload: {
          publicationVersion: positiveInteger(input.payload.publicationVersion),
          submissionId: boundedString(input.payload.submissionId, 128),
          submission: snapshotSubmission(input.payload.submission),
          ruleId: boundedString(input.payload.ruleId, 128),
          route: boundedString(input.payload.route, 256),
        },
      })
    case "submission.before_save":
    case "submission.accepted":
      return freezeEvent({
        ...envelope,
        type,
        payload: {
          publicationVersion: nullablePositiveInteger(input.payload.publicationVersion),
          submissionId: boundedString(input.payload.submissionId, 128),
          submission: snapshotJsonRecord(input.payload.submission),
          routing: snapshotSubmissionRoutingResult(input.payload.routing),
        },
      })
  }
}

export function isFormEventType(value: unknown): value is FormEventType {
  return formEventTypes.some((type) => type === value)
}

function freezeEvent<Type extends FormEventType>(event: FormEvent<Type>): FormEvent<Type> {
  return Object.freeze({
    ...event,
    payload: Object.freeze(event.payload),
  })
}

function snapshotSubmission(value: unknown) {
  if (!isRecord(value)) throw new TypeError("Invalid form event submission")
  const result: Record<string, string | number | boolean> = Object.create(null)
  for (const [name, field] of Object.entries(value)) {
    if (typeof field !== "string" && typeof field !== "number" && typeof field !== "boolean") {
      throw new TypeError("Invalid form event submission")
    }
    result[name] = field
  }
  return Object.freeze(result)
}

function snapshotJsonRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) throw new TypeError("Invalid form event submission")
  assertJsonDepth(value)
  const encoded = JSON.stringify(value)
  if (encoded === undefined || new TextEncoder().encode(encoded).byteLength > 65_536) {
    throw new TypeError("Invalid form event submission")
  }
  const snapshot: unknown = JSON.parse(encoded)
  if (!isRecord(snapshot)) throw new TypeError("Invalid form event submission")
  return freezeJson(snapshot)
}

function assertJsonDepth(value: Record<string, unknown>) {
  const pending: Array<{ readonly value: unknown; readonly depth: number }> = [
    { value, depth: 0 },
  ]
  while (pending.length > 0) {
    const current = pending.pop()!
    if (current.depth > 100) throw new TypeError("Form event submission is too deeply nested")
    if (typeof current.value !== "object" || current.value === null) continue
    for (const child of Object.values(current.value)) {
      pending.push({ value: child, depth: current.depth + 1 })
    }
  }
}

function freezeJson(value: Record<string, unknown>): Readonly<Record<string, unknown>> {
  const pending: object[] = [value]
  while (pending.length > 0) {
    const current = pending.pop()!
    for (const child of Object.values(current)) {
      if (typeof child === "object" && child !== null) pending.push(child)
    }
    Object.freeze(current)
  }
  return value
}

function positiveInteger(value: unknown) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new TypeError("Expected a positive integer")
  }
  return value
}

function nullablePositiveInteger(value: unknown) {
  return value === null ? null : positiveInteger(value)
}

function nonNegativeNumber(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TypeError("Expected a non-negative number")
  }
  return value
}

function boundedString(value: unknown, maximumLength: number) {
  if (typeof value !== "string" || value.length === 0 || value.length > maximumLength) {
    throw new TypeError("Expected a bounded string")
  }
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
