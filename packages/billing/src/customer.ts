import type { Effect } from "effect"

import type { BillingFailure } from "./errors.js"

export interface BillingCustomerLookupRequest {
  readonly provider: string
  readonly subjectId: string
}

export interface BillingCustomerResolver {
  findCustomerId(
    request: BillingCustomerLookupRequest,
  ): Effect.Effect<string | null, BillingFailure>
}
