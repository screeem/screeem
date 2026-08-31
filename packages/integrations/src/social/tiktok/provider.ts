import { Effect, Fiber } from "effect"

import {
  InvalidSocialConfigurationError,
  InvalidSocialProviderResponseError,
  InvalidSocialRequestError,
  SocialAuthorizationError,
  SocialProviderUnavailableError,
  SocialPublishPersistenceError,
  SocialPublishRejectedError,
  SocialPublishUncertainError,
  SocialRateLimitError,
  type SocialIntegrationFailure,
} from "../errors.js"
import {
  createFetchSocialHttpClient,
  executeSocialHttpRequest,
  type SocialHttpClient,
  type SocialHttpResponse,
} from "../http.js"
import {
  bearerTokenType,
  boundedString,
  decoded,
  identifier,
  nonNegativeInteger,
  oauthCallback,
  oauthState,
  parseProviderJson,
  postText,
  providerErrorCode,
  providerErrorMessage,
  publicMediaUrl,
  record,
  redirectUri,
  scopes,
  secret,
  validated,
} from "../internal.js"
import type {
  ConnectedSocialAccount,
  SocialAuthorization,
  SocialAuthorizationRequest,
} from "../model.js"
import type {
  SocialProvider,
  SocialProviderConstruction,
  SocialPublishPersistence,
} from "../provider.js"
import {
  tiktokPrivacyLevels,
  type TikTokAccountProfile,
  type TikTokCredential,
  type TikTokCreatorInfo,
  type TikTokPhotoPublishRequest,
  type TikTokPrivacyLevel,
  type TikTokProviderDescription,
  type TikTokPublishReceipt,
  type TikTokPublishRequest,
  type TikTokVideoPublishRequest,
} from "./model.js"

const provider = "tiktok" as const
const apiBase = "https://open.tiktokapis.com"
const requiredScopes = ["user.info.basic", "video.publish"] as const
const maximumPhotoItems = 35
const persistenceTimeoutMilliseconds = 5_000

export interface TikTokProviderConfiguration {
  readonly clientKey: string
  readonly clientSecret: string
  /** HTTPS directory prefixes registered in the TikTok developer portal. */
  readonly verifiedMediaUrlPrefixes: readonly string[]
  readonly scopes?: readonly string[]
  readonly httpClient?: SocialHttpClient
}

export interface TikTokProvider extends SocialProvider<
  TikTokCredential,
  TikTokPublishRequest,
  TikTokPublishReceipt
> {
  getAccount(
    credential: TikTokCredential,
  ): Effect.Effect<TikTokAccountProfile, SocialIntegrationFailure>
  getCreatorInfo(
    credential: TikTokCredential,
  ): Effect.Effect<TikTokCreatorInfo, SocialIntegrationFailure>
  describe(): TikTokProviderDescription
}

interface ResolvedConfiguration {
  readonly clientKey: string
  readonly clientSecret: string
  readonly verifiedMediaUrlPrefixes: readonly string[]
  readonly scopes: readonly string[]
  readonly httpClient: SocialHttpClient
}

export function createTikTokProvider(
  configuration: TikTokProviderConfiguration,
): SocialProviderConstruction<TikTokProvider> {
  return Effect.suspend(() => {
    try {
      return Effect.succeed(makeTikTokProvider(resolveConfiguration(configuration)))
    } catch (error) {
      return Effect.fail(new InvalidSocialConfigurationError({
        provider,
        reason: error instanceof Error ? error.message : "invalid configuration",
      }))
    }
  })
}

