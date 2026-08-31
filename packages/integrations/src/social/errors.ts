import { Data } from "effect"

import type { SocialProviderName } from "./model.js"

export class InvalidSocialConfigurationError extends Data.TaggedError(
  "InvalidSocialConfigurationError",
)<{
  readonly provider: SocialProviderName
  readonly reason: string
}> {
  readonly code = "invalid_social_configuration" as const

  get message(): string {
    return `${this.provider} configuration is invalid: ${this.reason}`
  }
}

export class InvalidSocialRequestError extends Data.TaggedError(
  "InvalidSocialRequestError",
)<{
  readonly provider: SocialProviderName
  readonly operation: string
  readonly reason: string
}> {
  readonly code = "invalid_social_request" as const

  get message(): string {
    return `${this.provider} ${this.operation} request is invalid: ${this.reason}`
  }
}

export class SocialAuthorizationError extends Data.TaggedError(
  "SocialAuthorizationError",
)<{
  readonly provider: SocialProviderName
  readonly reason: string
  readonly providerCode: string | null
  readonly reauthorize: boolean
  /** True only when the provider has proven the whole user grant inactive. */
  readonly grantInactive: boolean
}> {
  readonly code = "social_authorization_failed" as const

  get message(): string {
    return `${this.provider} authorization failed: ${this.reason}`
  }
}

export class SocialRateLimitError extends Data.TaggedError(
  "SocialRateLimitError",
)<{
  readonly provider: SocialProviderName
  readonly operation: string
  readonly retryAfterSeconds: number | null
}> {
  readonly code = "social_rate_limited" as const

  get message(): string {
    return `${this.provider} rate limited ${this.operation}`
  }
}

export class SocialProviderUnavailableError extends Data.TaggedError(
  "SocialProviderUnavailableError",
)<{
  readonly provider: SocialProviderName
  readonly operation: string
}> {
  readonly code = "social_provider_unavailable" as const

  get message(): string {
    return `${this.provider} could not complete ${this.operation}`
  }
}

export class SocialPublishRejectedError extends Data.TaggedError(
  "SocialPublishRejectedError",
)<{
  readonly provider: SocialProviderName
  readonly reason: string
  readonly providerCode: string | null
}> {
  readonly code = "social_publish_rejected" as const

  get message(): string {
    return `${this.provider} rejected the post: ${this.reason}`
  }
}

/** A retry-safe host claim/CAS step failed without an unacknowledged provider mutation. */
export class SocialPublishPersistenceError extends Data.TaggedError(
  "SocialPublishPersistenceError",
)<{
  readonly provider: SocialProviderName
  readonly operation: string
  readonly stage: "claim" | "acknowledge"
}> {
  readonly code = "social_publish_persistence_failed" as const

  get message(): string {
    return `${this.provider} ${this.operation} ${this.stage} did not complete`
  }
}

/**
 * The provider may have accepted a non-idempotent publish request, but no
 * authoritative receipt was received. Callers must not retry automatically.
 */
export class SocialPublishUncertainError extends Data.TaggedError(
  "SocialPublishUncertainError",
)<{
  readonly provider: SocialProviderName
  readonly operation: string
  /** Provider-side reference recovered from an acknowledgement, if any. */
  readonly providerReference: string | null
}> {
  readonly code = "social_publish_uncertain" as const

  get message(): string {
    return `${this.provider} ${this.operation} may have been accepted; manual reconciliation is required`
  }
}

export class InvalidSocialProviderResponseError extends Data.TaggedError(
  "InvalidSocialProviderResponseError",
)<{
  readonly provider: SocialProviderName
  readonly operation: string
  readonly providerReference?: string
}> {
  readonly code = "invalid_social_provider_response" as const

  get message(): string {
    return `${this.provider} returned an invalid response for ${this.operation}`
  }
}

export type SocialTransportFailure =
  | SocialProviderUnavailableError
  | InvalidSocialProviderResponseError

export type SocialIntegrationFailure =
  | InvalidSocialRequestError
  | SocialAuthorizationError
  | SocialRateLimitError
  | SocialProviderUnavailableError
  | SocialPublishPersistenceError
  | SocialPublishRejectedError
  | SocialPublishUncertainError
  | InvalidSocialProviderResponseError

export type SocialIntegrationError =
  | InvalidSocialConfigurationError
  | SocialIntegrationFailure

export function isSocialIntegrationFailure(error: unknown): error is SocialIntegrationFailure {
  return (
    error instanceof InvalidSocialRequestError ||
    error instanceof SocialAuthorizationError ||
    error instanceof SocialRateLimitError ||
    error instanceof SocialProviderUnavailableError ||
    error instanceof SocialPublishPersistenceError ||
    error instanceof SocialPublishRejectedError ||
    error instanceof SocialPublishUncertainError ||
    error instanceof InvalidSocialProviderResponseError
  )
}
