import { Effect, Either } from "effect"
import Stripe from "stripe"
import { describe, expect, it, vi } from "vitest"

import {
  BillingConfigurationError,
  BillingProviderUnavailableError,
  InvalidBillingWebhookError,
  createBilling,
  type Billing,
  type BillingProvider,
  type CreateCheckoutRequest,
} from "../src/index.js"
import {
  createStripeBillingProvider,
  stripeBillingApiVersion,
  type StripeBillingProviderConfiguration,
} from "../src/stripe.js"

const webhookSecret = "whsec_billing_contract_test"
const metadata = {
  billing_contract_version: "1",
  billing_subject_id: "team_123",
  billing_offer_id: "test_subscription_offer",
  billing_quantity: "1",
}

function fakeStripe() {
  const checkout = vi.fn(
    async (_params: Stripe.Checkout.SessionCreateParams, _options?: Stripe.RequestOptions) => ({
      id: "cs_test_123",
      url: "https://checkout.stripe.test/c/pay/cs_test_123",
      customer: null,
      expires_at: 1_787_680_800,
    }),
  )
  const portal = vi.fn(
    async (_params: Stripe.BillingPortal.SessionCreateParams, _options?: Stripe.RequestOptions) => ({
      id: "bps_test_123",
      url: "https://billing.stripe.test/p/session/test_123",
    }),
  )
  const constructEventAsync = vi.fn()
  const client = {
    checkout: { sessions: { create: checkout } },
    billingPortal: { sessions: { create: portal } },
    webhooks: { constructEventAsync },
  } as unknown as Stripe

  return { client, checkout, portal, constructEventAsync }
}

function configuration(
  client?: Stripe,
  overrides: Partial<StripeBillingProviderConfiguration> = {},
): StripeBillingProviderConfiguration {
  return {
    webhookSecret,
    offers: {
      test_subscription_offer: {
        priceId: "price_test_subscription",
        mode: "subscription",
      },
      test_payment_offer: { priceId: "price_test_payment", mode: "payment" },
      test_pro_offer: { priceId: "price_test_pro", mode: "subscription" },
    },
    ...(client ? { client } : { secretKey: "sk_test_billing_contract" }),
    ...overrides,
  }
}

function testBilling(
  provider: BillingProvider,
  customerId: string | null = null,
): Billing {
  return Effect.runSync(createBilling(provider, {
    customerResolver: {
      findCustomerId: () => Effect.succeed(customerId),
    },
  }))
}

function stripeProvider(
  providerConfiguration: StripeBillingProviderConfiguration,
): BillingProvider {
  return Effect.runSync(createStripeBillingProvider(providerConfiguration))
}

function checkoutRequest(
  change: Partial<CreateCheckoutRequest> = {},
): CreateCheckoutRequest {
  return {
    subject: { id: "team_123", email: "owner@example.test" },
    offerId: "test_subscription_offer",
    successUrl: "https://app.example.test/billing/success",
    cancelUrl: "https://app.example.test/billing",
    idempotencyKey: "checkout_team_123_test_subscription_1",
    ...change,
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

function signedEvent(type: string, object: unknown, apiVersion = stripeBillingApiVersion) {
  const payload = JSON.stringify({
    id: `evt_${type.replaceAll(".", "_")}`,
    object: "event",
    api_version: apiVersion,
    created: 1_787_594_400,
    data: { object },
    livemode: false,
    pending_webhooks: 1,
    request: null,
    type,
  })
  return {
    payload,
    signature: Stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret }),
  }
}

