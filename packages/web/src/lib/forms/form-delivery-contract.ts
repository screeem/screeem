import type { FormEventType } from "./form-actions"

export const maximumFormEventDeliveries = 100
export const formEventDeliveryKinds = ["routing_action", "event_handler"] as const
export const formEventDeliveryStatuses = ["pending", "running", "succeeded", "failed"] as const

export type FormEventDeliveryKind = (typeof formEventDeliveryKinds)[number]
export type FormEventDeliveryStatus = (typeof formEventDeliveryStatuses)[number]

export interface FormEventDeliverySummary {
  readonly submission_id: string
  readonly delivery_key: string
  readonly registration_name: string
  readonly event_type: FormEventType
  readonly delivery_kind: FormEventDeliveryKind
  readonly status: FormEventDeliveryStatus
  readonly attempt_count: number
  readonly last_error: string | null
}

export function isFormEventDeliveryStatus(value: unknown): value is FormEventDeliveryStatus {
  return formEventDeliveryStatuses.some((status) => status === value)
}

export function isFormEventDeliveryKind(value: unknown): value is FormEventDeliveryKind {
  return formEventDeliveryKinds.some((kind) => kind === value)
}
