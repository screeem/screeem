import { Cause, Effect, Either, Exit, Option } from "effect"
import { describe, expect, expectTypeOf, it, vi } from "vitest"

import {
  BillingCustomerNotFoundError,
  BillingConfigurationError,
  InvalidBillingRequestError,
  UnsupportedBillingOfferError,
  createBilling,
  type Billing,
  type BillingCheckoutSession,
  type BillingConfiguration,
  type BillingEvent,
  type BillingFailure,
  type BillingCustomerResolver,
  type BillingProvider,
  type CreateCheckoutRequest,
  type CreateCustomerPortalRequest,
  type ParseBillingWebhookRequest,
  type ProviderCreateCheckoutRequest,
  type ProviderCreateCustomerPortalRequest,
} from "../src/index.js"

function provider(overrides: Partial<BillingProvider> = {}) {
  const createCheckoutSession = vi.fn((_request: ProviderCreateCheckoutRequest) =>
    Effect.succeed({
      id: "checkout_1",
      url: "https://billing.example.test/checkout/1",
      customerId: null,
      expiresAt: "2026-08-25T10:00:00.000Z",
    }),
  )
  const createCustomerPortalSession = vi.fn((_request: ProviderCreateCustomerPortalRequest) =>
    Effect.succeed({
      id: "portal_1",
      url: "https://billing.example.test/portal/1",
    }),
  )
  const parseWebhook = vi.fn((_request: ParseBillingWebhookRequest) =>
    Effect.succeed({
      id: "event_1",
      provider: "example",
      providerEventType: "example.event",
      occurredAt: "2026-08-24T10:00:00.000Z",
      kind: "unsupported",
    } satisfies BillingEvent),
  )

  return {
    adapter: {
      name: "example",
      offerIds: ["test_secondary_offer", "test_subscription_offer"],
      createCheckoutSession,
      createCustomerPortalSession,
      parseWebhook,
      ...overrides,
    } satisfies BillingProvider,
    createCheckoutSession,
    createCustomerPortalSession,
    parseWebhook,
  }
}

function customerResolver(customerId: string | null = null) {
  const findCustomerId = vi.fn(() => Effect.succeed(customerId))
  return {
    resolver: { findCustomerId } satisfies BillingCustomerResolver,
    findCustomerId,
  }
}

function configuration(customerId: string | null = null) {
  return { customerResolver: customerResolver(customerId).resolver }
}

function makeBilling(
  billingProvider: BillingProvider,
  billingConfiguration: BillingConfiguration,
): Billing {
  return Effect.runSync(createBilling(billingProvider, billingConfiguration))
}

function checkoutRequest(): CreateCheckoutRequest {
  return {
    subject: { id: "team_123", email: "owner@example.test" },
    offerId: "test_subscription_offer",
    successUrl: "https://app.example.test/billing/success",
    cancelUrl: "https://app.example.test/billing",
    idempotencyKey: "checkout_team_123_test_subscription_1",
  }
}

function run<Value, Failure>(effect: Effect.Effect<Value, Failure>): Promise<Value> {
  return Effect.runPromise(effect)
}

async function runFailure<Value, Failure>(
  effect: Effect.Effect<Value, Failure>,
): Promise<Failure> {
  const result = await Effect.runPromise(Effect.either(effect))
  if (Either.isRight(result)) throw new Error("Expected Effect to fail")
  return result.left
}

