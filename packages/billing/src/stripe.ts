import { Effect } from "effect"
import Stripe from "stripe"

import {
  BillingConfigurationError,
  BillingProviderUnavailableError,
  InvalidBillingWebhookError,
  UnsupportedBillingOfferError,
} from "./errors.js"
import type {
  BillingCheckoutMode,
  BillingEvent,
  BillingPaymentStatus,
  BillingSubscriptionStatus,
  ParseBillingWebhookRequest,
} from "./model.js"
import type {
  BillingProvider,
  ProviderCreateCheckoutRequest,
  ProviderCreateCustomerPortalRequest,
} from "./provider.js"
import { configurationString, offerId } from "./validation.js"

export interface StripeBillingOffer {
  readonly priceId: string
  readonly mode: BillingCheckoutMode
}

export interface StripeBillingProviderConfiguration {
  /** Required when client is not set. */
  readonly secretKey?: string
  readonly webhookSecret: string
  readonly offers: Readonly<Record<string, StripeBillingOffer>>
  readonly maxNetworkRetries?: number
  readonly timeoutMs?: number
  /** Inject a shared Stripe client or a test double. */
  readonly client?: Stripe
}

interface ResolvedStripeOffer extends StripeBillingOffer {
  readonly offerId: string
}

const stripeProviderName = "stripe"
const metadataVersion = "1"
const metadataVersionKey = "billing_contract_version"
const metadataSubjectKey = "billing_subject_id"
const metadataOfferKey = "billing_offer_id"
const metadataQuantityKey = "billing_quantity"
const subjectIdentifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/
const eventOfferIdentifier = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/
const providerIdentifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,511}$/
const controlCharacters = /[\u0000-\u001F\u007F-\u009F]/

export const stripeBillingApiVersion = "2026-07-29.dahlia" satisfies Stripe.LatestApiVersion

/** Implements BillingProvider with Stripe Checkout, Billing Portal, and webhooks. */
export function createStripeBillingProvider(
  configuration: StripeBillingProviderConfiguration,
): Effect.Effect<BillingProvider, BillingConfigurationError> {
  return Effect.suspend(() => {
    try {
      return Effect.succeed(makeStripeBillingProvider(configuration))
    } catch (error) {
      return error instanceof BillingConfigurationError
        ? Effect.fail(error)
        : Effect.die(error)
    }
  })
}

function makeStripeBillingProvider(
  configuration: StripeBillingProviderConfiguration,
): BillingProvider {
  const webhookSecret = configurationString(
    configuration.webhookSecret,
    "Stripe webhook secret",
  )
  const offers = resolveOffers(configuration.offers)
  const offersByPriceId = new Map([...offers.values()].map((offer) => [offer.priceId, offer]))
  const client = configuration.client ?? createStripeClient(configuration)

  return Object.freeze({
    name: stripeProviderName,
    offerIds: Object.freeze([...offers.keys()].sort()),

    createCheckoutSession: (request: ProviderCreateCheckoutRequest) =>
      Effect.gen(function* () {
        const configuredOffer = offers.get(request.offerId)
        if (!configuredOffer) {
          return yield* Effect.fail(
            new UnsupportedBillingOfferError({
              offerId: request.offerId,
              provider: stripeProviderName,
            }),
          )
        }

        const metadata = {
          [metadataVersionKey]: metadataVersion,
          [metadataSubjectKey]: request.subject.id,
          [metadataOfferKey]: request.offerId,
          [metadataQuantityKey]: String(request.quantity),
        }
        const customer = request.subject.customerId
          ? { customer: request.subject.customerId }
          : request.subject.email
            ? { customer_email: request.subject.email }
            : {}
        const modeData =
          configuredOffer.mode === "subscription"
            ? { subscription_data: { metadata } }
            : {
                payment_intent_data: { metadata },
                ...(request.subject.customerId ? {} : { customer_creation: "always" as const }),
              }

        const session = yield* Effect.tryPromise({
          try: () =>
            client.checkout.sessions.create(
              {
                mode: configuredOffer.mode,
                line_items: [
                  {
                    price: configuredOffer.priceId,
                    quantity: request.quantity,
                  },
                ],
                client_reference_id: request.subject.id,
                success_url: request.successUrl,
                cancel_url: request.cancelUrl,
                allow_promotion_codes: request.allowPromotionCodes,
                metadata,
                ...customer,
                ...modeData,
              },
              { idempotencyKey: request.idempotencyKey },
            ),
          catch: () =>
            new BillingProviderUnavailableError({
              provider: stripeProviderName,
              operation: "checkout session creation",
            }),
        })

        return yield* stripeResponse("checkout session creation", () => {
          const url = responseUrl(session.url, "checkout URL")
          return Object.freeze({
            id: responseString(session.id, "checkout session ID"),
            url,
            customerId: responseExternalId(session.customer, "checkout customer ID"),
            expiresAt: responseTimestamp(session.expires_at, "checkout expiry"),
          })
        })
      }),

    createCustomerPortalSession: (request: ProviderCreateCustomerPortalRequest) =>
      Effect.tryPromise({
        try: () =>
          client.billingPortal.sessions.create(
            {
              customer: request.customerId,
              return_url: request.returnUrl,
            },
            { idempotencyKey: request.idempotencyKey },
          ),
        catch: () =>
          new BillingProviderUnavailableError({
            provider: stripeProviderName,
            operation: "customer portal session creation",
          }),
      }).pipe(
        Effect.flatMap((session) =>
          stripeResponse("customer portal session creation", () =>
            Object.freeze({
              id: responseString(session.id, "customer portal session ID"),
              url: responseUrl(session.url, "customer portal URL"),
            }),
          ),
        ),
      ),

    parseWebhook: (request: ParseBillingWebhookRequest) =>
      Effect.tryPromise({
        try: () =>
          client.webhooks.constructEventAsync(
            request.payload,
            request.signature,
            webhookSecret,
          ),
        catch: () =>
          new InvalidBillingWebhookError({
            provider: stripeProviderName,
            reason: "signature verification failed",
          }),
      }).pipe(
        Effect.flatMap((event) => normalizeStripeWebhook(event, offers, offersByPriceId)),
      ),
  }) satisfies BillingProvider
}