function makeTikTokProvider(configuration: ResolvedConfiguration): TikTokProvider {
  const api: TikTokProvider = {
    authorizationUrl: (input) =>
      validated(provider, "authorization", () => authorization(configuration, input)),

    exchangeCode: (input) =>
      validated(provider, "code exchange", () => oauthCallback(input, tiktokRedirectUri)).pipe(
        Effect.flatMap(({ code, redirectUri: safeRedirectUri }) =>
          tiktokRequest(
            configuration,
            "code exchange",
            {
              provider,
              operation: "code exchange",
              method: "POST",
              url: `${apiBase}/v2/oauth/token/`,
              headers: { "content-type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({
                client_key: configuration.clientKey,
                client_secret: configuration.clientSecret,
                code,
                grant_type: "authorization_code",
                redirect_uri: safeRedirectUri,
              }).toString(),
            },
            "authorization",
          ),
        ),
        Effect.flatMap((response) =>
          decoded(provider, "code exchange", () => tiktokCredentialFromToken(response)),
        ),
        Effect.flatMap((credential) =>
          account(configuration, credential).pipe(
            Effect.map((profile): ConnectedSocialAccount<TikTokCredential> =>
              Object.freeze({ credential, account: profile }),
            ),
          ),
        ),
      ),

    refreshCredential: (input) =>
      validated(provider, "token refresh", () => tiktokCredential(input)).pipe(
        Effect.flatMap((credential) =>
          tiktokRequest(
            configuration,
            "token refresh",
            {
              provider,
              operation: "token refresh",
              method: "POST",
              url: `${apiBase}/v2/oauth/token/`,
              headers: { "content-type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({
                client_key: configuration.clientKey,
                client_secret: configuration.clientSecret,
                grant_type: "refresh_token",
                refresh_token: credential.refreshToken,
              }).toString(),
            },
            "authorization",
          ).pipe(Effect.map((response) => ({ credential, response }))),
        ),
        Effect.flatMap(({ credential, response }) =>
          decoded(provider, "token refresh", () => {
            const refreshed = tiktokCredentialFromToken(response)
            if (refreshed.accountId !== credential.accountId) {
              throw new TypeError("TikTok refresh changed the connected account")
            }
            return refreshed
          }),
        ),
      ),

    revokeCredential: (input) => Effect.uninterruptible(
      validated(provider, "credential revocation", () => tiktokCredential(input)).pipe(
        Effect.flatMap((credential) =>
          account(configuration, credential).pipe(
            Effect.zipRight(tiktokRevokeCredential(configuration, credential)),
          ),
        ),
        Effect.as(Object.freeze({ status: "revoked" as const })),
        Effect.catchTag("SocialAuthorizationError", (error) =>
          error.grantInactive
            ? Effect.succeed(Object.freeze({ status: "already_inactive" as const }))
            : Effect.fail(error)
        ),
      ),
    ),

    getAccount: (input) =>
      validated(provider, "account lookup", () => tiktokCredential(input)).pipe(
        Effect.flatMap((credential) => account(configuration, credential)),
      ),

    getCreatorInfo: (input) =>
      validated(provider, "creator lookup", () => tiktokCredential(input)).pipe(
        Effect.flatMap((credential) => creatorInfo(configuration, credential)),
      ),

    publish: (credentialInput, requestInput, persistence) =>
      validated(provider, "publish", () => ({
        credential: tiktokCredential(credentialInput),
        request: tiktokPublishRequest(configuration, requestInput),
      })).pipe(
        Effect.flatMap(({ credential, request }) =>
          claimPublish(persistence, null, "publish").pipe(
            Effect.zipRight(account(configuration, credential)),
            Effect.zipRight(creatorInfo(configuration, credential)),
            Effect.flatMap((creator) => validateCreatorSelection(creator, request)),
            Effect.map(() => ({ credential, request })),
          ),
        ),
        Effect.flatMap(({ credential, request }) =>
          commitTikTokMutation(
            tiktokRequest(
              configuration,
              "publish",
              {
                provider,
                operation: "publish",
                method: "POST",
                url: request.kind === "video"
                  ? `${apiBase}/v2/post/publish/video/init/`
                  : `${apiBase}/v2/post/publish/content/init/`,
                headers: authorizationHeaders(credential.accessToken),
                body: JSON.stringify(tiktokPublishBody(request)),
              },
              "publish",
            ).pipe(
              Effect.flatMap((response) =>
                decoded(provider, "publish", () => {
                  const data = record(response.data)
                  return Object.freeze({
                    provider,
                    accountId: credential.accountId,
                    phase: "processing" as const,
                    publishId: identifier(data.publish_id, "TikTok publish ID", 64),
                    postIds: Object.freeze([] as const),
                    failureReason: null,
                  })
                }),
              ),
              Effect.catchTags({
                InvalidSocialProviderResponseError: (error) => Effect.fail(
                  new SocialPublishUncertainError({
                    provider,
                    operation: "publish",
                    providerReference: error.providerReference ?? null,
                  }),
                ),
                SocialProviderUnavailableError: () => Effect.fail(
                  new SocialPublishUncertainError({
                    provider,
                    operation: "publish",
                    providerReference: null,
                  }),
                ),
              }),
            ),
            persistence,
            "publish",
          ),
        ),
      ),

    advancePublish: (credentialInput, receiptInput, persistence) =>
      validated(provider, "publish status", () => ({
        credential: tiktokCredential(credentialInput),
        receipt: tiktokReceipt(receiptInput),
      })).pipe(
        Effect.flatMap(({ credential, receipt }) => {
          if (credential.accountId !== receipt.accountId) {
            return Effect.fail(new InvalidSocialRequestError({
              provider,
              operation: "publish status",
              reason: "receipt account does not match the credential",
            }))
          }
          if (receipt.phase !== "processing") return Effect.succeed(receipt)
          return claimPublish(persistence, receipt, "publish advancement").pipe(
            Effect.zipRight(tiktokRequest(
              configuration,
              "publish status",
              {
                provider,
                operation: "publish status",
                method: "POST",
                url: `${apiBase}/v2/post/publish/status/fetch/`,
                headers: authorizationHeaders(credential.accessToken),
                body: JSON.stringify({ publish_id: receipt.publishId }),
              },
              "publish",
            )),
            Effect.flatMap((response) =>
              decoded(provider, "publish status", () => tiktokStatus(receipt, response)),
            ),
            Effect.flatMap((nextReceipt) =>
              nextReceipt === receipt
                ? Effect.succeed(receipt)
                : acknowledgeReadOnlyReceipt(nextReceipt, persistence, "publish status")
            ),
          )
        }),
      ),

    describe: () => Object.freeze({
      provider,
      scopes: configuration.scopes,
      media: Object.freeze(["image", "video"] as const),
      maximumPhotoItems,
      transfer: "pull_from_verified_url" as const,
      verifiedMediaUrlPrefixes: configuration.verifiedMediaUrlPrefixes,
    }),
  }
  return Object.freeze(api)
}

