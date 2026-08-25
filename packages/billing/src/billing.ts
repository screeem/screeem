import { Effect } from "effect"

import {
  BillingCustomerNotFoundError,
  BillingConfigurationError,
  InvalidBillingRequestError,
  UnsupportedBillingOfferError,
  isBillingFailure,
  type BillingFailure,
} from "./errors.js"
import type { BillingCustomerResolver } from "./customer.js"
import type {
  BillingCheckoutSession,
  BillingCustomerPortalSession,
  BillingDescription,
  BillingEvent,
  BillingSubject,
  CreateCheckoutRequest,
  CreateCustomerPortalRequest,
  ParseBillingWebhookRequest,
} from "./model.js"
import type {
  BillingProvider,
  ProviderCreateCheckoutRequest,
  ProviderCreateCustomerPortalRequest,
} from "./provider.js"
import {
  offerId,
  outputIdentifier,
  outputPositiveInteger,
  outputTimestamp,
  outputUrl,
  positiveInteger,
  providerName,
  requestBoolean,
  requestEmail,
  requestIdentifier,
  requestSignature,
  requestUrl,
} from "./validation.js"

export interface Billing {
  createCheckoutSession(
    request: CreateCheckoutRequest,
  ): Effect.Effect<BillingCheckoutSession, BillingFailure>
  createCustomerPortalSession(
    request: CreateCustomerPortalRequest,
  ): Effect.Effect<BillingCustomerPortalSession, BillingFailure>
  parseWebhook(request: ParseBillingWebhookRequest): Effect.Effect<BillingEvent, BillingFailure>
  describe(): BillingDescription
}

export interface BillingConfiguration {
  readonly customerResolver: BillingCustomerResolver
  readonly maximumWebhookBytes?: number
}

const defaultMaximumWebhookBytes = 1_048_576

export function createBilling(
  provider: BillingProvider,
  configuration: BillingConfiguration,
): Effect.Effect<Billing, BillingConfigurationError> {
  return Effect.suspend(() => {
    try {
      return Effect.succeed(makeBilling(provider, configuration))
    } catch (error) {
      return error instanceof BillingConfigurationError
        ? Effect.fail(error)
        : Effect.die(error)
    }
  })
}

function makeBilling(
  provider: BillingProvider,
  configuration: BillingConfiguration,
): Billing {
  const name = providerName(provider.name)
  const offers = Object.freeze(
    [...new Set(provider.offerIds.map((value) => offerId(value, "configuration")))].sort(),
  )
  const customerResolver = readCustomerResolver(configuration?.customerResolver)
  const maximumWebhookBytes = readMaximumWebhookBytes(configuration.maximumWebhookBytes)
  const description = Object.freeze({
    provider: name,
    offers,
    maximumWebhookBytes,
  }) satisfies BillingDescription

  return Object.freeze({
    createCheckoutSession: (input: CreateCheckoutRequest) =>
      validated(() => {
        const request = snapshotCheckoutRequest(input)
        if (!offers.includes(request.offerId)) {
          throw new UnsupportedBillingOfferError({ offerId: request.offerId, provider: name })
        }
        return request
      }).pipe(
        Effect.flatMap((request) =>
          resolveCustomerId(customerResolver, name, request.subject.id).pipe(
            Effect.map(
              (customerId) =>
                Object.freeze({
                  ...request,
                  subject: Object.freeze({ ...request.subject, customerId }),
                  quantity: request.quantity ?? 1,
                  allowPromotionCodes: request.allowPromotionCodes ?? false,
                }) satisfies ProviderCreateCheckoutRequest,
            ),
          ),
        ),
        Effect.flatMap((request) =>
          providerOperation(() => provider.createCheckoutSession(request)),
        ),
        Effect.flatMap((result) =>
          providerOutput(() =>
            Object.freeze({
              provider: name,
              id: outputIdentifier(result.id, name, "checkout session ID"),
              url: outputUrl(result.url, name, "checkout URL"),
              customerId:
                result.customerId === null
                  ? null
                  : outputIdentifier(result.customerId, name, "customer ID"),
              expiresAt: outputTimestamp(result.expiresAt, name),
            }),
          ),
        ),
      ),

    createCustomerPortalSession: (input: CreateCustomerPortalRequest) =>
      validated(() => snapshotPortalRequest(input)).pipe(
        Effect.flatMap((request) =>
          resolveCustomerId(customerResolver, name, request.subjectId).pipe(
            Effect.flatMap((customerId) =>
              customerId === null
                ? Effect.fail(new BillingCustomerNotFoundError({ provider: name }))
                : Effect.succeed(
                    Object.freeze({ ...request, customerId }) satisfies ProviderCreateCustomerPortalRequest,
                  ),
            ),
          ),
        ),
        Effect.flatMap((request) =>
          providerOperation(() => provider.createCustomerPortalSession(request)),
        ),
        Effect.flatMap((result) =>
          providerOutput(() =>
            Object.freeze({
              provider: name,
              id: outputIdentifier(result.id, name, "customer portal session ID"),
              url: outputUrl(result.url, name, "customer portal URL"),
            }),
          ),
        ),
      ),

    parseWebhook: (input: ParseBillingWebhookRequest) =>
      validated(() => snapshotWebhookRequest(input, maximumWebhookBytes)).pipe(
        Effect.flatMap((request) =>
          providerOperation(() => provider.parseWebhook(request)),
        ),
        Effect.flatMap((event) =>
          providerOutput(() => snapshotBillingEvent(event, name, offers)),
        ),
      ),

    describe: () => description,
  }) satisfies Billing
}