function createStripeClient(configuration: StripeBillingProviderConfiguration): Stripe {
  const secretKey = configurationString(configuration.secretKey, "Stripe secret key")
  const maxNetworkRetries = configurationInteger(
    configuration.maxNetworkRetries,
    "Stripe maxNetworkRetries",
    0,
    10,
    2,
  )
  const timeout = configurationInteger(
    configuration.timeoutMs,
    "Stripe timeoutMs",
    1_000,
    120_000,
    30_000,
  )

  return new Stripe(secretKey, {
    apiVersion: stripeBillingApiVersion,
    maxNetworkRetries,
    timeout,
  })
}

function resolveOffers(
  input: Readonly<Record<string, StripeBillingOffer>>,
): ReadonlyMap<string, ResolvedStripeOffer> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new BillingConfigurationError({ reason: "Stripe offers must be a record" })
  }

  const offers = new Map<string, ResolvedStripeOffer>()
  for (const [rawOfferId, value] of Object.entries(input)) {
    const safeOfferId = offerId(rawOfferId, "configuration")
    if (!value || typeof value !== "object") {
      throw new BillingConfigurationError({
        reason: `Stripe offer ${safeOfferId} is invalid`,
      })
    }
    const priceId = configurationString(value.priceId, `Stripe price for ${safeOfferId}`, 255)
    if (!/^price_[A-Za-z0-9_]+$/.test(priceId)) {
      throw new BillingConfigurationError({
        reason: `Stripe price for ${safeOfferId} has an invalid ID`,
      })
    }
    if (value.mode !== "subscription" && value.mode !== "payment") {
      throw new BillingConfigurationError({
        reason: `Stripe offer ${safeOfferId} has an invalid mode`,
      })
    }
    if ([...offers.values()].some((offer) => offer.priceId === priceId)) {
      throw new BillingConfigurationError({
        reason: `Stripe price ${priceId} is assigned to multiple offers`,
      })
    }
    offers.set(
      safeOfferId,
      Object.freeze({ offerId: safeOfferId, priceId, mode: value.mode }),
    )
  }

  if (offers.size === 0) {
    throw new BillingConfigurationError({ reason: "at least one Stripe offer is required" })
  }
  return offers
}

function configurationInteger(
  value: number | undefined,
  label: string,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new BillingConfigurationError({
      reason: `${label} must be an integer from ${minimum} to ${maximum}`,
    })
  }
  return value
}