function authorization(
  configuration: ResolvedConfiguration,
  input: SocialAuthorizationRequest,
): SocialAuthorization {
  const state = oauthState(input.state)
  const url = new URL("https://www.tiktok.com/v2/auth/authorize/")
  url.searchParams.set("client_key", configuration.clientKey)
  url.searchParams.set("redirect_uri", tiktokRedirectUri(input.redirectUri))
  url.searchParams.set("response_type", "code")
  url.searchParams.set("scope", configuration.scopes.join(","))
  url.searchParams.set("state", state)
  if (input.forceReauthorization === true) url.searchParams.set("disable_auto_auth", "1")
  return Object.freeze({ provider, url: url.toString(), state, scopes: configuration.scopes })
}

function account(
  configuration: ResolvedConfiguration,
  credential: TikTokCredential,
): Effect.Effect<TikTokAccountProfile, SocialIntegrationFailure> {
  return tiktokRequest(
    configuration,
    "account lookup",
    {
      provider,
      operation: "account lookup",
      method: "GET",
      url: `${apiBase}/v2/user/info/?fields=open_id,avatar_url,display_name`,
      headers: { authorization: `Bearer ${credential.accessToken}` },
    },
    "authorization",
  ).pipe(
    Effect.flatMap((response) =>
      decoded(provider, "account lookup", () => {
        const data = record(response.data)
        const user = record(data.user)
        const id = identifier(user.open_id, "TikTok account ID")
        if (id !== credential.accountId) throw new TypeError("TikTok account does not match token")
        const displayName = boundedString(user.display_name, "TikTok display name", 160)
        return Object.freeze({
          provider,
          id,
          username: null,
          displayName,
          pictureUrl: optionalHttpsUrl(user.avatar_url),
        })
      }),
    ),
  )
}

function creatorInfo(
  configuration: ResolvedConfiguration,
  credential: TikTokCredential,
): Effect.Effect<TikTokCreatorInfo, SocialIntegrationFailure> {
  return tiktokRequest(
    configuration,
    "creator lookup",
    {
      provider,
      operation: "creator lookup",
      method: "POST",
      url: `${apiBase}/v2/post/publish/creator_info/query/`,
      headers: authorizationHeaders(credential.accessToken),
    },
    "publish",
  ).pipe(
    Effect.flatMap((response) =>
      decoded(provider, "creator lookup", () => {
        const data = record(response.data)
        const privacyLevels = Array.isArray(data.privacy_level_options)
          ? data.privacy_level_options.map(tiktokPrivacyLevel)
          : (() => { throw new TypeError("privacy options are invalid") })()
        if (privacyLevels.length === 0) throw new TypeError("privacy options are invalid")
        return Object.freeze({
          username: boundedString(data.creator_username, "TikTok username", 160),
          displayName: boundedString(data.creator_nickname, "TikTok display name", 160),
          pictureUrl: optionalHttpsUrl(data.creator_avatar_url),
          privacyLevels: Object.freeze([...new Set(privacyLevels)]),
          commentsDisabled: booleanValue(data.comment_disabled, "comment state"),
          duetDisabled: booleanValue(data.duet_disabled, "duet state"),
          stitchDisabled: booleanValue(data.stitch_disabled, "stitch state"),
          maximumVideoDurationSeconds: positiveDuration(
            data.max_video_post_duration_sec,
            "maximum video duration",
            600,
          ),
        })
      }),
    ),
  )
}

