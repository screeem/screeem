import { Data } from "effect"

export type BillingErrorCode =
  | "invalid_billing_configuration"
  | "invalid_billing_request"
  | "unsupported_billing_offer"
  | "billing_customer_not_found"
  | "invalid_billing_webhook"
  | "billing_provider_unavailable"

export class BillingConfigurationError extends Data.TaggedError(
  "BillingConfigurationError",
)<{
  readonly reason: string
}> {
  readonly code = "invalid_billing_configuration" as const

  get message(): string {
    return `Billing configuration is invalid: ${this.reason}`
  }
}

export class InvalidBillingRequestError extends Data.TaggedError(
  "InvalidBillingRequestError",
)<{
  readonly reason: string
}> {
  readonly code = "invalid_billing_request" as const

  get message(): string {
    return `Billing request is invalid: ${this.reason}`
  }
}

export class UnsupportedBillingOfferError extends Data.TaggedError(
  "UnsupportedBillingOfferError",
)<{
  readonly offerId: string
  readonly provider: string
}> {
  readonly code = "unsupported_billing_offer" as const

  get message(): string {
    return `Billing offer ${this.offerId} is not configured for ${this.provider}`
  }
}

export class BillingCustomerNotFoundError extends Data.TaggedError(
  "BillingCustomerNotFoundError",
)<{
  readonly provider: string
}> {
  readonly code = "billing_customer_not_found" as const

  get message(): string {
    return `No ${this.provider} billing customer exists for this subject`
  }
}

export class InvalidBillingWebhookError extends Data.TaggedError(
  "InvalidBillingWebhookError",
)<{
  readonly provider: string
  readonly reason: string
}> {
  readonly code = "invalid_billing_webhook" as const

  get message(): string {
    return `${this.provider} webhook is invalid: ${this.reason}`
  }
}

export class BillingProviderUnavailableError extends Data.TaggedError(
  "BillingProviderUnavailableError",
)<{
  readonly provider: string
  readonly operation: string
}> {
  readonly code = "billing_provider_unavailable" as const

  get message(): string {
    return `${this.provider} could not complete ${this.operation}`
  }
}

export type BillingFailure =
  | InvalidBillingRequestError
  | UnsupportedBillingOfferError
  | BillingCustomerNotFoundError
  | InvalidBillingWebhookError
  | BillingProviderUnavailableError

export type BillingError = BillingConfigurationError | BillingFailure

export function isBillingError(error: unknown): error is BillingError {
  return error instanceof BillingConfigurationError || isBillingFailure(error)
}

export function isBillingFailure(error: unknown): error is BillingFailure {
  return (
    error instanceof InvalidBillingRequestError ||
    error instanceof UnsupportedBillingOfferError ||
    error instanceof BillingCustomerNotFoundError ||
    error instanceof InvalidBillingWebhookError ||
    error instanceof BillingProviderUnavailableError
  )
}