function normalizeStripeWebhook(
  input: Stripe.Event,
  offers: ReadonlyMap<string, ResolvedStripeOffer>,
  offersByPriceId: ReadonlyMap<string, ResolvedStripeOffer>,
): Effect.Effect<BillingEvent, InvalidBillingWebhookError> {
  return Effect.suspend(() => {
    if (!isRecord(input) || input.api_version !== stripeBillingApiVersion) {
      return Effect.fail(
        new InvalidBillingWebhookError({
          provider: stripeProviderName,
          reason: "API version is unsupported",
        }),
      )
    }

    try {
      return Effect.succeed(normalizeStripeEvent(input, offers, offersByPriceId))
    } catch (error) {
      return error instanceof MalformedStripeEventError
        ? Effect.fail(
            new InvalidBillingWebhookError({
              provider: stripeProviderName,
              reason: "event payload has an unsupported shape",
            }),
          )
        : Effect.die(error)
    }
  })
}

function normalizeStripeEvent(
  input: unknown,
  offers: ReadonlyMap<string, ResolvedStripeOffer>,
  offersByPriceId: ReadonlyMap<string, ResolvedStripeOffer>,
): BillingEvent {
  const event = requiredRecord(input, "event")
  const type = requiredEventString(event.type, "event type")
  const data = requiredRecord(event.data, "event data")
  const object = requiredRecord(data.object, "event object")
  const base = Object.freeze({
    id: requiredEventString(event.id, "event ID"),
    provider: stripeProviderName,
    providerEventType: type,
    occurredAt: eventTimestamp(event.created),
  })

  switch (type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      return checkoutEvent(base, object, "checkout.completed", offers)

    case "checkout.session.async_payment_failed":
      return checkoutEvent(base, object, "checkout.payment_failed", offers)

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
    case "customer.subscription.paused":
    case "customer.subscription.resumed":
      return subscriptionEvent(base, object, offersByPriceId)

    case "invoice.paid":
      return invoiceEvent(base, object, "invoice.paid", offersByPriceId)

    case "invoice.payment_failed":
      return invoiceEvent(base, object, "invoice.payment_failed", offersByPriceId)

    default:
      return Object.freeze({ ...base, kind: "unsupported" })
  }
}

function checkoutEvent(
  base: EventBase,
  session: UnknownRecord,
  kind: "checkout.completed" | "checkout.payment_failed",
  offers: ReadonlyMap<string, ResolvedStripeOffer>,
): BillingEvent {
  const metadata = checkoutMetadata(session.metadata)
  if (
    !metadata ||
    session.client_reference_id !== metadata.subjectId ||
    !offers.has(metadata.offerId)
  ) {
    return Object.freeze({ ...base, kind: "unsupported" })
  }

  return Object.freeze({
    ...base,
    kind,
    checkoutId: requiredProviderIdentifier(session.id, "checkout ID"),
    subjectId: metadata.subjectId,
    offerId: metadata.offerId,
    quantity: metadata.quantity,
    customerId: eventExternalId(session.customer, "checkout customer ID"),
    subscriptionId: eventExternalId(session.subscription, "checkout subscription ID"),
    paymentStatus: paymentStatus(session.payment_status),
  })
}

function subscriptionEvent(
  base: EventBase,
  subscription: UnknownRecord,
  offersByPriceId: ReadonlyMap<string, ResolvedStripeOffer>,
): BillingEvent {
  const metadata = billingSubjectMetadata(subscription.metadata)
  const customerId = eventExternalId(subscription.customer, "subscription customer ID")
  const item = subscriptionBillingItem(subscription, offersByPriceId)
  if (!metadata || !customerId || !item) {
    return Object.freeze({ ...base, kind: "unsupported" })
  }

  return Object.freeze({
    ...base,
    kind: "subscription.changed",
    subjectId: metadata.subjectId,
    offerId: item.offerId,
    quantity: item.quantity,
    customerId,
    subscriptionId: requiredProviderIdentifier(subscription.id, "subscription ID"),
    status: subscriptionStatus(subscription.status),
    cancelAtPeriodEnd: requiredEventBoolean(
      subscription.cancel_at_period_end,
      "cancel-at-period-end marker",
    ),
  })
}