describe("Stripe billing provider", () => {
  it("maps a stable subscription offer to Stripe Checkout metadata", async () => {
    const fake = fakeStripe()
    const offers = configuration(fake.client).offers as Record<
      string,
      { priceId: string; mode: "subscription" | "payment" }
    >
    const provider = stripeProvider({
      ...configuration(fake.client),
      offers,
    })
    offers.test_subscription_offer!.priceId = "price_mutated_after_configuration"
    const billing = testBilling(provider)

    await expect(run(billing.createCheckoutSession(checkoutRequest()))).resolves.toMatchObject({
      provider: "stripe",
      id: "cs_test_123",
      customerId: null,
      expiresAt: "2026-08-25T18:00:00.000Z",
    })
    expect(fake.checkout).toHaveBeenCalledWith(
      {
        mode: "subscription",
        line_items: [{ price: "price_test_subscription", quantity: 1 }],
        client_reference_id: "team_123",
        success_url: "https://app.example.test/billing/success",
        cancel_url: "https://app.example.test/billing",
        allow_promotion_codes: false,
        customer_email: "owner@example.test",
        metadata,
        subscription_data: { metadata },
      },
      { idempotencyKey: "checkout_team_123_test_subscription_1" },
    )
  })

  it("creates one-time payment customers and propagates metadata to the payment intent", async () => {
    const fake = fakeStripe()
    const billing = testBilling(stripeProvider(configuration(fake.client)))

    await run(
      billing.createCheckoutSession(
        checkoutRequest({
          offerId: "test_payment_offer",
          quantity: 2,
          allowPromotionCodes: true,
          idempotencyKey: "checkout_team_123_test_payment_1",
        }),
      ),
    )

    expect(fake.checkout).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "payment",
        line_items: [{ price: "price_test_payment", quantity: 2 }],
        customer_email: "owner@example.test",
        customer_creation: "always",
        allow_promotion_codes: true,
        payment_intent_data: {
          metadata: {
            ...metadata,
            billing_offer_id: "test_payment_offer",
            billing_quantity: "2",
          },
        },
      }),
      { idempotencyKey: "checkout_team_123_test_payment_1" },
    )
  })

  it("uses only a persisted customer ID when one is available", async () => {
    const fake = fakeStripe()
    const billing = testBilling(
      stripeProvider(configuration(fake.client)),
      "cus_test_123",
    )

    await run(
      billing.createCheckoutSession(
        checkoutRequest({ subject: { id: "team_123", email: "changed@example.test" } }),
      ),
    )

    expect(fake.checkout).toHaveBeenCalledWith(
      expect.objectContaining({ customer: "cus_test_123" }),
      expect.anything(),
    )
    expect(fake.checkout.mock.calls[0]![0]).not.toHaveProperty("customer_email")
  })

  it("creates an idempotent customer portal session", async () => {
    const fake = fakeStripe()
    const billing = testBilling(
      stripeProvider(configuration(fake.client)),
      "cus_test_123",
    )

    await expect(
      run(
        billing.createCustomerPortalSession({
          subjectId: "team_123",
          returnUrl: "https://app.example.test/billing",
          idempotencyKey: "portal_team_123_1",
        }),
      ),
    ).resolves.toEqual({
      provider: "stripe",
      id: "bps_test_123",
      url: "https://billing.stripe.test/p/session/test_123",
    })
    expect(fake.portal).toHaveBeenCalledWith(
      { customer: "cus_test_123", return_url: "https://app.example.test/billing" },
      { idempotencyKey: "portal_team_123_1" },
    )
  })

  it("normalizes signed checkout, subscription, and invoice events", async () => {
    const billing = testBilling(stripeProvider(configuration()))
    const events = [
      {
        type: "checkout.session.completed",
        object: {
          id: "cs_test_123",
          client_reference_id: "team_123",
          metadata: { ...metadata, billing_quantity: "4" },
          customer: "cus_test_123",
          subscription: "sub_test_123",
          payment_status: "paid",
        },
        expected: {
          kind: "checkout.completed",
          checkoutId: "cs_test_123",
          subjectId: "team_123",
          offerId: "test_subscription_offer",
          quantity: 4,
          customerId: "cus_test_123",
          subscriptionId: "sub_test_123",
          paymentStatus: "paid",
        },
      },
      {
        type: "customer.subscription.created",
        object: {
          id: "sub_test_123",
          metadata,
          customer: "cus_test_123",
          items: {
            has_more: false,
            data: [{ price: { id: "price_test_pro" }, quantity: 7 }],
          },
          status: "incomplete",
          cancel_at_period_end: false,
        },
        expected: {
          kind: "subscription.changed",
          subjectId: "team_123",
          offerId: "test_pro_offer",
          quantity: 7,
          customerId: "cus_test_123",
          subscriptionId: "sub_test_123",
          status: "incomplete",
          cancelAtPeriodEnd: false,
        },
      },
      {
        type: "invoice.paid",
        object: {
          id: "in_test_123",
          customer: "cus_test_123",
          parent: {
            type: "subscription_details",
            quote_details: null,
            subscription_details: {
              metadata,
              subscription: "sub_test_123",
            },
          },
          amount_due: 1_500,
          amount_paid: 1_500,
          currency: "gbp",
          lines: {
            has_more: false,
            data: [
              {
                parent: {
                  type: "subscription_item_details",
                  subscription_item_details: { proration: false },
                },
                pricing: {
                  type: "price_details",
                  price_details: { price: "price_test_pro" },
                },
                quantity: 7,
              },
            ],
          },
        },
        expected: {
          kind: "invoice.paid",
          subjectId: "team_123",
          offerId: "test_pro_offer",
          quantity: 7,
          customerId: "cus_test_123",
          subscriptionId: "sub_test_123",
          invoiceId: "in_test_123",
          amountDue: 1_500,
          amountPaid: 1_500,
          currency: "gbp",
        },
      },
    ] as const

    for (const [index, fixture] of events.entries()) {
      const payload = JSON.stringify({
        id: `evt_test_${index}`,
        object: "event",
        api_version: stripeBillingApiVersion,
        created: 1_787_594_400,
        data: { object: fixture.object },
        livemode: false,
        pending_webhooks: 1,
        request: null,
        type: fixture.type,
      })
      const signature = Stripe.webhooks.generateTestHeaderString({
        payload,
        secret: webhookSecret,
        timestamp: Math.floor(Date.now() / 1_000),
      })

      await expect(run(billing.parseWebhook({ payload, signature }))).resolves.toMatchObject({
        id: `evt_test_${index}`,
        provider: "stripe",
        providerEventType: fixture.type,
        ...fixture.expected,
      })
    }
  })

  it("does not normalize Stripe objects that were not created through this contract", async () => {
    const billing = testBilling(stripeProvider(configuration()))
    const payload = JSON.stringify({
      id: "evt_foreign",
      object: "event",
      api_version: stripeBillingApiVersion,
      created: 1_787_594_400,
      data: {
        object: {
          id: "cs_foreign",
          client_reference_id: "other",
          metadata: {},
          customer: "cus_foreign",
          subscription: null,
          payment_status: "paid",
        },
      },
      livemode: false,
      pending_webhooks: 1,
      request: null,
      type: "checkout.session.completed",
    })
    const signature = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret: webhookSecret,
    })

    await expect(run(billing.parseWebhook({ payload, signature }))).resolves.toMatchObject({
      kind: "unsupported",
      providerEventType: "checkout.session.completed",
    })
  })

  it("does not trust copied checkout metadata for an unconfigured offer", async () => {
    const billing = testBilling(stripeProvider(configuration()))
    const webhook = signedEvent("checkout.session.completed", {
      id: "cs_test_unknown_offer",
      client_reference_id: "team_123",
      metadata: { ...metadata, billing_offer_id: "not_configured" },
      customer: "cus_test_123",
      subscription: "sub_test_123",
      payment_status: "paid",
    })

    await expect(run(billing.parseWebhook(webhook))).resolves.toMatchObject({
      kind: "unsupported",
    })
  })

  it("reports lexically invalid Stripe object IDs as webhook failures", async () => {
    const billing = testBilling(stripeProvider(configuration()))
    const webhook = signedEvent("checkout.session.completed", {
      id: "bad id",
      client_reference_id: "team_123",
      metadata,
      customer: "cus_test_123",
      subscription: "sub_test_123",
      payment_status: "paid",
    })

    const failure = await runFailure(billing.parseWebhook(webhook))

    expect(failure).toBeInstanceOf(InvalidBillingWebhookError)
  })

  it("rejects a webhook with an invalid signature", async () => {
    const billing = testBilling(stripeProvider(configuration()))

    const failure = await runFailure(
      billing.parseWebhook({ payload: "{}", signature: "t=1,v1=forged" }),
    )
    expect(failure).toBeInstanceOf(InvalidBillingWebhookError)
  })

  it("rejects a signed event rendered with an unsupported Stripe API version", async () => {
    const billing = testBilling(stripeProvider(configuration()))
    const payload = JSON.stringify({
      id: "evt_old_version",
      object: "event",
      api_version: "2025-01-27.acacia",
      created: 1_787_594_400,
      data: { object: {} },
      livemode: false,
      pending_webhooks: 1,
      request: null,
      type: "checkout.session.completed",
    })
    const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret })

    const failure = await runFailure(billing.parseWebhook({ payload, signature }))

    expect(failure).toBeInstanceOf(InvalidBillingWebhookError)
    expect((failure as Error).message).toContain("API version")
  })

  it("reports malformed signed event data as an expected webhook failure", async () => {
    const billing = testBilling(stripeProvider(configuration()))
    const webhook = signedEvent("customer.subscription.updated", {
      id: "sub_malformed",
      metadata,
      customer: "cus_test_123",
      status: "active",
      cancel_at_period_end: false,
    })

    const failure = await runFailure(billing.parseWebhook(webhook))

    expect(failure).toBeInstanceOf(InvalidBillingWebhookError)
  })

  it("does not guess an entitlement for a multi-item subscription", async () => {
    const billing = testBilling(stripeProvider(configuration()))
    const webhook = signedEvent("customer.subscription.updated", {
      id: "sub_multi_item",
      metadata,
      customer: "cus_test_123",
      items: {
        has_more: false,
        data: [
          { price: { id: "price_test_subscription" }, quantity: 1 },
          { price: { id: "price_test_pro" }, quantity: 2 },
        ],
      },
      status: "active",
      cancel_at_period_end: false,
    })

    await expect(run(billing.parseWebhook(webhook))).resolves.toMatchObject({
      kind: "unsupported",
    })
  })

  it("wraps Stripe API failures behind the shared provider error", async () => {
    const fake = fakeStripe()
    fake.checkout.mockRejectedValueOnce(new Error("Stripe secret response"))
    const billing = testBilling(stripeProvider(configuration(fake.client)))

    const failure = await runFailure(billing.createCheckoutSession(checkoutRequest()))
    expect(failure).toBeInstanceOf(BillingProviderUnavailableError)
    expect(failure).not.toHaveProperty("safeCause")
    expect((failure as Error).message).not.toContain("Stripe secret response")
  })

  it("reports malformed Stripe checkout output through the typed failure channel", async () => {
    const fake = fakeStripe()
    fake.checkout.mockResolvedValueOnce({
      id: "cs_test_malformed",
      url: "https://checkout.stripe.test/c/pay/cs_test_malformed",
      customer: null,
      expires_at: Number.NaN,
    })
    const billing = testBilling(stripeProvider(configuration(fake.client)))

    const failure = await runFailure(billing.createCheckoutSession(checkoutRequest()))
    expect(failure).toBeInstanceOf(BillingProviderUnavailableError)
  })

  it("returns an invalid Stripe catalog through the Effect error channel", async () => {
    const failure = await runFailure(
      createStripeBillingProvider(
        configuration(fakeStripe().client, {
          offers: {
            test_subscription_offer: { priceId: "not-a-price", mode: "subscription" },
          },
        }),
      ),
    )

    expect(failure).toBeInstanceOf(BillingConfigurationError)
  })

  it("rejects ambiguous Stripe price mappings", async () => {
    const failure = await runFailure(
      createStripeBillingProvider(
        configuration(fakeStripe().client, {
          offers: {
            first: { priceId: "price_shared", mode: "subscription" },
            second: { priceId: "price_shared", mode: "subscription" },
          },
        }),
      ),
    )

    expect(failure).toBeInstanceOf(BillingConfigurationError)
  })
})
