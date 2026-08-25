import type { Effect } from "effect"

import type { BillingFailure } from "./errors.js"
import type {
  BillingCheckoutSession,
  BillingCustomerPortalSession,
  BillingEvent,
  BillingSubject,
  CreateCheckoutRequest,
  CreateCustomerPortalRequest,
  ParseBillingWebhookRequest,
} from "./model.js"

export type ProviderCheckoutSession = Omit<BillingCheckoutSession, "provider">

export type ProviderCustomerPortalSession = Omit<BillingCustomerPortalSession, "provider">

export interface ProviderBillingSubject extends BillingSubject {
  readonly customerId: string | null
}

export interface ProviderCreateCheckoutRequest
  extends Omit<CreateCheckoutRequest, "subject" | "quantity" | "allowPromotionCodes"> {
  readonly subject: ProviderBillingSubject
  readonly quantity: number
  readonly allowPromotionCodes: boolean
}

export interface ProviderCreateCustomerPortalRequest extends CreateCustomerPortalRequest {
  readonly customerId: string
}

/** Adapter interface for offer mapping, hosted sessions, and webhooks. */
export interface BillingProvider {
  readonly name: string
  readonly offerIds: readonly string[]
  createCheckoutSession(
    request: ProviderCreateCheckoutRequest,
  ): Effect.Effect<ProviderCheckoutSession, BillingFailure>
  createCustomerPortalSession(
    request: ProviderCreateCustomerPortalRequest,
  ): Effect.Effect<ProviderCustomerPortalSession, BillingFailure>
  parseWebhook(request: ParseBillingWebhookRequest): Effect.Effect<BillingEvent, BillingFailure>
}