function validateCreatorSelection(
  creator: TikTokCreatorInfo,
  request: TikTokPublishRequest,
): Effect.Effect<void, InvalidSocialRequestError> {
  return validated(provider, "publish", () => {
    if (!creator.privacyLevels.includes(request.privacyLevel)) {
      throw new TypeError("privacy level is not available for this TikTok account")
    }
    if (creator.commentsDisabled && !request.disableComment) {
      throw new TypeError("comments are disabled for this TikTok account")
    }
    if (request.kind === "video" && creator.duetDisabled && !request.disableDuet) {
      throw new TypeError("duets are disabled for this TikTok account")
    }
    if (request.kind === "video" && creator.stitchDisabled && !request.disableStitch) {
      throw new TypeError("stitches are disabled for this TikTok account")
    }
    if (request.kind === "video" && request.durationSeconds > creator.maximumVideoDurationSeconds) {
      throw new TypeError("video exceeds this TikTok account's maximum duration")
    }
    if (
      request.brandedContent === true &&
      request.privacyLevel !== "PUBLIC_TO_EVERYONE" &&
      request.privacyLevel !== "MUTUAL_FOLLOW_FRIENDS"
    ) {
      throw new TypeError("branded content visibility must be public or friends")
    }
  })
}

function tiktokPublishBody(request: TikTokPublishRequest): Record<string, unknown> {
  const commercial = {
    brand_content_toggle: request.brandedContent,
    brand_organic_toggle: request.ownBrandContent,
  }
  if (request.kind === "video") {
    return {
      post_info: {
        title: request.title,
        privacy_level: request.privacyLevel,
        disable_duet: request.disableDuet,
        disable_comment: request.disableComment,
        disable_stitch: request.disableStitch,
        ...commercial,
        ...(request.coverTimestampMs === undefined
          ? {}
          : { video_cover_timestamp_ms: request.coverTimestampMs }),
        is_aigc: request.isAiGenerated,
      },
      source_info: { source: "PULL_FROM_URL", video_url: request.url },
    }
  }
  return {
    post_mode: "DIRECT_POST",
    media_type: "PHOTO",
    post_info: {
      ...(request.title === undefined ? {} : { title: request.title }),
      ...(request.description === undefined ? {} : { description: request.description }),
      privacy_level: request.privacyLevel,
      disable_comment: request.disableComment,
      auto_add_music: request.autoAddMusic ?? false,
      ...commercial,
    },
    source_info: {
      source: "PULL_FROM_URL",
      photo_cover_index: request.coverIndex,
      photo_images: request.urls,
    },
    is_aigc: request.isAiGenerated,
  }
}

function tiktokStatus(
  receipt: Extract<TikTokPublishReceipt, { readonly phase: "processing" }>,
  response: Record<string, unknown>,
): TikTokPublishReceipt {
  const data = record(response.data)
  const status = boundedString(data.status, "TikTok publish status", 64)
  if (status === "PROCESSING_DOWNLOAD") return receipt
  if (status === "PROCESSING_UPLOAD") {
    throw new TypeError("TikTok returned a file-upload status for a pull-from-URL post")
  }
  if (status === "PUBLISH_COMPLETE") {
    const rawPostIds = data.publicaly_available_post_id ?? data.publicly_available_post_id ?? []
    if (!Array.isArray(rawPostIds)) throw new TypeError("TikTok post IDs are invalid")
    return Object.freeze({
      ...receipt,
      phase: "published",
      postIds: Object.freeze(rawPostIds.map(tiktokPostId)),
      failureReason: null,
    })
  }
  if (status === "FAILED") {
    const reason = typeof data.fail_reason === "string" && data.fail_reason.length > 0
      ? boundedString(data.fail_reason, "TikTok failure reason", 512)
      : "TikTok could not publish the post"
    return Object.freeze({
      ...receipt,
      phase: "failed",
      postIds: Object.freeze([] as const),
      failureReason: reason,
    })
  }
  if (status === "SEND_TO_USER_INBOX") {
    throw new TypeError("TikTok returned an upload-only status for a direct post")
  }
  throw new TypeError("TikTok publish status is invalid")
}

function commitTikTokMutation<Requirements>(
  effect: Effect.Effect<TikTokPublishReceipt, SocialIntegrationFailure>,
  persistence: SocialPublishPersistence<TikTokPublishReceipt, Requirements>,
  operation: string,
): Effect.Effect<TikTokPublishReceipt, SocialIntegrationFailure, Requirements> {
  return Effect.uninterruptibleMask((restore) =>
    effect.pipe(
      Effect.flatMap((receipt) => acknowledgeMutatedReceipt(
        receipt,
        persistence,
        operation,
        restore,
      )),
    ),
  )
}

