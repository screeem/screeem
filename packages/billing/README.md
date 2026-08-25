# `@screeem/billing`

`@screeem/billing` creates checkout and customer portal sessions and parses
billing webhooks. The Stripe adapter lives at `@screeem/billing/stripe`.

Application code owns plans, environment variables, routes, customer records,
and entitlements. Importing `@screeem/billing` does not import Stripe.

## Public contract

`createBilling(provider, configuration)` returns
`Effect<Billing, BillingConfigurationError>`. `Billing` has four operations:

- `createCheckoutSession(request)` validates the subject ID, offer ID, redirect
  URLs, quantity, and idempotency key before calling the provider.
- `createCustomerPortalSession(request)` validates the subject ID, return URL,
  and idempotency key.
- `parseWebhook(request)` rejects oversized payloads, calls the provider's
  signature check, and validates the returned event.
- `describe()` returns the provider name, offer IDs, and webhook payload limit.

`BillingCustomerResolver` looks up the customer ID by `(provider, subjectId)`
before checkout or portal creation. Public requests have no provider customer
ID field.

The package returns expected failures as `Data.TaggedError` values. Use
`Effect.catchTag` for one failure or `Effect.catchTags` for the `BillingFailure`
union. Code bugs and invalid provider output fail as Effect defects.

`createStripeBillingProvider(configuration)` returns
`Effect<BillingProvider, BillingConfigurationError>`. Pass a webhook secret,
at least one offer, and either a secret key or a Stripe client. Each offer maps
an application offer ID to a Stripe price ID and checkout mode. Stripe is an
optional peer dependency.

## Webhook contract

`parseWebhook` takes the exact request body and provider signature. It returns
`unsupported` for unrelated events and for these cases:

- payment refunds, partial refunds, and disputes;
- subscriptions with more than one item.

An invoice event has a null offer and quantity unless exactly one non-proration
subscription line maps to an offer. `ParseBillingWebhookRequest` carries one
signature string. An adapter that needs several signature headers needs a
different request type.

## Replacing Stripe

Implement `BillingProvider` to add another provider. The adapter maps offer IDs,
creates hosted sessions, verifies webhooks, and returns `BillingEvent` values.

`createBilling` checks the provider name and offer ID on every returned event.

## Stripe references

The Stripe adapter uses these references:

- [subscription webhooks](https://docs.stripe.com/billing/subscriptions/webhooks)
- [Checkout fulfillment](https://docs.stripe.com/checkout/fulfillment)
- [webhook signatures](https://docs.stripe.com/webhooks/signature)

The adapter accepts only the event shape named by `stripeBillingApiVersion`.
Events with another Stripe API version fail with
`InvalidBillingWebhookError`.

## Verification

Run the package checks with:

```bash
pnpm --filter @screeem/billing typecheck
pnpm --filter @screeem/billing test
pnpm --filter @screeem/billing build
```