function invoiceEvent(
  base: EventBase,
  invoice: UnknownRecord,
  kind: "invoice.paid" | "invoice.payment_failed",
  offersByPriceId: ReadonlyMap<string, ResolvedStripeOffer>,
): BillingEvent {
  const details = invoiceSubscriptionDetails(invoice.parent)
  const metadata = billingSubjectMetadata(details?.metadata)
  const customerId = eventExternalId(invoice.customer, "invoice customer ID")
  if (!metadata || !customerId) {
    return Object.freeze({ ...base, kind: "unsupported" })
  }

  const item = invoiceBillingItem(invoice, offersByPriceId)
  return Object.freeze({
    ...base,
    kind,
    subjectId: metadata.subjectId,
    offerId: item?.offerId ?? null,
    quantity: item?.quantity ?? null,
    customerId,
    subscriptionId: eventExternalId(details?.subscription, "invoice subscription ID"),
    invoiceId: requiredProviderIdentifier(invoice.id, "invoice ID"),
    amountDue: requiredEventAmount(invoice.amount_due, "amount due"),
    amountPaid: requiredEventAmount(invoice.amount_paid, "amount paid"),
    currency: requiredCurrency(invoice.currency),
  })
}

interface EventBase {
  readonly id: string
  readonly provider: string
  readonly providerEventType: string
  readonly occurredAt: string
}

interface BillingItem {
  readonly offerId: string
  readonly quantity: number
}

type UnknownRecord = Record<string, unknown>

class MalformedStripeEventError extends Error {}

class MalformedStripeResponseError extends Error {}

function stripeResponse<Value>(
  operation: string,
  read: () => Value,
): Effect.Effect<Value, BillingProviderUnavailableError> {
  return Effect.suspend(() => {
    try {
      return Effect.succeed(read())
    } catch (error) {
      return error instanceof MalformedStripeResponseError
        ? Effect.fail(
            new BillingProviderUnavailableError({ provider: stripeProviderName, operation }),
          )
        : Effect.die(error)
    }
  })
}

function responseString(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 512 ||
    controlCharacters.test(value)
  ) {
    throw new MalformedStripeResponseError(`invalid ${label}`)
  }
  return value
}

function responseExternalId(value: unknown, label: string): string | null {
  if (value === null || value === undefined) return null
  const id = typeof value === "string" ? value : isRecord(value) ? value.id : undefined
  if (typeof id !== "string" || !providerIdentifier.test(id)) {
    throw new MalformedStripeResponseError(`invalid ${label}`)
  }
  return id
}

function responseUrl(value: unknown, label: string): string {
  const raw = responseString(value, label)
  try {
    const url = new URL(raw)
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new MalformedStripeResponseError(`invalid ${label}`)
    }
    return url.toString()
  } catch (error) {
    if (error instanceof MalformedStripeResponseError) throw error
    throw new MalformedStripeResponseError(`invalid ${label}`)
  }
}

function responseTimestamp(value: unknown, label: string): string {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new MalformedStripeResponseError(`invalid ${label}`)
  }
  const date = new Date(value * 1_000)
  if (!Number.isFinite(date.getTime())) throw new MalformedStripeResponseError(`invalid ${label}`)
  return date.toISOString()
}

function billingSubjectMetadata(metadata: unknown): { readonly subjectId: string } | null {
  if (!isRecord(metadata) || metadata[metadataVersionKey] !== metadataVersion) return null
  const subjectId = metadata[metadataSubjectKey]
  if (typeof subjectId !== "string" || !subjectIdentifier.test(subjectId)) return null
  return Object.freeze({ subjectId })
}

function checkoutMetadata(
  metadata: unknown,
): { readonly subjectId: string; readonly offerId: string; readonly quantity: number } | null {
  const subject = billingSubjectMetadata(metadata)
  if (!subject || !isRecord(metadata)) return null
  const stableOfferId = metadata[metadataOfferKey]
  const rawQuantity = metadata[metadataQuantityKey]
  if (
    typeof stableOfferId !== "string" ||
    !eventOfferIdentifier.test(stableOfferId) ||
    typeof rawQuantity !== "string" ||
    !/^[1-9][0-9]{0,5}$/.test(rawQuantity)
  ) {
    return null
  }
  const quantity = Number(rawQuantity)
  return Number.isSafeInteger(quantity) && quantity <= 999
    ? Object.freeze({ ...subject, offerId: stableOfferId, quantity })
    : null
}

function subscriptionBillingItem(
  subscription: UnknownRecord,
  offersByPriceId: ReadonlyMap<string, ResolvedStripeOffer>,
): BillingItem | null {
  const items = requiredRecord(subscription.items, "subscription items")
  if (!Array.isArray(items.data)) throw new MalformedStripeEventError("invalid subscription items")
  if (items.has_more === true) return null
  if (items.has_more !== false) {
    throw new MalformedStripeEventError("invalid subscription item pagination")
  }
  if (items.data.length !== 1) return null
  const item = requiredRecord(items.data[0], "subscription item")
  const priceId = eventExternalId(item.price, "subscription price ID")
  if (!priceId) throw new MalformedStripeEventError("invalid subscription price")
  const offer = offersByPriceId.get(priceId)
  if (!offer || offer.mode !== "subscription") return null
  return Object.freeze({ offerId: offer.offerId, quantity: eventQuantity(item.quantity, true) })
}