function acknowledgeMutatedReceipt<Requirements>(
  receipt: TikTokPublishReceipt,
  persistence: SocialPublishPersistence<TikTokPublishReceipt, Requirements>,
  operation: string,
  restore: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>,
): Effect.Effect<TikTokPublishReceipt, SocialPublishUncertainError, Requirements> {
  const failure = () => new SocialPublishUncertainError({
    provider,
    operation: `${operation} acknowledgement`,
    providerReference: receipt.publishId,
  })
  const acknowledgement = Effect.suspend(() => persistence.acknowledge(receipt)).pipe(
    Effect.catchAllCause(() => Effect.fail(failure())),
  )
  return Effect.forkDaemon(acknowledgement).pipe(
    Effect.flatMap((fiber) => restore(Fiber.join(fiber).pipe(
      Effect.timeoutFail({
        duration: persistenceTimeoutMilliseconds,
        onTimeout: failure,
      }),
    ))),
    Effect.as(receipt),
  )
}

function claimPublish<Receipt, Requirements>(
  persistence: SocialPublishPersistence<Receipt, Requirements>,
  receipt: Receipt | null,
  operation: string,
): Effect.Effect<void, SocialPublishPersistenceError, Requirements> {
  return persistenceStep(
    () => persistence.claim(receipt),
    operation,
    "claim",
  )
}

function acknowledgeReadOnlyReceipt<Requirements>(
  receipt: TikTokPublishReceipt,
  persistence: SocialPublishPersistence<TikTokPublishReceipt, Requirements>,
  operation: string,
): Effect.Effect<TikTokPublishReceipt, SocialPublishPersistenceError, Requirements> {
  return persistenceStep(
    () => persistence.acknowledge(receipt),
    operation,
    "acknowledge",
  ).pipe(Effect.as(receipt))
}

function persistenceStep<Requirements>(
  effect: () => Effect.Effect<void, unknown, Requirements>,
  operation: string,
  stage: "claim" | "acknowledge",
): Effect.Effect<void, SocialPublishPersistenceError, Requirements> {
  const failure = () => new SocialPublishPersistenceError({ provider, operation, stage })
  return Effect.suspend(effect).pipe(
    Effect.timeoutFail({
      duration: persistenceTimeoutMilliseconds,
      onTimeout: failure,
    }),
    Effect.catchAllCause(() => Effect.fail(failure())),
  )
}

function tiktokRequest(
  configuration: ResolvedConfiguration,
  operation: string,
  request: Parameters<SocialHttpClient["request"]>[0],
  category: "authorization" | "publish",
): Effect.Effect<Record<string, unknown>, SocialIntegrationFailure> {
  return executeSocialHttpRequest(configuration.httpClient, request).pipe(
    Effect.flatMap((response) => {
      if (operation === "publish" && (response.status === 429 || response.status >= 500)) {
        return earlyPublishStatusFailure(operation, response)
      }
      if (response.status === 429) {
        return Effect.fail(new SocialRateLimitError({
          provider,
          operation,
          retryAfterSeconds: headerSeconds(response.headers["retry-after"]),
        }))
      }
      if (response.status >= 500) {
        return Effect.fail(new SocialProviderUnavailableError({ provider, operation }))
      }
      return (
      parseProviderJson(provider, operation, response).pipe(
        Effect.flatMap((body) => {
          const failure = tiktokHttpFailure(operation, response, body, category)
          return failure ? Effect.fail(failure) : Effect.succeed(body)
        }),
      ))
    }),
  )
}

function earlyPublishStatusFailure(
  operation: string,
  response: SocialHttpResponse,
): Effect.Effect<never, SocialIntegrationFailure> {
  return parseProviderJson(provider, operation, response).pipe(
    Effect.map(candidatePublishId),
    Effect.catchAll(() => Effect.succeed<string | null>(null)),
    Effect.flatMap((providerReference): Effect.Effect<never, SocialIntegrationFailure> => {
      if (providerReference !== null) {
        return Effect.fail(new SocialPublishUncertainError({
          provider,
          operation,
          providerReference,
        }))
      }
      if (response.status === 429) {
        return Effect.fail(new SocialRateLimitError({
          provider,
          operation,
          retryAfterSeconds: headerSeconds(response.headers["retry-after"]),
        }))
      }
      return Effect.fail(new SocialProviderUnavailableError({ provider, operation }))
    }),
  )
}