function snapshotCheckoutRequest(input: CreateCheckoutRequest): CreateCheckoutRequest {
  if (!input || typeof input !== "object") {
    throw new InvalidBillingRequestError({ reason: "checkout request is required" })
  }
  if (!input.subject || typeof input.subject !== "object") {
    throw new InvalidBillingRequestError({ reason: "billing subject is required" })
  }

  const subject: BillingSubject = Object.freeze({
    id: requestIdentifier(input.subject.id, "subject ID", 200),
    ...(input.subject.email === undefined ? {} : { email: requestEmail(input.subject.email) }),
  })

  return Object.freeze({
    subject,
    offerId: offerId(input.offerId, "request"),
    quantity: input.quantity === undefined ? 1 : positiveInteger(input.quantity, "quantity", 999),
    successUrl: requestUrl(input.successUrl, "success URL"),
    cancelUrl: requestUrl(input.cancelUrl, "cancel URL"),
    idempotencyKey: requestIdentifier(input.idempotencyKey, "idempotency key", 255),
    allowPromotionCodes:
      input.allowPromotionCodes === undefined
        ? false
        : requestBoolean(input.allowPromotionCodes, "allowPromotionCodes"),
  })
}

function snapshotPortalRequest(input: CreateCustomerPortalRequest): CreateCustomerPortalRequest {
  if (!input || typeof input !== "object") {
    throw new InvalidBillingRequestError({ reason: "customer portal request is required" })
  }
  return Object.freeze({
    subjectId: requestIdentifier(input.subjectId, "subject ID", 200),
    returnUrl: requestUrl(input.returnUrl, "return URL"),
    idempotencyKey: requestIdentifier(input.idempotencyKey, "idempotency key", 255),
  })
}

function snapshotWebhookRequest(
  input: ParseBillingWebhookRequest,
  maximumWebhookBytes: number,
): ParseBillingWebhookRequest {
  if (!input || typeof input !== "object") {
    throw new InvalidBillingRequestError({ reason: "webhook request is required" })
  }
  if (typeof input.payload !== "string" && !(input.payload instanceof Uint8Array)) {
    throw new InvalidBillingRequestError({ reason: "webhook payload must be raw text or bytes" })
  }

  const payload =
    typeof input.payload === "string"
      ? input.payload
      : Uint8Array.from(input.payload)
  const byteLength =
    typeof payload === "string" ? new TextEncoder().encode(payload).byteLength : payload.byteLength
  if (byteLength === 0 || byteLength > maximumWebhookBytes) {
    throw new InvalidBillingRequestError({
      reason: `webhook payload must contain from 1 to ${maximumWebhookBytes} bytes`,
    })
  }

  return Object.freeze({
    payload,
    signature: requestSignature(input.signature),
  })
}

function readMaximumWebhookBytes(value: number | undefined): number {
  if (value === undefined) return defaultMaximumWebhookBytes
  if (!Number.isSafeInteger(value) || value < 1_024 || value > 16_777_216) {
    throw new BillingConfigurationError({
      reason: "maximumWebhookBytes must be an integer from 1024 to 16777216",
    })
  }
  return value
}

function readCustomerResolver(value: BillingCustomerResolver | undefined): BillingCustomerResolver {
  if (!value || typeof value !== "object" || typeof value.findCustomerId !== "function") {
    throw new BillingConfigurationError({
      reason: "customerResolver.findCustomerId is required",
    })
  }
  return value
}

function validated<Value>(check: () => Value): Effect.Effect<Value, BillingFailure> {
  return Effect.suspend(() => {
    try {
      return Effect.succeed(check())
    } catch (error) {
      return isBillingFailure(error) ? Effect.fail(error) : Effect.die(error)
    }
  })
}

function providerOperation<Value>(
  run: () => Effect.Effect<Value, BillingFailure>,
): Effect.Effect<Value, BillingFailure> {
  return Effect.suspend(run).pipe(
    Effect.catchAll((error) =>
      isBillingFailure(error) ? Effect.fail(error) : Effect.die(error),
    ),
  )
}

