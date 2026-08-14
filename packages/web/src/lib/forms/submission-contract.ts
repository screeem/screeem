import {
  snapshotSubmissionRoutingResult,
  type StoredSubmission,
  type SubmissionRoutingResult,
} from "@screeem/forms"
import {
  isFormEventDeliveryStatus,
  isFormEventDeliveryKind,
  type FormEventDeliverySummary,
} from "./form-delivery-contract"
import { isFormEventType } from "./form-actions"
export const maximumSubmissionRouteOptions = 256

export interface FormSubmissionListItem {
  readonly id: StoredSubmission["id"]
  readonly payload: Readonly<Record<string, unknown>>
  readonly origin: string | null
  readonly created_at: StoredSubmission["createdAt"]
  readonly publication_version: StoredSubmission["publicationVersion"]
  readonly routing_status: SubmissionRoutingResult["status"]
  readonly routing_route: SubmissionRoutingResult["route"]
  readonly matched_rule_id: SubmissionRoutingResult["matchedRule"]
  readonly routing_error: SubmissionRoutingResult["error"]
  readonly event_deliveries: readonly FormEventDeliverySummary[]
}

export interface FormSubmissionsApiResponse {
  readonly submissions: readonly FormSubmissionListItem[]
  readonly routes: readonly string[]
}

export function snapshotFormSubmissionsApiResponse(input: unknown): FormSubmissionsApiResponse {
  if (!isRecord(input) || !Array.isArray(input.submissions) || !Array.isArray(input.routes)) {
    throw new TypeError("Invalid form submissions response")
  }
  if (input.routes.length > maximumSubmissionRouteOptions) {
    throw new TypeError("Too many form submission routes")
  }
  const routes = input.routes.map(requiredString)
  const submissions = input.submissions.map(snapshotSubmission)
  return Object.freeze({
    submissions: Object.freeze(submissions),
    routes: Object.freeze(routes),
  })
}

function snapshotSubmission(value: unknown): FormSubmissionListItem {
  if (
    !isRecord(value) ||
    !isRecord(value.payload) ||
    (value.event_deliveries !== undefined && !Array.isArray(value.event_deliveries))
  ) {
    throw new TypeError("Invalid submission response")
  }
  const id = requiredString(value.id)
  const routing = snapshotSubmissionRoutingResult({
    status: value.routing_status,
    route: value.routing_route,
    matchedRule: value.matched_rule_id,
    error: value.routing_error,
  })
  return Object.freeze({
    id,
    payload: Object.freeze({ ...value.payload }),
    origin: nullableString(value.origin),
    created_at: requiredString(value.created_at),
    publication_version: nullableNonNegativeInteger(value.publication_version),
    routing_status: routing.status,
    routing_route: routing.route,
    matched_rule_id: routing.matchedRule,
    routing_error: routing.error,
    event_deliveries: Object.freeze(
      (value.event_deliveries ?? []).map((delivery) => snapshotDelivery(delivery, id)),
    ),
  })
}

function snapshotDelivery(value: unknown, submissionId: string): FormEventDeliverySummary {
  if (!isRecord(value) || value.submission_id !== submissionId) {
    throw new TypeError("Invalid form event delivery response")
  }
  const status = value.status
  if (!isFormEventDeliveryStatus(status)) {
    throw new TypeError("Invalid form event delivery status")
  }
  if (!isFormEventType(value.event_type)) {
    throw new TypeError("Invalid form event type")
  }
  if (!isFormEventDeliveryKind(value.delivery_kind)) {
    throw new TypeError("Invalid form event delivery kind")
  }
  return Object.freeze({
    submission_id: submissionId,
    delivery_key: requiredString(value.delivery_key),
    registration_name: requiredString(value.registration_name),
    event_type: value.event_type,
    delivery_kind: value.delivery_kind,
    status,
    attempt_count: requiredNonNegativeInteger(value.attempt_count),
    last_error: nullableString(value.last_error),
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function requiredString(value: unknown): string {
  if (typeof value !== "string") throw new TypeError("Expected a string")
  return value
}

function nullableString(value: unknown): string | null {
  if (value === null) return null
  return requiredString(value)
}

function requiredNonNegativeInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("Expected a non-negative integer")
  }
  return value
}

function nullableNonNegativeInteger(value: unknown): number | null {
  if (value === null) return null
  return requiredNonNegativeInteger(value)
}