function tiktokRevokeCredential(
  configuration: ResolvedConfiguration,
  credential: TikTokCredential,
): Effect.Effect<void, SocialIntegrationFailure> {
  const operation = "credential revocation"
  return executeSocialHttpRequest(configuration.httpClient, {
    provider,
    operation,
    method: "POST",
    url: `${apiBase}/v2/oauth/revoke/`,
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: configuration.clientKey,
      client_secret: configuration.clientSecret,
      token: credential.accessToken,
    }).toString(),
  }).pipe(
    Effect.flatMap((response) => {
      if (response.status >= 200 && response.status < 300 && response.body.trim() === "") {
        return Effect.void
      }
      if (response.status === 429) {
        return Effect.fail(new SocialRateLimitError({
          provider,
          operation,
          retryAfterSeconds: headerSeconds(response.headers["retry-after"]),
        }))
      }
      if (response.status >= 500) {
        return Effect.fail(new SocialProviderUnavailableError({ provider, operation }))
      }
      return parseProviderJson(provider, operation, response).pipe(
        Effect.flatMap((body) => {
          const failure = tiktokHttpFailure(operation, response, body, "authorization")
          return failure === null ? Effect.void : Effect.fail(failure)
        }),
      )
    }),
  )
}

function tiktokHttpFailure(
  operation: string,
  response: SocialHttpResponse,
  body: Record<string, unknown>,
  category: "authorization" | "publish",
): SocialIntegrationFailure | null {
  const errorCode = providerErrorCode(body)
  const requiresSuccessEnvelope = operation !== "code exchange" && operation !== "token refresh"
  if (
    response.status >= 200 &&
    response.status < 300 &&
    requiresSuccessEnvelope &&
    errorCode === null
  ) {
    const providerReference = operation === "publish" ? candidatePublishId(body) : null
    return new InvalidSocialProviderResponseError({
      provider,
      operation,
      ...(providerReference === null ? {} : { providerReference }),
    })
  }
  if (
    response.status >= 200 &&
    response.status < 300 &&
    (requiresSuccessEnvelope ? errorCode === "ok" : errorCode === null || errorCode === "ok")
  ) {
    return null
  }
  const candidate = operation === "publish" ? candidatePublishId(body) : null
  if (candidate !== null) {
    return new SocialPublishUncertainError({
      provider,
      operation,
      providerReference: candidate,
    })
  }
  const reason = providerErrorMessage(body)
  if (response.status === 429 || errorCode === "rate_limit_exceeded") {
    return new SocialRateLimitError({
      provider,
      operation,
      retryAfterSeconds: headerSeconds(response.headers["retry-after"]),
    })
  }
  if (response.status >= 500 || errorCode === "internal_error" || errorCode === "internal") {
    return new SocialProviderUnavailableError({ provider, operation })
  }
  if (
    response.status === 401 ||
    response.status === 403 ||
    ["access_token_invalid", "scope_not_authorized", "scope_permission_missed", "auth_removed"].includes(errorCode ?? "") ||
    category === "authorization"
  ) {
    return new SocialAuthorizationError({
      provider,
      reason,
      providerCode: errorCode,
      reauthorize:
        response.status === 401 ||
        response.status === 403 ||
        ["invalid_grant", "access_token_invalid", "auth_removed"].includes(errorCode ?? ""),
      grantInactive: errorCode === "auth_removed",
    })
  }
  return new SocialPublishRejectedError({
    provider,
    reason,
    providerCode: errorCode ?? providerErrorCode(body),
  })
}

function candidatePublishId(body: Record<string, unknown>): string | null {
  try {
    return identifier(record(body.data).publish_id, "TikTok publish ID", 64)
  } catch {
    return null
  }
}

function tiktokPublishRequest(
  configuration: ResolvedConfiguration,
  input: TikTokPublishRequest,
): TikTokPublishRequest {
  if (!input || typeof input !== "object") throw new TypeError("post is invalid")
  const common = {
    privacyLevel: tiktokPrivacyLevel(input.privacyLevel),
    disableComment: booleanValue(input.disableComment, "comment state"),
    brandedContent: booleanValue(input.brandedContent, "branded content"),
    ownBrandContent: booleanValue(input.ownBrandContent, "own-brand content"),
    userConsent: explicitConsent(input.userConsent),
  }
  if (input.kind === "video") {
    const durationSeconds = positiveDuration(input.durationSeconds, "video duration", 600)
    const coverTimestampMs = input.coverTimestampMs === undefined
      ? undefined
      : nonNegativeInteger(input.coverTimestampMs, "cover timestamp", 600_000)
    if (coverTimestampMs !== undefined && coverTimestampMs > durationSeconds * 1_000) {
      throw new TypeError("cover timestamp exceeds the video duration")
    }
    return Object.freeze({
      kind: "video",
      ...common,
      title: postText(input.title, "video title", 2_200, true),
      durationSeconds,
      url: verifiedMediaUrl(input.url, configuration.verifiedMediaUrlPrefixes),
      disableDuet: booleanValue(input.disableDuet, "duet state"),
      disableStitch: booleanValue(input.disableStitch, "stitch state"),
      ...(coverTimestampMs === undefined ? {} : { coverTimestampMs }),
      isAiGenerated: booleanValue(input.isAiGenerated, "AI disclosure"),
    } satisfies TikTokVideoPublishRequest)
  }
  if (input.kind === "photos") {
    if (!Array.isArray(input.urls) || input.urls.length === 0 || input.urls.length > maximumPhotoItems) {
      throw new TypeError("photos must contain between 1 and 35 URLs")
    }
    const urls = Object.freeze(input.urls.map((url) =>
      verifiedMediaUrl(url, configuration.verifiedMediaUrlPrefixes),
    ))
    const coverIndex = nonNegativeInteger(input.coverIndex, "photo cover index", urls.length - 1)
    return Object.freeze({
      kind: "photos",
      ...common,
      ...(input.title === undefined ? {} : { title: postText(input.title, "photo title", 90, false) }),
      ...(input.description === undefined
        ? {}
        : { description: postText(input.description, "photo description", 4_000, false) }),
      urls,
      coverIndex,
      ...optionalBoolean(input.autoAddMusic, "automatic music", "autoAddMusic"),
      isAiGenerated: booleanValue(input.isAiGenerated, "AI disclosure"),
    } satisfies TikTokPhotoPublishRequest)
  }
  throw new TypeError("post media type is invalid")
}