function invoiceBillingItem(
  invoice: UnknownRecord,
  offersByPriceId: ReadonlyMap<string, ResolvedStripeOffer>,
): BillingItem | null {
  const lines = requiredRecord(invoice.lines, "invoice lines")
  if (!Array.isArray(lines.data)) throw new MalformedStripeEventError("invalid invoice lines")
  if (lines.has_more === true) return null
  if (lines.has_more !== false) {
    throw new MalformedStripeEventError("invalid invoice line pagination")
  }

  const items: BillingItem[] = []
  for (const rawLine of lines.data) {
    const line = requiredRecord(rawLine, "invoice line")
    if (!isRecord(line.parent) || line.parent.type !== "subscription_item_details") continue
    const details = requiredRecord(
      line.parent.subscription_item_details,
      "invoice subscription item details",
    )
    if (details.proration === true) continue
    if (details.proration !== false) {
      throw new MalformedStripeEventError("invalid invoice proration marker")
    }
    const pricing = requiredRecord(line.pricing, "invoice line pricing")
    const priceDetails = requiredRecord(pricing.price_details, "invoice line price details")
    const priceId = eventExternalId(priceDetails.price, "invoice price ID")
    if (!priceId) throw new MalformedStripeEventError("invalid invoice price")
    const offer = offersByPriceId.get(priceId)
    if (!offer || offer.mode !== "subscription") return null
    items.push(Object.freeze({ offerId: offer.offerId, quantity: eventQuantity(line.quantity) }))
  }

  return items.length === 1 ? items[0]! : null
}

function invoiceSubscriptionDetails(value: unknown): UnknownRecord | null {
  if (!isRecord(value) || value.type !== "subscription_details") return null
  return requiredRecord(value.subscription_details, "invoice subscription details")
}

function eventQuantity(value: unknown, defaultsToOne = false): number {
  if (value === undefined && defaultsToOne) return 1
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > 999) {
    throw new MalformedStripeEventError("invalid quantity")
  }
  return value
}

function eventExternalId(value: unknown, label: string): string | null {
  if (value === null || value === undefined) return null
  const id = typeof value === "string" ? value : isRecord(value) ? value.id : undefined
  if (typeof id !== "string" || !providerIdentifier.test(id)) {
    throw new MalformedStripeEventError(`invalid ${label}`)
  }
  return id
}

function paymentStatus(value: unknown): BillingPaymentStatus {
  if (value === "paid" || value === "unpaid" || value === "no_payment_required") return value
  return "unknown"
}

function subscriptionStatus(value: unknown): BillingSubscriptionStatus {
  switch (value) {
    case "incomplete":
    case "trialing":
    case "active":
    case "past_due":
    case "canceled":
    case "unpaid":
    case "paused":
      return value
    case "incomplete_expired":
      return "expired"
    default:
      return "unknown"
  }
}

function requiredEventString(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 512 ||
    controlCharacters.test(value)
  ) {
    throw new MalformedStripeEventError(`invalid ${label}`)
  }
  return value
}

function requiredProviderIdentifier(value: unknown, label: string): string {
  if (typeof value !== "string" || !providerIdentifier.test(value)) {
    throw new MalformedStripeEventError(`invalid ${label}`)
  }
  return value
}

function requiredEventAmount(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new MalformedStripeEventError(`invalid ${label}`)
  }
  return value
}

function requiredEventBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new MalformedStripeEventError(`invalid ${label}`)
  return value
}

function requiredCurrency(value: unknown): string {
  if (typeof value !== "string" || !/^[a-zA-Z]{3}$/.test(value)) {
    throw new MalformedStripeEventError("invalid currency")
  }
  return value.toLowerCase()
}

function eventTimestamp(value: unknown): string {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new MalformedStripeEventError("invalid event timestamp")
  }
  const date = new Date(value * 1_000)
  if (!Number.isFinite(date.getTime())) {
    throw new MalformedStripeEventError("invalid event timestamp")
  }
  return date.toISOString()
}

function requiredRecord(value: unknown, label: string): UnknownRecord {
  if (!isRecord(value)) throw new MalformedStripeEventError(`invalid ${label}`)
  return value
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