function resolveCustomerId(
  resolver: BillingCustomerResolver,
  provider: string,
  subjectId: string,
): Effect.Effect<string | null, BillingFailure> {
  const request = Object.freeze({ provider, subjectId })
  return providerOperation(() => resolver.findCustomerId(request)).pipe(
    Effect.flatMap((customerId) =>
      Effect.sync(() =>
        customerId === null ? null : outputIdentifier(customerId, provider, "customer ID"),
      ),
    ),
  )
}

function providerOutput<Value>(read: () => Value): Effect.Effect<Value> {
  return Effect.sync(read)
}

function snapshotBillingEvent(
  input: BillingEvent,
  provider: string,
  configuredOffers: readonly string[],
): BillingEvent {
  if (!input || typeof input !== "object" || input.provider !== provider) {
    throw new Error("provider returned an invalid billing event")
  }

  const occurredAt = outputTimestamp(input.occurredAt, provider)
  if (occurredAt === null) throw new Error("provider returned an invalid event timestamp")
  const base = {
    id: outputIdentifier(input.id, provider, "event ID"),
    provider,
    providerEventType: outputIdentifier(input.providerEventType, provider, "event type"),
    occurredAt,
  }

  switch (input.kind) {
    case "unsupported":
      return Object.freeze({ ...base, kind: input.kind })

    case "checkout.completed":
    case "checkout.payment_failed":
      return Object.freeze({
        ...base,
        kind: input.kind,
        checkoutId: requestIdentifier(input.checkoutId, "checkout ID", 512),
        subjectId: requestIdentifier(input.subjectId, "subject ID", 200),
        offerId: configuredEventOffer(input.offerId, configuredOffers, provider),
        quantity: outputPositiveInteger(input.quantity, provider, "quantity"),
        customerId: nullableProviderIdentifier(input.customerId, "customer ID"),
        subscriptionId: nullableProviderIdentifier(input.subscriptionId, "subscription ID"),
        paymentStatus: readPaymentStatus(input.paymentStatus),
      })

    case "subscription.changed":
      return Object.freeze({
        ...base,
        kind: input.kind,
        subjectId: requestIdentifier(input.subjectId, "subject ID", 200),
        offerId: configuredEventOffer(input.offerId, configuredOffers, provider),
        quantity: outputPositiveInteger(input.quantity, provider, "quantity"),
        customerId: requestIdentifier(input.customerId, "customer ID", 512),
        subscriptionId: requestIdentifier(input.subscriptionId, "subscription ID", 512),
        status: readSubscriptionStatus(input.status),
        cancelAtPeriodEnd: requestBoolean(input.cancelAtPeriodEnd, "cancelAtPeriodEnd"),
      })

    case "invoice.paid":
    case "invoice.payment_failed":
      return Object.freeze({
        ...base,
        kind: input.kind,
        subjectId:
          input.subjectId === null
            ? null
            : requestIdentifier(input.subjectId, "subject ID", 200),
        offerId:
          input.offerId === null
            ? null
            : configuredEventOffer(input.offerId, configuredOffers, provider),
        quantity:
          input.quantity === null
            ? null
            : outputPositiveInteger(input.quantity, provider, "quantity"),
        customerId: requestIdentifier(input.customerId, "customer ID", 512),
        subscriptionId: nullableProviderIdentifier(input.subscriptionId, "subscription ID"),
        invoiceId: requestIdentifier(input.invoiceId, "invoice ID", 512),
        amountDue: nonNegativeAmount(input.amountDue, "amountDue"),
        amountPaid: nonNegativeAmount(input.amountPaid, "amountPaid"),
        currency: readCurrency(input.currency),
      })

    default:
      throw new Error("provider returned an unknown billing event kind")
  }
}

function configuredEventOffer(
  value: unknown,
  configuredOffers: readonly string[],
  provider: string,
): string {
  if (typeof value !== "string" || !configuredOffers.includes(value)) {
    throw new Error(`${provider} returned an unconfigured billing offer`)
  }
  return value
}

function nullableProviderIdentifier(value: string | null, label: string): string | null {
  return value === null ? null : requestIdentifier(value, label, 512)
}

function nonNegativeAmount(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`provider returned an invalid ${label}`)
  }
  return value
}

function readCurrency(value: unknown): string {
  if (typeof value !== "string" || !/^[a-zA-Z]{3}$/.test(value)) {
    throw new Error("provider returned an invalid currency")
  }
  return value.toLowerCase()
}

function readPaymentStatus(value: unknown) {
  if (
    value !== "paid" &&
    value !== "unpaid" &&
    value !== "no_payment_required" &&
    value !== "unknown"
  ) {
    throw new Error("provider returned an invalid payment status")
  }
  return value
}

function readSubscriptionStatus(value: unknown) {
  if (
    value !== "incomplete" &&
    value !== "expired" &&
    value !== "trialing" &&
    value !== "active" &&
    value !== "past_due" &&
    value !== "canceled" &&
    value !== "unpaid" &&
    value !== "paused" &&
    value !== "unknown"
  ) {
    throw new Error("provider returned an invalid subscription status")
  }
  return value
}
