export type BillingCheckoutMode = "subscription" | "payment"

/** A tenant, workspace, or account that owns billing. */
export interface BillingSubject {
  readonly id: string
  readonly email?: string
}

export interface CreateCheckoutRequest {
  readonly subject: BillingSubject
  /** Stable application-owned identifier mapped to a provider price by the adapter. */
  readonly offerId: string
  readonly quantity?: number
  readonly successUrl: string
  readonly cancelUrl: string
  readonly idempotencyKey: string
  readonly allowPromotionCodes?: boolean
}

export interface BillingCheckoutSession {
  readonly provider: string
  readonly id: string
  readonly url: string
  readonly customerId: string | null
  readonly expiresAt: string | null
}

export interface CreateCustomerPortalRequest {
  readonly subjectId: string
  readonly returnUrl: string
  readonly idempotencyKey: string
}

export interface BillingCustomerPortalSession {
  readonly provider: string
  readonly id: string
  readonly url: string
}

export interface ParseBillingWebhookRequest {
  /** The unparsed request bytes. Signature verification fails if JSON is re-serialized. */
  readonly payload: string | Uint8Array
  /** The provider's signature header value. */
  readonly signature: string
}

export type BillingPaymentStatus = "paid" | "unpaid" | "no_payment_required" | "unknown"

export type BillingSubscriptionStatus =
  | "incomplete"
  | "expired"
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "unpaid"
  | "paused"
  | "unknown"

interface BillingEventBase {
  readonly id: string
  readonly provider: string
  readonly providerEventType: string
  readonly occurredAt: string
}

export interface BillingCheckoutEvent extends BillingEventBase {
  readonly kind: "checkout.completed" | "checkout.payment_failed"
  readonly checkoutId: string
  readonly subjectId: string
  readonly offerId: string
  readonly quantity: number
  readonly customerId: string | null
  readonly subscriptionId: string | null
  readonly paymentStatus: BillingPaymentStatus
}

export interface BillingSubscriptionChangedEvent extends BillingEventBase {
  readonly kind: "subscription.changed"
  readonly subjectId: string
  readonly offerId: string
  readonly quantity: number
  readonly customerId: string
  readonly subscriptionId: string
  readonly status: BillingSubscriptionStatus
  readonly cancelAtPeriodEnd: boolean
}

export interface BillingInvoiceEvent extends BillingEventBase {
  readonly kind: "invoice.paid" | "invoice.payment_failed"
  readonly subjectId: string | null
  readonly offerId: string | null
  readonly quantity: number | null
  readonly customerId: string
  readonly subscriptionId: string | null
  readonly invoiceId: string
  /** Amounts are integer minor currency units, for example cents. */
  readonly amountDue: number
  readonly amountPaid: number
  readonly currency: string
}

export interface UnsupportedBillingEvent extends BillingEventBase {
  readonly kind: "unsupported"
}

export type BillingEvent =
  | BillingCheckoutEvent
  | BillingSubscriptionChangedEvent
  | BillingInvoiceEvent
  | UnsupportedBillingEvent

export interface BillingDescription {
  readonly provider: string
  readonly offers: readonly string[]
  readonly maximumWebhookBytes: number
}
