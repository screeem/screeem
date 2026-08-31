import { Effect, Fiber } from "effect"

import {
  InvalidSocialConfigurationError,
  InvalidSocialProviderResponseError,
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
import type {
  InstagramAccountProfile,
  InstagramCredential,
  InstagramMedia,
  InstagramProviderDescription,
  InstagramPublishReceipt,
  InstagramPublishRequest,
} from "./model.js"

const provider = "instagram" as const
const defaultApiVersion = "v25.0"
const requiredScopes = [
  "instagram_business_basic",
  "instagram_business_content_publish",
] as const
const maximumCarouselItems = 10
const persistenceTimeoutMilliseconds = 5_000

export interface InstagramProviderConfiguration {
  readonly clientId: string
  readonly clientSecret: string
  readonly apiVersion?: string
  readonly scopes?: readonly string[]
  readonly httpClient?: SocialHttpClient
}

export interface InstagramProvider extends SocialProvider<
  InstagramCredential,
  InstagramPublishRequest,
  InstagramPublishReceipt
> {
  getAccount(
    credential: InstagramCredential,
  ): Effect.Effect<InstagramAccountProfile, SocialIntegrationFailure>
  describe(): InstagramProviderDescription
}

interface ResolvedConfiguration {
  readonly clientId: string
  readonly clientSecret: string
  readonly apiVersion: string
  readonly scopes: readonly string[]
  readonly httpClient: SocialHttpClient
}

export function createInstagramProvider(
  configuration: InstagramProviderConfiguration,
): SocialProviderConstruction<InstagramProvider> {
  return Effect.suspend(() => {
    try {
      return Effect.succeed(makeInstagramProvider(resolveConfiguration(configuration)))
    } catch (error) {
      return Effect.fail(
        new InvalidSocialConfigurationError({
          provider,
          reason: error instanceof Error ? error.message : "invalid configuration",
        }),
      )
    }
  })
}

function makeInstagramProvider(configuration: ResolvedConfiguration): InstagramProvider {
  const graphBase = `https://graph.instagram.com/${configuration.apiVersion}`

  const api: InstagramProvider = {
    authorizationUrl: (input) =>
      validated(provider, "authorization", () => authorization(configuration, input)),

    exchangeCode: (input) =>
      validated(provider, "code exchange", () => oauthCallback(input)).pipe(
        Effect.flatMap(({ code, redirectUri: safeRedirectUri }) =>
          instagramRequest(
            configuration,
            "code exchange",
            {
              provider,
              operation: "code exchange",
              method: "POST",
              url: "https://api.instagram.com/oauth/access_token",
              headers: { "content-type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({
                client_id: configuration.clientId,
                client_secret: configuration.clientSecret,
                grant_type: "authorization_code",
                redirect_uri: safeRedirectUri,
                code,
              }).toString(),
            },
            "authorization",
          ),
        ),
        Effect.flatMap((shortResponse) =>
          decoded(provider, "code exchange", () => {
            const short = instagramTokenEntry(shortResponse)
            return {
              short,
              accessToken: secret(short.access_token, "access token"),
            }
          }),
        ),
        Effect.flatMap(({ short, accessToken }) =>
          instagramRequest(
            configuration,
            "long-lived token exchange",
            {
              provider,
              operation: "long-lived token exchange",
              method: "GET",
              url: withQuery("https://graph.instagram.com/access_token", {
                grant_type: "ig_exchange_token",
                client_secret: configuration.clientSecret,
                access_token: accessToken,
              }),
            },
            "authorization",
          ).pipe(Effect.map((longResponse) => ({ short, longResponse }))),
        ),
        Effect.flatMap(({ short, longResponse }) =>
          decoded(provider, "long-lived token exchange", () => {
            bearerTokenType(longResponse.token_type)
            const accessToken = secret(longResponse.access_token, "access token")
            const expiresInSeconds = positiveDuration(longResponse.expires_in, "token lifetime")
            const grantedScopes = scopes(short.permissions)
            requireScopes(grantedScopes)
            return {
              accessToken,
              expiresInSeconds,
              scopes: grantedScopes,
            }
          }),
        ),
        Effect.flatMap((token) =>
          account(configuration, graphBase, token.accessToken, null).pipe(
            Effect.map((profile) => ({ token, profile })),
          ),
        ),
        Effect.map(({ token, profile }): ConnectedSocialAccount<InstagramCredential> =>
          Object.freeze({
            credential: Object.freeze({
              provider,
              accessToken: token.accessToken,
              refreshToken: null,
              expiresInSeconds: token.expiresInSeconds,
              refreshExpiresInSeconds: null,
              scopes: token.scopes,
              accountId: profile.id,
            }),
            account: profile,
          }),
        ),
      ),

    refreshCredential: (input) =>
      validated(provider, "token refresh", () => instagramCredential(input)).pipe(
        Effect.flatMap((credential) =>
          instagramRequest(
            configuration,
            "token refresh",
            {
              provider,
              operation: "token refresh",
              method: "GET",
              url: withQuery("https://graph.instagram.com/refresh_access_token", {
                grant_type: "ig_refresh_token",
                access_token: credential.accessToken,
              }),
            },
            "authorization",
          ).pipe(Effect.map((response) => ({ credential, response }))),
        ),
        Effect.flatMap(({ credential, response }) =>
          decoded(provider, "token refresh", () =>
            {
              bearerTokenType(response.token_type)
              return Object.freeze({
                ...credential,
                accessToken: secret(response.access_token, "access token"),
                expiresInSeconds: positiveDuration(response.expires_in, "token lifetime"),
              })
            },
          ),
        ),
        Effect.flatMap((credential) =>
          account(configuration, graphBase, credential.accessToken, credential.accountId).pipe(
            Effect.as(credential),
          ),
        ),
      ),

    revokeCredential: (input) => Effect.uninterruptible(
      validated(provider, "credential revocation", () => instagramCredential(input)).pipe(
        Effect.flatMap((credential) =>
          account(configuration, graphBase, credential.accessToken, credential.accountId).pipe(
            Effect.zipRight(instagramRequest(
              configuration,
              "credential revocation",
              {
                provider,
                operation: "credential revocation",
                method: "DELETE",
                url: `${graphBase}/${encodeURIComponent(credential.accountId)}/permissions`,
                headers: authorizationHeaders(credential.accessToken),
              },
              "authorization",
            )),
          ),
        ),
        Effect.flatMap((response) =>
          decoded(provider, "credential revocation", () => {
            if (response.success !== true) throw new TypeError("Instagram revocation was not confirmed")
          }),
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
      validated(provider, "account lookup", () => instagramCredential(input)).pipe(
        Effect.flatMap((credential) =>
          account(configuration, graphBase, credential.accessToken, credential.accountId),
        ),
      ),

    publish: (credentialInput, requestInput, persistence) =>
      validated(provider, "publish", () => ({
        credential: instagramCredential(credentialInput),
        request: instagramPublishRequest(requestInput),
      })).pipe(
        Effect.flatMap(({ credential, request }) =>
          claimPublish(persistence, null, "publish").pipe(
            Effect.zipRight(account(
              configuration,
              graphBase,
              credential.accessToken,
              credential.accountId,
            )),
            Effect.zipRight(commitNonIdempotentMutation(
              "create media container",
              createMediaContainer(
                configuration,
                graphBase,
                credential,
                request,
                request.media[0]!,
              ).pipe(
                Effect.map((containerId): InstagramPublishReceipt => Object.freeze({
                  provider,
                  accountId: credential.accountId,
                  phase: "processing",
                  media: request.media,
                  nextMediaIndex: 1,
                  childContainerIds: Object.freeze([containerId]),
                  containerId: request.media.length === 1 ? containerId : null,
                  mediaId: null,
                  caption: request.caption,
                  isAiGenerated: request.isAiGenerated ?? null,
                  failureReason: null,
                })),
              ),
              persistence,
            )),
          ),
        ),
      ),

    advancePublish: (credentialInput, receiptInput, persistence) =>
      validated(provider, "publish status", () => ({
        credential: instagramCredential(credentialInput),
        receipt: instagramReceipt(receiptInput),
      })).pipe(
        Effect.flatMap(({ credential, receipt }) => {
          if (credential.accountId !== receipt.accountId) {
            return validated(provider, "publish status", () => {
              throw new TypeError("receipt account does not match the credential")
            })
          }
          if (receipt.phase !== "processing") return Effect.succeed(receipt)
          return claimPublish(persistence, receipt, "publish advancement").pipe(
            Effect.zipRight(account(
              configuration,
              graphBase,
              credential.accessToken,
              credential.accountId,
            )),
            Effect.zipRight(
              receipt.nextMediaIndex < receipt.media.length
                ? createNextMediaContainer(
                    configuration,
                    graphBase,
                    credential,
                    receipt,
                    persistence,
                  )
                : continueInstagramPublish(
                    configuration,
                    graphBase,
                    credential,
                    receipt,
                    persistence,
                  ),
            ),
          )
        }),
      ),

    describe: () =>
      Object.freeze({
        provider,
        scopes: configuration.scopes,
        media: Object.freeze(["image", "video"] as const),
        apiVersion: configuration.apiVersion,
        maximumCarouselItems,
      }),
  }
  return Object.freeze(api)
}

function authorization(
  configuration: ResolvedConfiguration,
  input: SocialAuthorizationRequest,
): SocialAuthorization {
  const state = oauthState(input.state)
  const url = new URL("https://www.instagram.com/oauth/authorize")
  url.searchParams.set("client_id", configuration.clientId)
  url.searchParams.set("redirect_uri", redirectUri(input.redirectUri))
  url.searchParams.set("response_type", "code")
  url.searchParams.set("scope", configuration.scopes.join(","))
  url.searchParams.set("state", state)
  url.searchParams.set("enable_fb_login", "0")
  if (input.forceReauthorization === true) url.searchParams.set("force_reauth", "1")
  return Object.freeze({ provider, url: url.toString(), state, scopes: configuration.scopes })
}

function account(
  configuration: ResolvedConfiguration,
  graphBase: string,
  accessToken: string,
  expectedAccountId: string | null,
): Effect.Effect<InstagramAccountProfile, SocialIntegrationFailure> {
  return instagramRequest(
    configuration,
    "account lookup",
    {
      provider,
      operation: "account lookup",
      method: "GET",
      url: withQuery(`${graphBase}/me`, {
        fields: "user_id,id,username,name,profile_picture_url",
      }),
      headers: authorizationHeaders(accessToken),
    },
    "authorization",
  ).pipe(
    Effect.flatMap((response) =>
      decoded(provider, "account lookup", () => {
        const entry = instagramAccountEntry(response)
        const id = identifier(entry.user_id ?? entry.id, "Instagram account ID")
        if (expectedAccountId !== null && id !== expectedAccountId) {
          throw new TypeError("Instagram account does not match token")
        }
        const username = boundedString(entry.username, "Instagram username", 160)
        const name = typeof entry.name === "string" && entry.name.length > 0
          ? boundedString(entry.name, "Instagram display name", 160)
          : username
        return Object.freeze({
          provider,
          id,
          username,
          displayName: name,
          pictureUrl: optionalHttpsUrl(entry.profile_picture_url),
        })
      }),
    ),
  )
}

function createMediaContainer(
  configuration: ResolvedConfiguration,
  graphBase: string,
  credential: InstagramCredential,
  request: InstagramPublishRequest,
  media: InstagramMedia,
): Effect.Effect<string, SocialIntegrationFailure> {
  const carousel = request.media.length > 1
  const body: Record<string, unknown> = {
    ...(media.kind === "image"
      ? {
          image_url: media.url,
          ...(media.altText ? { alt_text: media.altText } : {}),
        }
      : {
          video_url: media.url,
          media_type: carousel ? "VIDEO" : "REELS",
          ...(media.coverTimestampMs === undefined ? {} : { thumb_offset: media.coverTimestampMs }),
        }),
    ...(carousel ? { is_carousel_item: true } : { caption: request.caption }),
    ...(carousel || request.isAiGenerated === undefined
      ? {}
      : { is_ai_generated: request.isAiGenerated }),
  }
  return instagramRequest(
    configuration,
    "create media container",
    {
      provider,
      operation: "create media container",
      method: "POST",
      url: `${graphBase}/${encodeURIComponent(credential.accountId)}/media`,
      headers: authorizationHeaders(credential.accessToken),
      body: JSON.stringify(body),
    },
    "publish",
  ).pipe(
    Effect.flatMap((response) =>
      decoded(provider, "create media container", () =>
        identifier(response.id, "Instagram media container ID"),
      ),
    ),
  )
}

function createNextMediaContainer<Requirements>(
  configuration: ResolvedConfiguration,
  graphBase: string,
  credential: InstagramCredential,
  receipt: Extract<InstagramPublishReceipt, { readonly phase: "processing" }>,
  persistence: SocialPublishPersistence<InstagramPublishReceipt, Requirements>,
): Effect.Effect<InstagramPublishReceipt, SocialIntegrationFailure, Requirements> {
  const media = receipt.media[receipt.nextMediaIndex]!
  const request: InstagramPublishRequest = Object.freeze({
    caption: receipt.caption,
    media: receipt.media,
    ...(receipt.isAiGenerated === null ? {} : { isAiGenerated: receipt.isAiGenerated }),
  })
  return commitNonIdempotentMutation(
    "create media container",
    createMediaContainer(configuration, graphBase, credential, request, media).pipe(
      Effect.map((containerId): InstagramPublishReceipt => Object.freeze({
        ...receipt,
        nextMediaIndex: receipt.nextMediaIndex + 1,
        childContainerIds: Object.freeze([...receipt.childContainerIds, containerId]),
      })),
    ),
    persistence,
  )
}

function continueInstagramPublish<Requirements>(
  configuration: ResolvedConfiguration,
  graphBase: string,
  credential: InstagramCredential,
  receipt: Extract<InstagramPublishReceipt, { readonly phase: "processing" }>,
  persistence: SocialPublishPersistence<InstagramPublishReceipt, Requirements>,
): Effect.Effect<InstagramPublishReceipt, SocialIntegrationFailure, Requirements> {
  const ids = receipt.containerId === null ? receipt.childContainerIds : [receipt.containerId]
  return Effect.forEach(
    ids,
    (containerId) => containerStatus(configuration, graphBase, credential, containerId),
    { concurrency: 1 },
  ).pipe(
    Effect.flatMap((statuses) => {
      const failure = statuses.find((status) => status.code === "ERROR" || status.code === "EXPIRED")
      if (failure) {
        return acknowledgeReadOnlyReceipt(Object.freeze({
          ...receipt,
          phase: "failed" as const,
          failureReason: failure.reason ?? failure.code,
        }), persistence, "publish status")
      }
      if (statuses.some((status) => status.code === "IN_PROGRESS")) {
        return Effect.succeed(receipt)
      }
      if (
        receipt.containerId !== null &&
        statuses.every((status) => status.code === "PUBLISHED")
      ) {
        return acknowledgeReadOnlyReceipt(Object.freeze({
          ...receipt,
          phase: "published" as const,
          // A creation-container ID is not the published media ID. This path
          // recovers a publish whose response was lost, so the media ID is unknown.
          mediaId: receipt.mediaId,
        }), persistence, "publish status")
      }
      if (!statuses.every((status) => status.code === "FINISHED" || status.code === "PUBLISHED")) {
        return Effect.fail(new InvalidSocialProviderResponseError({
          provider,
          operation: "publish status",
        }))
      }
      if (receipt.containerId === null) {
        return createCarouselContainer(
          configuration,
          graphBase,
          credential,
          receipt,
          persistence,
        )
      }
      return publishContainer(configuration, graphBase, credential, receipt, persistence)
    }),
  )
}

function containerStatus(
  configuration: ResolvedConfiguration,
  graphBase: string,
  credential: InstagramCredential,
  containerId: string,
) {
  return instagramRequest(
    configuration,
    "publish status",
    {
      provider,
      operation: "publish status",
      method: "GET",
      url: withQuery(`${graphBase}/${encodeURIComponent(containerId)}`, {
        fields: "status_code,status",
      }),
      headers: authorizationHeaders(credential.accessToken),
    },
    "publish",
  ).pipe(
    Effect.flatMap((response) =>
      decoded(provider, "publish status", () => {
        const code = boundedString(response.status_code, "container status", 32)
        if (!["EXPIRED", "ERROR", "FINISHED", "IN_PROGRESS", "PUBLISHED"].includes(code)) {
          throw new TypeError("container status is invalid")
        }
        return Object.freeze({
          code: code as "EXPIRED" | "ERROR" | "FINISHED" | "IN_PROGRESS" | "PUBLISHED",
          reason: optionalProviderText(response.status),
        })
      }),
    ),
  )
}

function createCarouselContainer<Requirements>(
  configuration: ResolvedConfiguration,
  graphBase: string,
  credential: InstagramCredential,
  receipt: Extract<InstagramPublishReceipt, { readonly phase: "processing" }>,
  persistence: SocialPublishPersistence<InstagramPublishReceipt, Requirements>,
): Effect.Effect<InstagramPublishReceipt, SocialIntegrationFailure, Requirements> {
  return commitNonIdempotentMutation(
    "create carousel container",
    instagramRequest(
      configuration,
      "create carousel container",
      {
        provider,
        operation: "create carousel container",
        method: "POST",
        url: `${graphBase}/${encodeURIComponent(credential.accountId)}/media`,
        headers: authorizationHeaders(credential.accessToken),
        body: JSON.stringify({
          media_type: "CAROUSEL",
          children: receipt.childContainerIds.join(","),
          caption: receipt.caption,
          ...(receipt.isAiGenerated === null ? {} : { is_ai_generated: receipt.isAiGenerated }),
        }),
      },
      "publish",
    ).pipe(
      Effect.flatMap((response) =>
        decoded(provider, "create carousel container", () =>
          identifier(response.id, "Instagram carousel container ID"),
        ),
      ),
      Effect.map((containerId) => Object.freeze({ ...receipt, containerId })),
    ),
    persistence,
  )
}

function publishContainer<Requirements>(
  configuration: ResolvedConfiguration,
  graphBase: string,
  credential: InstagramCredential,
  receipt: Extract<InstagramPublishReceipt, { readonly phase: "processing" }>,
  persistence: SocialPublishPersistence<InstagramPublishReceipt, Requirements>,
): Effect.Effect<InstagramPublishReceipt, SocialIntegrationFailure, Requirements> {
  return commitNonIdempotentMutation(
    "publish media container",
    instagramRequest(
      configuration,
      "publish media container",
      {
        provider,
        operation: "publish media container",
        method: "POST",
        url: `${graphBase}/${encodeURIComponent(credential.accountId)}/media_publish`,
        headers: authorizationHeaders(credential.accessToken),
        body: JSON.stringify({ creation_id: receipt.containerId }),
      },
      "publish",
    ).pipe(
      Effect.flatMap((response) =>
        decoded(provider, "publish media container", () =>
          identifier(response.id, "Instagram media ID"),
        ),
      ),
      Effect.map((mediaId) => Object.freeze({
        ...receipt,
        phase: "published" as const,
        mediaId,
        failureReason: null,
      })),
    ),
    persistence,
  )
}

function commitNonIdempotentMutation<Requirements>(
  operation: string,
  effect: Effect.Effect<InstagramPublishReceipt, SocialIntegrationFailure>,
  persistence: SocialPublishPersistence<InstagramPublishReceipt, Requirements>,
): Effect.Effect<InstagramPublishReceipt, SocialIntegrationFailure, Requirements> {
  return Effect.uninterruptibleMask((restore) =>
    effect.pipe(
      Effect.catchTags({
        InvalidSocialProviderResponseError: () => Effect.fail(
          new SocialPublishUncertainError({ provider, operation, providerReference: null }),
        ),
        SocialProviderUnavailableError: () => Effect.fail(
          new SocialPublishUncertainError({ provider, operation, providerReference: null }),
        ),
      }),
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
  receipt: InstagramPublishReceipt,
  persistence: SocialPublishPersistence<InstagramPublishReceipt, Requirements>,
  operation: string,
  restore: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>,
): Effect.Effect<InstagramPublishReceipt, SocialPublishUncertainError, Requirements> {
  const providerReference = receipt.mediaId ?? receipt.containerId ??
    receipt.childContainerIds.at(-1) ?? null
  const failure = () => new SocialPublishUncertainError({
    provider,
    operation: `${operation} acknowledgement`,
    providerReference,
  })
  const acknowledgement = Effect.suspend(() => persistence.acknowledge(receipt)).pipe(
    Effect.catchAllCause(() => Effect.fail(new SocialPublishUncertainError({
      provider,
      operation: `${operation} acknowledgement`,
      providerReference,
    }))),
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
  receipt: InstagramPublishReceipt,
  persistence: SocialPublishPersistence<InstagramPublishReceipt, Requirements>,
  operation: string,
): Effect.Effect<InstagramPublishReceipt, SocialPublishPersistenceError, Requirements> {
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

function instagramRequest(
  configuration: ResolvedConfiguration,
  operation: string,
  request: Parameters<SocialHttpClient["request"]>[0],
  category: "authorization" | "publish",
): Effect.Effect<Record<string, unknown>, SocialIntegrationFailure> {
  return executeSocialHttpRequest(configuration.httpClient, request).pipe(
    Effect.flatMap((response) => {
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
          const failure = instagramHttpFailure(operation, response, body, category)
          return failure ? Effect.fail(failure) : Effect.succeed(body)
        }),
      )
    }),
  )
}

function instagramHttpFailure(
  operation: string,
  response: SocialHttpResponse,
  body: Record<string, unknown>,
  category: "authorization" | "publish",
): SocialIntegrationFailure | null {
  const nested = typeof body.error === "object" && body.error !== null
    ? body.error as Record<string, unknown>
    : null
  if (response.status >= 200 && response.status < 300 && !nested) return null
  const code = providerErrorCode(body)
  if (response.status === 429 || ["4", "17", "32", "613"].includes(code ?? "")) {
    return new SocialRateLimitError({
      provider,
      operation,
      retryAfterSeconds: headerSeconds(response.headers["retry-after"]),
    })
  }
  if (response.status >= 500) return new SocialProviderUnavailableError({ provider, operation })
  if (response.status === 401 || response.status === 403 || code === "190" || category === "authorization") {
    return new SocialAuthorizationError({
      provider,
      reason: providerErrorMessage(body),
      providerCode: code,
      reauthorize: response.status === 401 || response.status === 403 || code === "190",
      grantInactive: false,
    })
  }
  return new SocialPublishRejectedError({
    provider,
    reason: providerErrorMessage(body),
    providerCode: code,
  })
}

function instagramPublishRequest(input: InstagramPublishRequest): InstagramPublishRequest {
  const caption = postText(input.caption, "caption", 2_200, true)
  if (!Array.isArray(input.media) || input.media.length === 0 || input.media.length > maximumCarouselItems) {
    throw new TypeError("media must contain between 1 and 10 items")
  }
  if (input.isAiGenerated !== undefined && typeof input.isAiGenerated !== "boolean") {
    throw new TypeError("AI disclosure is invalid")
  }
  const media = input.media.map((item): InstagramMedia => {
    if (!item || typeof item !== "object" || (item.kind !== "image" && item.kind !== "video")) {
      throw new TypeError("media item is invalid")
    }
    if (item.kind === "image") {
      const altText = item.altText === undefined
        ? undefined
        : boundedString(item.altText, "image alt text", 1_000)
      return Object.freeze({
        kind: "image",
        url: publicMediaUrl(item.url),
        ...(altText === undefined ? {} : { altText }),
      })
    }
    const coverTimestampMs = item.coverTimestampMs === undefined
      ? undefined
      : nonNegativeInteger(item.coverTimestampMs, "cover timestamp", 900_000)
    return Object.freeze({
      kind: "video",
      url: publicMediaUrl(item.url),
      ...(coverTimestampMs === undefined ? {} : { coverTimestampMs }),
    })
  })
  return Object.freeze({
    caption,
    media: Object.freeze(media),
    ...(input.isAiGenerated === undefined ? {} : { isAiGenerated: input.isAiGenerated }),
  })
}

function instagramCredential(input: InstagramCredential): InstagramCredential {
  if (!input || input.provider !== provider || input.refreshToken !== null || input.refreshExpiresInSeconds !== null) {
    throw new TypeError("Instagram credential is invalid")
  }
  const grantedScopes = scopes(input.scopes)
  requireScopes(grantedScopes)
  return Object.freeze({
    provider,
    accessToken: secret(input.accessToken, "access token"),
    refreshToken: null,
    expiresInSeconds: positiveDuration(input.expiresInSeconds, "token lifetime"),
    refreshExpiresInSeconds: null,
    scopes: grantedScopes,
    accountId: identifier(input.accountId, "Instagram account ID"),
  })
}

function requireScopes(input: readonly string[]): void {
  for (const required of requiredScopes) {
    if (!input.includes(required)) throw new TypeError(`scope ${required} is required`)
  }
}

function instagramReceipt(input: InstagramPublishReceipt): InstagramPublishReceipt {
  if (!input || input.provider !== provider || !["processing", "published", "failed"].includes(input.phase)) {
    throw new TypeError("Instagram publish receipt is invalid")
  }
  const isAiGenerated = input.isAiGenerated === null || typeof input.isAiGenerated === "boolean"
    ? input.isAiGenerated
    : (() => { throw new TypeError("Instagram publish receipt is invalid") })()
  const request = instagramPublishRequest({
    caption: input.caption,
    media: input.media,
    ...(isAiGenerated === null ? {} : { isAiGenerated }),
  })
  if (!Array.isArray(input.childContainerIds) || input.childContainerIds.length === 0 || input.childContainerIds.length > maximumCarouselItems) {
    throw new TypeError("Instagram publish receipt is invalid")
  }
  const childContainerIds = Object.freeze(input.childContainerIds.map((value) =>
    identifier(value, "Instagram media container ID")
  ))
  if (new Set(childContainerIds).size !== childContainerIds.length) {
    throw new TypeError("Instagram publish receipt has duplicate child containers")
  }
  const nextMediaIndex = nonNegativeInteger(
    input.nextMediaIndex,
    "Instagram next media index",
    request.media.length,
  )
  if (nextMediaIndex === 0 || nextMediaIndex !== childContainerIds.length) {
    throw new TypeError("Instagram publish receipt progress is invalid")
  }
  const containerId = input.containerId === null
    ? null
    : identifier(input.containerId, "Instagram media container ID")
  if (
    (request.media.length === 1 && containerId !== childContainerIds[0]) ||
    (request.media.length > 1 && containerId !== null && childContainerIds.includes(containerId)) ||
    (containerId !== null && nextMediaIndex !== request.media.length)
  ) {
    throw new TypeError("Instagram publish receipt container state is invalid")
  }
  const common = {
    provider,
    accountId: identifier(input.accountId, "Instagram account ID"),
    media: request.media,
    nextMediaIndex,
    childContainerIds,
    containerId,
    caption: request.caption,
    isAiGenerated,
  }
  if (input.phase === "processing") {
    if (input.mediaId !== null || input.failureReason !== null) {
      throw new TypeError("Instagram processing receipt is invalid")
    }
    return Object.freeze({ ...common, phase: "processing", mediaId: null, failureReason: null })
  }
  if (input.phase === "published") {
    if (
      containerId === null ||
      nextMediaIndex !== request.media.length ||
      input.failureReason !== null
    ) {
      throw new TypeError("Instagram published receipt is invalid")
    }
    const mediaId = input.mediaId === null
      ? null
      : identifier(input.mediaId, "Instagram media ID")
    return Object.freeze({ ...common, phase: "published", mediaId, failureReason: null })
  }
  if (input.mediaId !== null || input.failureReason === null) {
    throw new TypeError("Instagram failed receipt is invalid")
  }
  return Object.freeze({
    ...common,
    phase: "failed",
    mediaId: null,
    failureReason: boundedString(input.failureReason, "Instagram failure reason", 512),
  })
}

function resolveConfiguration(input: InstagramProviderConfiguration): ResolvedConfiguration {
  const clientId = identifier(input.clientId, "Instagram client ID", 256)
  const clientSecret = secret(input.clientSecret, "Instagram client secret")
  const apiVersion = input.apiVersion ?? defaultApiVersion
  if (!/^v(?:[1-9]|[1-9][0-9])\.0$/.test(apiVersion)) {
    throw new TypeError("API version is invalid")
  }
  const configuredScopes = input.scopes === undefined ? [...requiredScopes] : scopes(input.scopes)
  for (const required of requiredScopes) {
    if (!configuredScopes.includes(required)) throw new TypeError(`scope ${required} is required`)
  }
  const httpClient = input.httpClient ?? createFetchSocialHttpClient()
  if (!httpClient || typeof httpClient.request !== "function") throw new TypeError("HTTP client is invalid")
  return Object.freeze({
    clientId,
    clientSecret,
    apiVersion,
    scopes: Object.freeze([...configuredScopes]),
    httpClient,
  })
}

function instagramTokenEntry(body: Record<string, unknown>): Record<string, unknown> {
  if (Array.isArray(body.data) && body.data.length > 0) return record(body.data[0])
  return body
}

function instagramAccountEntry(body: Record<string, unknown>): Record<string, unknown> {
  if (body.data === undefined) return body
  if (!Array.isArray(body.data) || body.data.length !== 1) {
    throw new TypeError("Instagram account response is invalid")
  }
  return record(body.data[0])
}

function authorizationHeaders(accessToken: string) {
  return Object.freeze({
    authorization: `Bearer ${accessToken}`,
    "content-type": "application/json",
  })
}

function withQuery(base: string, parameters: Readonly<Record<string, string>>) {
  const url = new URL(base)
  for (const [name, value] of Object.entries(parameters)) url.searchParams.set(name, value)
  return url.toString()
}

function optionalHttpsUrl(input: unknown): string | null {
  if (typeof input !== "string" || input.length === 0) return null
  try {
    return publicMediaUrl(input)
  } catch {
    return null
  }
}

function optionalProviderText(input: unknown): string | null {
  if (typeof input !== "string" || input.length === 0) return null
  try {
    return boundedString(input, "Instagram status", 512)
  } catch {
    return null
  }
}

function positiveDuration(input: unknown, name: string): number {
  if (!Number.isSafeInteger(input) || (input as number) <= 0 || (input as number) > 63_072_000) {
    throw new TypeError(`${name} is invalid`)
  }
  return input as number
}

function headerSeconds(input: string | undefined): number | null {
  if (input === undefined || !/^\d+$/.test(input)) return null
  const value = Number(input)
  return Number.isSafeInteger(value) && value >= 0 ? value : null
}