function tiktokCredentialFromToken(input: Record<string, unknown>): TikTokCredential {
  bearerTokenType(input.token_type)
  const grantedScopes = scopes(input.scope)
  requireScopes(grantedScopes)
  return Object.freeze({
    provider,
    accessToken: secret(input.access_token, "access token"),
    refreshToken: secret(input.refresh_token, "refresh token"),
    expiresInSeconds: positiveDuration(input.expires_in, "token lifetime", 172_800),
    refreshExpiresInSeconds: positiveDuration(
      input.refresh_expires_in,
      "refresh token lifetime",
      63_072_000,
    ),
    scopes: grantedScopes,
    accountId: identifier(input.open_id, "TikTok account ID"),
  })
}

function tiktokCredential(input: TikTokCredential): TikTokCredential {
  if (!input || input.provider !== provider || input.refreshToken === null || input.refreshExpiresInSeconds === null) {
    throw new TypeError("TikTok credential is invalid")
  }
  const grantedScopes = scopes(input.scopes)
  requireScopes(grantedScopes)
  return Object.freeze({
    provider,
    accessToken: secret(input.accessToken, "access token"),
    refreshToken: secret(input.refreshToken, "refresh token"),
    expiresInSeconds: positiveDuration(input.expiresInSeconds, "token lifetime", 172_800),
    refreshExpiresInSeconds: positiveDuration(
      input.refreshExpiresInSeconds,
      "refresh token lifetime",
      63_072_000,
    ),
    scopes: grantedScopes,
    accountId: identifier(input.accountId, "TikTok account ID"),
  })
}

function requireScopes(input: readonly string[]): void {
  for (const required of requiredScopes) {
    if (!input.includes(required)) throw new TypeError(`scope ${required} is required`)
  }
}

function tiktokReceipt(input: TikTokPublishReceipt): TikTokPublishReceipt {
  if (!input || input.provider !== provider || !["processing", "published", "failed"].includes(input.phase)) {
    throw new TypeError("TikTok publish receipt is invalid")
  }
  if (!Array.isArray(input.postIds)) throw new TypeError("TikTok publish receipt is invalid")
  const common = {
    provider,
    accountId: identifier(input.accountId, "TikTok account ID"),
    publishId: identifier(input.publishId, "TikTok publish ID", 64),
  }
  if (input.phase === "processing") {
    if (input.postIds.length !== 0 || input.failureReason !== null) {
      throw new TypeError("TikTok processing receipt is invalid")
    }
    return Object.freeze({
      ...common,
      phase: "processing",
      postIds: Object.freeze([] as const),
      failureReason: null,
    })
  }
  if (input.phase === "published") {
    if (input.failureReason !== null) throw new TypeError("TikTok published receipt is invalid")
    return Object.freeze({
      ...common,
      phase: "published",
      postIds: Object.freeze(input.postIds.map(tiktokPostId)),
      failureReason: null,
    })
  }
  if (input.postIds.length !== 0 || input.failureReason === null) {
    throw new TypeError("TikTok failed receipt is invalid")
  }
  return Object.freeze({
    ...common,
    phase: "failed",
    postIds: Object.freeze([] as const),
    failureReason: boundedString(input.failureReason, "TikTok failure reason", 512),
  })
}

