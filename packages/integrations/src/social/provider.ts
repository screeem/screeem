import type { Effect } from "effect"

import type {
  ConnectedSocialAccount,
  SocialAuthorization,
  SocialAuthorizationRequest,
  SocialCodeExchangeRequest,
  SocialCredentialBase,
  SocialCredentialRevocation,
  SocialProviderDescription,
} from "./model.js"
import type {
  InvalidSocialConfigurationError,
  SocialIntegrationFailure,
} from "./errors.js"

/** Host-owned lease and durable CAS boundary for a scheduled publish. */
export interface SocialPublishPersistence<PublishReceipt, Requirements = never> {
  /** Atomically authorize/claim initial dispatch or the exact stored receipt revision. */
  readonly claim: (
    receipt: PublishReceipt | null,
  ) => Effect.Effect<void, unknown, Requirements>
  /** Durably commit the provider-acknowledged next receipt revision. */
  readonly acknowledge: (
    receipt: PublishReceipt,
  ) => Effect.Effect<void, unknown, Requirements>
}

export interface SocialProvider<
  Credential extends SocialCredentialBase,
  PublishRequest,
  PublishReceipt,
> {
  authorizationUrl(
    request: SocialAuthorizationRequest,
  ): Effect.Effect<SocialAuthorization, SocialIntegrationFailure>
  exchangeCode(
    request: SocialCodeExchangeRequest,
  ): Effect.Effect<ConnectedSocialAccount<Credential>, SocialIntegrationFailure>
  refreshCredential(
    credential: Credential,
  ): Effect.Effect<Credential, SocialIntegrationFailure>
  revokeCredential(
    credential: Credential,
  ): Effect.Effect<SocialCredentialRevocation, SocialIntegrationFailure>
  getAccount(
    credential: Credential,
  ): Effect.Effect<ConnectedSocialAccount<Credential>["account"], SocialIntegrationFailure>
  publish<Requirements>(
    credential: Credential,
    request: PublishRequest,
    persistence: SocialPublishPersistence<PublishReceipt, Requirements>,
  ): Effect.Effect<PublishReceipt, SocialIntegrationFailure, Requirements>
  advancePublish<Requirements>(
    credential: Credential,
    receipt: PublishReceipt,
    persistence: SocialPublishPersistence<PublishReceipt, Requirements>,
  ): Effect.Effect<PublishReceipt, SocialIntegrationFailure, Requirements>
  describe(): SocialProviderDescription
}

export type SocialProviderConstruction<Provider> = Effect.Effect<
  Provider,
  InvalidSocialConfigurationError
>