describe("billing service", () => {
  it("returns configuration failures through the Effect error channel", async () => {
    const failure = await runFailure(createBilling(provider().adapter, {} as never))

    expect(failure).toBeInstanceOf(BillingConfigurationError)
    expect(failure._tag).toBe("BillingConfigurationError")
    expect(failure.reason).toBe("customerResolver.findCustomerId is required")
  })

  it("exposes Effect-native operations with typed billing failures", () => {
    const construction = createBilling(provider().adapter, configuration())
    const effect = Effect.runSync(construction).createCheckoutSession(checkoutRequest())

    expect(Effect.isEffect(construction)).toBe(true)
    expect(Effect.isEffect(effect)).toBe(true)
    expectTypeOf(construction).toEqualTypeOf<
      Effect.Effect<Billing, BillingConfigurationError, never>
    >()
    expectTypeOf(effect).toEqualTypeOf<
      Effect.Effect<BillingCheckoutSession, BillingFailure, never>
    >()
  })

  it("exposes structured tagged failures to Effect.catchTag", async () => {
    const billing = makeBilling(provider().adapter, configuration())
    const recovered = billing
      .createCheckoutSession({ ...checkoutRequest(), quantity: 0 })
      .pipe(
        Effect.catchTag("InvalidBillingRequestError", (error) =>
          Effect.succeed({
            tag: error._tag,
            code: error.code,
            reason: error.reason,
            message: error.message,
            isError: error instanceof Error,
          }),
        ),
      )

    await expect(run(recovered)).resolves.toEqual({
      tag: "InvalidBillingRequestError",
      code: "invalid_billing_request",
      reason: "quantity must be an integer from 1 to 999",
      message: "Billing request is invalid: quantity must be an integer from 1 to 999",
      isError: true,
    })
  })

  it("snapshots and validates a checkout before calling its provider", async () => {
    const fixture = provider()
    const billing = makeBilling(fixture.adapter, configuration())
    const input = checkoutRequest()

    const session = await run(billing.createCheckoutSession(input))
    const mutableInput = input as { subject: { id: string } }
    mutableInput.subject = { id: "changed" }

    expect(session).toEqual({
      provider: "example",
      id: "checkout_1",
      url: "https://billing.example.test/checkout/1",
      customerId: null,
      expiresAt: "2026-08-25T10:00:00.000Z",
    })
    expect(fixture.createCheckoutSession).toHaveBeenCalledWith({
      ...checkoutRequest(),
      subject: { ...checkoutRequest().subject, customerId: null },
      quantity: 1,
      allowPromotionCodes: false,
    })
    expect(Object.isFrozen(fixture.createCheckoutSession.mock.calls[0]![0])).toBe(true)
    expect(Object.isFrozen(fixture.createCheckoutSession.mock.calls[0]![0].subject)).toBe(true)
    expect(billing.describe()).toEqual({
      provider: "example",
      offers: ["test_secondary_offer", "test_subscription_offer"],
      maximumWebhookBytes: 1_048_576,
    })
  })

  it("rejects an unknown offer before the provider is contacted", async () => {
    const fixture = provider()
    const billing = makeBilling(fixture.adapter, configuration())

    const failure = await runFailure(
      billing.createCheckoutSession({ ...checkoutRequest(), offerId: "enterprise" }),
    )
    expect(failure).toBeInstanceOf(UnsupportedBillingOfferError)
    expect(fixture.createCheckoutSession).not.toHaveBeenCalled()
  })

  it.each([
    [{ subject: { id: "../team" } }, "subject ID"],
    [{ subject: { id: "team_123", email: "not-an-email" } }, "email"],
    [{ quantity: 0 }, "quantity"],
    [{ successUrl: "javascript:alert(1)" }, "success URL"],
    [{ idempotencyKey: "key with spaces" }, "idempotency key"],
  ] as const)("rejects invalid checkout data %#", async (change, message) => {
    const fixture = provider()
    const billing = makeBilling(fixture.adapter, configuration())

    const failure = await runFailure(
      billing.createCheckoutSession({ ...checkoutRequest(), ...change }),
    )
    expect(failure).toEqual(expect.objectContaining<Partial<InvalidBillingRequestError>>({
      message: expect.stringContaining(message),
    }))
    expect(fixture.createCheckoutSession).not.toHaveBeenCalled()
  })

  it("resolves provider-scoped customer ownership before creating a portal", async () => {
    const fixture = provider()
    const customers = customerResolver("customer_123")
    const billing = makeBilling(fixture.adapter, { customerResolver: customers.resolver })

    await expect(
      run(
        billing.createCustomerPortalSession({
          subjectId: "team_123",
          returnUrl: "https://app.example.test/billing",
          idempotencyKey: "portal_team_123_1",
        }),
      ),
    ).resolves.toEqual({
      provider: "example",
      id: "portal_1",
      url: "https://billing.example.test/portal/1",
    })
    expect(fixture.createCustomerPortalSession).toHaveBeenCalledWith({
      subjectId: "team_123",
      customerId: "customer_123",
      returnUrl: "https://app.example.test/billing",
      idempotencyKey: "portal_team_123_1",
    })
    expect(customers.findCustomerId).toHaveBeenCalledWith({
      provider: "example",
      subjectId: "team_123",
    })
  })

  it("ignores a forged raw customer ID and uses the resolver result", async () => {
    const fixture = provider()
    const billing = makeBilling(fixture.adapter, configuration("customer_resolved"))
    const request = {
      subjectId: "team_123",
      customerId: "customer_forged",
      returnUrl: "https://app.example.test/billing",
      idempotencyKey: "portal_team_123_1",
    } as CreateCustomerPortalRequest & { readonly customerId: string }

    await run(billing.createCustomerPortalSession(request))

    expect(fixture.createCustomerPortalSession).toHaveBeenCalledWith({
      subjectId: "team_123",
      customerId: "customer_resolved",
      returnUrl: "https://app.example.test/billing",
      idempotencyKey: "portal_team_123_1",
    })
  })

  it("ignores a forged checkout customer ID and uses the resolver result", async () => {
    const fixture = provider()
    const billing = makeBilling(fixture.adapter, configuration("customer_resolved"))
    const request = {
      ...checkoutRequest(),
      subject: {
        ...checkoutRequest().subject,
        customerId: "customer_forged",
      },
    } as CreateCheckoutRequest & {
      readonly subject: CreateCheckoutRequest["subject"] & { readonly customerId: string }
    }

    await run(billing.createCheckoutSession(request))

    expect(fixture.createCheckoutSession.mock.calls[0]![0].subject.customerId).toBe(
      "customer_resolved",
    )
  })

  it("fails before the provider when no customer belongs to the subject", async () => {
    const fixture = provider()
    const billing = makeBilling(fixture.adapter, configuration())

    const failure = await runFailure(
      billing.createCustomerPortalSession({
        subjectId: "team_123",
        returnUrl: "https://app.example.test/billing",
        idempotencyKey: "portal_team_123_1",
      }),
    )

    expect(failure).toBeInstanceOf(BillingCustomerNotFoundError)
    expect(fixture.createCustomerPortalSession).not.toHaveBeenCalled()
  })

  it("copies webhook bytes before giving them to a provider", async () => {
    const fixture = provider()
    const billing = makeBilling(fixture.adapter, configuration())
    const payload = Uint8Array.from([123, 125])

    await run(billing.parseWebhook({ payload, signature: "signed_event_1" }))
    payload[0] = 0

    const captured = fixture.parseWebhook.mock.calls[0]![0].payload
    expect(captured).toBeInstanceOf(Uint8Array)
    expect([...captured]).toEqual([123, 125])
    expect(captured).not.toBe(payload)
  })

  it("snapshots normalized events and rejects an adapter with the wrong provider identity", async () => {
    const providerEvent = {
      id: "event_2",
      provider: "example",
      providerEventType: "subscription.updated",
      occurredAt: "2026-08-24T10:00:00.000Z",
      kind: "unsupported",
    } satisfies BillingEvent
    const validFixture = provider({ parseWebhook: () => Effect.succeed(providerEvent) })
    const event = await run(
      makeBilling(validFixture.adapter, configuration()).parseWebhook({
        payload: "{}",
        signature: "signed_event_2",
      }),
    )
    const mutableProviderEvent = providerEvent as { providerEventType: string }
    mutableProviderEvent.providerEventType = "changed"

    expect(event.providerEventType).toBe("subscription.updated")
    expect(Object.isFrozen(event)).toBe(true)

    const invalidFixture = provider({
      parseWebhook: () => Effect.succeed({ ...providerEvent, provider: "other" }),
    })
    const exit = await Effect.runPromiseExit(
      makeBilling(invalidFixture.adapter, configuration()).parseWebhook({
        payload: "{}",
        signature: "signed_event_3",
      }),
    )
    expectDefect(exit, Error)
  })

  it("rejects an adapter event that references an unconfigured offer", async () => {
    const fixture = provider({
      parseWebhook: () =>
        Effect.succeed({
          id: "event_unknown_offer",
          provider: "example",
          providerEventType: "checkout.completed",
          occurredAt: "2026-08-24T10:00:00.000Z",
          kind: "checkout.completed",
          checkoutId: "checkout_1",
          subjectId: "team_123",
          offerId: "not_configured",
          quantity: 1,
          customerId: "customer_123",
          subscriptionId: "subscription_123",
          paymentStatus: "paid",
        }),
    })
    const exit = await Effect.runPromiseExit(
      makeBilling(fixture.adapter, configuration()).parseWebhook({
        payload: "{}",
        signature: "signed_event_unknown_offer",
      }),
    )

    expectDefect(exit, Error)
  })

  it("limits webhook bodies before signature verification", async () => {
    const fixture = provider()
    const billing = makeBilling(fixture.adapter, {
      ...configuration(),
      maximumWebhookBytes: 1_024,
    })

    const failure = await runFailure(
      billing.parseWebhook({ payload: "x".repeat(1_025), signature: "signed_event_1" }),
    )
    expect(failure).toBeInstanceOf(InvalidBillingRequestError)
    expect(fixture.parseWebhook).not.toHaveBeenCalled()
  })

  it("treats an unexpected provider failure as a defect", async () => {
    const fixture = provider({
      createCheckoutSession: () =>
        Effect.fail(new Error("upstream response containing a secret") as never),
    })
    const billing = makeBilling(fixture.adapter, configuration())

    const exit = await Effect.runPromiseExit(billing.createCheckoutSession(checkoutRequest()))
    expectDefect(exit, Error)
  })
})

function expectDefect(
  exit: Exit.Exit<unknown, unknown>,
  ErrorType: abstract new (...args: never[]) => Error,
): void {
  expect(Exit.isFailure(exit)).toBe(true)
  if (!Exit.isFailure(exit)) return
  const defect = Cause.dieOption(exit.cause)
  expect(Option.isSome(defect)).toBe(true)
  expect(Option.getOrThrow(defect)).toBeInstanceOf(ErrorType)
  expect(Cause.isFailType(exit.cause)).toBe(false)
}