function tiktokPostId(input: unknown): string {
  if (typeof input === "string" && /^\d+$/.test(input)) {
    return identifier(input, "TikTok post ID")
  }
  if (typeof input === "number" && Number.isSafeInteger(input) && input >= 0) {
    return identifier(String(input), "TikTok post ID")
  }
  throw new TypeError("TikTok post ID is invalid")
}

function resolveConfiguration(input: TikTokProviderConfiguration): ResolvedConfiguration {
  const clientKey = identifier(input.clientKey, "TikTok client key", 256)
  const clientSecret = secret(input.clientSecret, "TikTok client secret")
  if (!Array.isArray(input.verifiedMediaUrlPrefixes) || input.verifiedMediaUrlPrefixes.length === 0) {
    throw new TypeError("at least one verified media URL prefix is required")
  }
  const verifiedMediaUrlPrefixes = Object.freeze([
    ...new Set(input.verifiedMediaUrlPrefixes.map(verifiedMediaUrlPrefix)),
  ])
  const configuredScopes = input.scopes === undefined ? [...requiredScopes] : scopes(input.scopes)
  for (const required of requiredScopes) {
    if (!configuredScopes.includes(required)) throw new TypeError(`scope ${required} is required`)
  }
  const httpClient = input.httpClient ?? createFetchSocialHttpClient()
  if (!httpClient || typeof httpClient.request !== "function") throw new TypeError("HTTP client is invalid")
  return Object.freeze({
    clientKey,
    clientSecret,
    verifiedMediaUrlPrefixes,
    scopes: Object.freeze([...configuredScopes]),
    httpClient,
  })
}

function verifiedMediaUrl(input: unknown, prefixes: readonly string[]): string {
  const value = publicMediaUrl(input)
  const target = new URL(value)
  if (hasAmbiguousEncodedPath(target.pathname)) {
    throw new TypeError("media URL contains an ambiguous encoded path")
  }
  if (!prefixes.some((prefix) => {
    const expected = new URL(prefix)
    return target.origin === expected.origin && target.pathname.startsWith(expected.pathname)
  })) {
    throw new TypeError("media URL is outside the TikTok-verified URL prefixes")
  }
  return value
}

function verifiedMediaUrlPrefix(input: unknown): string {
  const value = publicMediaUrl(input)
  const url = new URL(value)
  if (
    url.search ||
    !url.pathname.endsWith("/") ||
    !url.hostname.includes(".") ||
    /^\d+(?:\.\d+){3}$/.test(url.hostname) ||
    url.hostname.includes(":") ||
    hasAmbiguousEncodedPath(url.pathname)
  ) {
    throw new TypeError("verified media URL prefix must be an HTTPS directory URL")
  }
  return url.toString()
}

function hasAmbiguousEncodedPath(pathname: string): boolean {
  return /%(?:25|2e|2f|5c)/i.test(pathname)
}

function tiktokRedirectUri(input: unknown): string {
  const value = redirectUri(input)
  const url = new URL(value)
  if (url.protocol !== "https:" || url.search || value.length >= 512) {
    throw new TypeError("TikTok redirect URI must be static HTTPS and shorter than 512 characters")
  }
  return value
}

function tiktokPrivacyLevel(input: unknown): TikTokPrivacyLevel {
  if (!tiktokPrivacyLevels.some((value) => value === input)) {
    throw new TypeError("TikTok privacy level is invalid")
  }
  return input as TikTokPrivacyLevel
}

function authorizationHeaders(accessToken: string) {
  return Object.freeze({
    authorization: `Bearer ${accessToken}`,
    "content-type": "application/json; charset=UTF-8",
  })
}

function optionalHttpsUrl(input: unknown): string | null {
  if (typeof input !== "string" || input.length === 0) return null
  try {
    return publicMediaUrl(input)
  } catch {
    return null
  }
}

function optionalBoolean(
  input: unknown,
  name: string,
  key: string,
): Record<string, boolean> {
  if (input === undefined) return {}
  return { [key]: booleanValue(input, name) }
}

function explicitConsent(input: unknown): true {
  if (input !== true) throw new TypeError("explicit user consent is required")
  return true
}

function booleanValue(input: unknown, name: string): boolean {
  if (typeof input !== "boolean") throw new TypeError(`${name} is invalid`)
  return input
}

function positiveDuration(input: unknown, name: string, maximum: number): number {
  if (!Number.isSafeInteger(input) || (input as number) <= 0 || (input as number) > maximum) {
    throw new TypeError(`${name} is invalid`)
  }
  return input as number
}

function headerSeconds(input: string | undefined): number | null {
  if (input === undefined || !/^\d+$/.test(input)) return null
  const value = Number(input)
  return Number.isSafeInteger(value) && value >= 0 ? value : null
}
