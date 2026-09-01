export {
  createFetchSocialHttpClient,
  type FetchSocialHttpClientOptions,
  type SocialHttpClient,
  type SocialHttpRequest,
  type SocialHttpResponse,
} from "./http.js"
export {
  InvalidSocialConfigurationError,
  InvalidSocialProviderResponseError,
  InvalidSocialRequestError,
  SocialAuthorizationError,
  SocialProviderUnavailableError,
  SocialPublishPersistenceError,
  SocialPublishRejectedError,
  SocialPublishUncertainError,
  SocialRateLimitError,
  isSocialIntegrationFailure,
  type SocialIntegrationError,
  type SocialIntegrationFailure,
  type SocialTransportFailure,
} from "./errors.js"
export type {
  ConnectedSocialAccount,
  SocialAccountProfile,
  SocialAuthorization,
  SocialAuthorizationRequest,
  SocialCodeExchangeRequest,
  SocialCredentialBase,
  SocialCredentialRevocation,
  SocialProviderDescription,
  SocialProviderName,
  SocialPublishPhase,
} from "./model.js"
export type {
  SocialProvider,
  SocialProviderConstruction,
  SocialPublishPersistence,
} from "./provider.js"
export {
  NonNegativeSafeIntegerSchema,
  PositiveSafeIntegerSchema,
  SafeIntegerSchema,
  ScheduledSocialPostTargetMetadataV1Schema,
  SocialMediaAssetReferenceV1Schema,
  SocialPostScheduleV1Schema,
} from "./scheduling.js"
export type {
  ScheduledSocialPostTargetMetadataV1,
  ScheduledSocialPostTargetMetadataV1Encoded,
  SocialMediaAssetReferenceV1,
  SocialMediaAssetReferenceV1Encoded,
  SocialPostScheduleV1,
  SocialPostScheduleV1Encoded,
} from "./scheduling.js"
