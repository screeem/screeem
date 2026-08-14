import {
  snapshotSubmissionRoutingResult,
  type StoredSubmission,
  type SubmissionRoutingResult,
} from "@screeem/forms"

export const formRoutingActionExecutionStatuses = [
  "pending",
  "running",
  "succeeded",
  "failed",
] as const
export const maximumSubmissionRouteOptions = 256

export type FormRoutingActionExecutionStatus =
  (typeof formRoutingActionExecutionStatuses)[number]

export interface FormRoutingActionExecutionSummary {
  readonly submission_id: string
  readonly action_key: string
  readonly action_name: string
  readonly status: FormRoutingActionExecutionStatus
  readonly attempt_count: number
  readonly last_error: string | null
}

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
  readonly action_executions: readonly FormRoutingActionExecutionSummary[]
}

export interface FormSubmissionsApiResponse {
  readonly submissions: readonly FormSubmissionListItem[]
  readonly routes: readonly string[]
}

export function isFormRoutingActionExecutionStatus(
  value: unknown,
): value is FormRoutingActionExecutionStatus {
  return formRoutingActionExecutionStatuses.some((status) => status === value)
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
    (value.action_executions !== undefined && !Array.isArray(value.action_executions))
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
    action_executions: Object.freeze(
      (value.action_executions ?? []).map((action) => snapshotAction(action, id)),
    ),
  })
}

function snapshotAction(value: unknown, submissionId: string): FormRoutingActionExecutionSummary {
  if (!isRecord(value) || value.submission_id !== submissionId) {
    throw new TypeError("Invalid action execution response")
  }
  const status = value.status
  if (!isFormRoutingActionExecutionStatus(status)) {
    throw new TypeError("Invalid action execution status")
  }
  return Object.freeze({
    submission_id: submissionId,
    action_key: requiredString(value.action_key),
    action_name: requiredString(value.action_name),
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
