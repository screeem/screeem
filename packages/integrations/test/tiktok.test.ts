import { Effect, Either } from "effect"
import { describe, expect, it } from "vitest"

import {
  InvalidSocialProviderResponseError,
  InvalidSocialRequestError,
  SocialAuthorizationError,
  SocialPublishPersistenceError,
  SocialPublishRejectedError,
  SocialPublishUncertainError,
  SocialRateLimitError,
  type SocialHttpClient,
} from "../src/social/index.js"
import {
  createTikTokProvider,
  type TikTokCredential,
  type TikTokPhotoPublishRequest,
  type TikTokProvider,
  type TikTokVideoPublishRequest,
} from "../src/social/tiktok/index.js"
import { jsonResponse, QueueHttpClient, rawResponse, ThrowingNthHttpClient } from "./helpers.js"

const state = "state_for_social_oauth_123"
const redirectUri = "https://app.example.test/api/integrations/tiktok/callback"
const accountId = "tiktok_open_id_123"

function provider(httpClient: SocialHttpClient): TikTokProvider {
  return Effect.runSync(createTikTokProvider({
    clientKey: "tiktok_client_key",
    clientSecret: "tiktok_client_secret",
    verifiedMediaUrlPrefixes: ["https://media.example.test/"],
    httpClient,
  }))
}

function credential(): TikTokCredential {
  return {
    provider: "tiktok",
    accessToken: "tiktok_access_token",
    refreshToken: "tiktok_refresh_token",
    expiresInSeconds: 86_400,
    refreshExpiresInSeconds: 31_536_000,
    scopes: ["user.info.basic", "video.publish"],
    accountId,
  }
}

const acknowledge = {
  claim: () => Effect.void,
  acknowledge: () => Effect.void,
}

function accountInfo(id = accountId) {
  return jsonResponse({
    data: {
      user: {
        open_id: id,
        avatar_url: "https://cdn.example.test/tiktok-avatar.jpg",
        display_name: "Screeem Creator",
      },
    },
    error: { code: "ok", message: "", log_id: "log_account" },
  })
}

function videoRequest(
  overrides: Partial<TikTokVideoPublishRequest> = {},
): TikTokVideoPublishRequest {
  return {
    kind: "video",
    title: "A scheduled TikTok",
    durationSeconds: 30,
    url: "https://media.example.test/video.mp4",
    privacyLevel: "SELF_ONLY",
    disableComment: true,
    disableDuet: true,
    disableStitch: true,
    brandedContent: false,
    ownBrandContent: false,
    userConsent: true,
    isAiGenerated: false,
    ...overrides,
  }
}

function photoRequest(
  overrides: Partial<TikTokPhotoPublishRequest> = {},
): TikTokPhotoPublishRequest {
  return {
    kind: "photos",
    description: "Photos",
    urls: ["https://media.example.test/photo.jpg"],
    coverIndex: 0,
    privacyLevel: "SELF_ONLY",
    disableComment: true,
    brandedContent: false,
    ownBrandContent: false,
    userConsent: true,
    isAiGenerated: false,
    ...overrides,
  }
}

function creatorInfo() {
  return jsonResponse({
    data: {
      creator_avatar_url: "https://cdn.example.test/tiktok-avatar.jpg",
      creator_username: "screeem_creator",
      creator_nickname: "Screeem Creator",
      privacy_level_options: ["PUBLIC_TO_EVERYONE", "SELF_ONLY"],
      comment_disabled: false,
      duet_disabled: false,
      stitch_disabled: false,
      max_video_post_duration_sec: 600,
    },
    error: { code: "ok", message: "", log_id: "log_1" },
  })
}

describe("TikTok provider", () => {
  it("builds a TikTok Login Kit URL with host-owned OAuth state", async () => {
    const result = await Effect.runPromise(
      provider(new QueueHttpClient([])).authorizationUrl({ redirectUri, state }),
    )
    const url = new URL(result.url)

    expect(url.origin + url.pathname).toBe("https://www.tiktok.com/v2/auth/authorize/")
    expect(url.searchParams.get("client_key")).toBe("tiktok_client_key")
    expect(url.searchParams.get("redirect_uri")).toBe(redirectUri)
    expect(url.searchParams.get("state")).toBe(state)
    expect(url.searchParams.get("scope")?.split(",")).toEqual([
      "user.info.basic",
      "video.publish",
    ])
  })

  it("forces TikTok to show account authorization when requested", async () => {
    const result = await Effect.runPromise(provider(new QueueHttpClient([])).authorizationUrl({
      redirectUri,
      state,
      forceReauthorization: true,
    }))

    expect(new URL(result.url).searchParams.get("disable_auto_auth")).toBe("1")
  })

  it("rejects callback URLs that TikTok does not permit", async () => {
    const api = provider(new QueueHttpClient([]))
    const result = await Effect.runPromise(Effect.either(api.authorizationUrl({
      redirectUri: `${redirectUri}?tenant=one`,
      state,
    })))

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) expect(result.left).toBeInstanceOf(InvalidSocialRequestError)
  })

  it("exchanges the code and resolves the connected account", async () => {
    const httpClient = new QueueHttpClient([
      jsonResponse({
        access_token: "fresh_access_token",
        expires_in: 86_400,
        open_id: accountId,
        refresh_expires_in: 31_536_000,
        refresh_token: "fresh_refresh_token",
        scope: "user.info.basic,video.publish",
        token_type: "Bearer",
      }),
      jsonResponse({
        data: {
          user: {
            open_id: accountId,
            avatar_url: "https://cdn.example.test/avatar.jpg",
            display_name: "Screeem Creator",
          },
        },
        error: { code: "ok", message: "", log_id: "log_2" },
      }),
    ])

    const connected = await Effect.runPromise(provider(httpClient).exchangeCode({
      code: "tiktok_authorization_code",
      redirectUri,
      expectedRedirectUri: redirectUri,
      state,
      expectedState: state,
    }))

    expect(connected).toMatchObject({
      credential: {
        accountId,
        accessToken: "fresh_access_token",
        refreshToken: "fresh_refresh_token",
      },
      account: {
        id: accountId,
        username: null,
        displayName: "Screeem Creator",
      },
    })
    expect(new URLSearchParams(httpClient.requests[0]!.body).get("grant_type"))
      .toBe("authorization_code")
  })

  it("requires the callback state to match the consumed OAuth attempt", async () => {
    const httpClient = new QueueHttpClient([])
    const result = await Effect.runPromise(Effect.either(provider(httpClient).exchangeCode({
      code: "tiktok_authorization_code",
      redirectUri,
      expectedRedirectUri: redirectUri,
      state: "returned_oauth_state_123",
      expectedState: "expected_oauth_state_123",
    })))

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) expect(result.left).toBeInstanceOf(InvalidSocialRequestError)
    expect(httpClient.requests).toHaveLength(0)
  })

  it("does not let token refresh change the connected account", async () => {
    const httpClient = new QueueHttpClient([jsonResponse({
      access_token: "fresh_access_token",
      expires_in: 86_400,
      open_id: "different_open_id",
      refresh_expires_in: 31_536_000,
      refresh_token: "fresh_refresh_token",
      scope: "user.info.basic,video.publish",
      token_type: "Bearer",
    })])
    const result = await Effect.runPromise(Effect.either(
      provider(httpClient).refreshCredential(credential()),
    ))

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(InvalidSocialProviderResponseError)
    }
  })

  it("queries creator capabilities before starting a direct video post", async () => {
    const httpClient = new QueueHttpClient([
      accountInfo(),
      creatorInfo(),
      jsonResponse({
        data: { publish_id: "publish_1" },
        error: { code: "ok", message: "", log_id: "log_3" },
      }),
      jsonResponse({
        data: { status: "PUBLISH_COMPLETE", publicaly_available_post_id: ["7420000000000000000"] },
        error: { code: "ok", message: "", log_id: "log_4" },
      }),
    ])
    const api = provider(httpClient)
    const initial = await Effect.runPromise(api.publish(credential(), videoRequest({
      privacyLevel: "PUBLIC_TO_EVERYONE",
      disableComment: false,
      disableDuet: false,
      disableStitch: false,
      isAiGenerated: true,
    }), acknowledge))
    const completed = await Effect.runPromise(api.advancePublish(
      credential(),
      initial,
      acknowledge,
    ))

    expect(httpClient.requests.map((request) => request.operation)).toEqual([
      "account lookup",
      "creator lookup",
      "publish",
      "publish status",
    ])
    expect(initial).toMatchObject({ phase: "processing", publishId: "publish_1" })
    expect(completed).toMatchObject({
      phase: "published",
      postIds: ["7420000000000000000"],
    })
    expect(JSON.parse(httpClient.requests[2]!.body!)).toEqual({
      post_info: {
        title: "A scheduled TikTok",
        privacy_level: "PUBLIC_TO_EVERYONE",
        disable_duet: false,
        disable_comment: false,
        disable_stitch: false,
        brand_content_toggle: false,
        brand_organic_toggle: false,
        is_aigc: true,
      },
      source_info: {
        source: "PULL_FROM_URL",
        video_url: "https://media.example.test/video.mp4",
      },
    })
  })

  it("requires a durable initial dispatch claim before provider I/O", async () => {
    const httpClient = new QueueHttpClient([])
    const result = await Effect.runPromise(Effect.either(provider(httpClient).publish(
      credential(),
      videoRequest(),
      {
        claim: () => Effect.fail("lease already held"),
        acknowledge: () => Effect.void,
      },
    )))

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(SocialPublishPersistenceError)
      expect(result.left).toMatchObject({ stage: "claim" })
    }
    expect(httpClient.requests).toHaveLength(0)
  })

  it("does not publish a privacy choice that TikTok did not return", async () => {
    const httpClient = new QueueHttpClient([accountInfo(), creatorInfo()])
    const result = await Effect.runPromise(Effect.either(provider(httpClient).publish(
      credential(),
      photoRequest({
        privacyLevel: "FOLLOWER_OF_CREATOR",
        disableComment: false,
      }),
      acknowledge,
    )))

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) expect(result.left).toBeInstanceOf(InvalidSocialRequestError)
    expect(httpClient.requests).toHaveLength(2)
  })

  it("maps a failed Direct Post response to a typed publish rejection", async () => {
    const httpClient = new QueueHttpClient([
      accountInfo(),
      creatorInfo(),
      jsonResponse({
        data: {},
        error: { code: "spam_risk_too_many_posts", message: "Posting limit reached", log_id: "log_5" },
      }, 400),
    ])
    const result = await Effect.runPromise(Effect.either(
      provider(httpClient).publish(credential(), videoRequest(), acknowledge),
    ))

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) expect(result.left).toBeInstanceOf(SocialPublishRejectedError)
  })

  it("rejects media outside the URL prefixes verified with TikTok", async () => {
    const httpClient = new QueueHttpClient([])
    const result = await Effect.runPromise(Effect.either(provider(httpClient).publish(
      credential(),
      videoRequest({
        title: "Wrong host",
        durationSeconds: 10,
        url: "https://unverified.example.test/video.mp4",
      }),
      acknowledge,
    )))

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) expect(result.left).toBeInstanceOf(InvalidSocialRequestError)
    expect(httpClient.requests).toHaveLength(0)
  })

  it("rejects nested percent encoding inside a verified media path", async () => {
    const httpClient = new QueueHttpClient([])
    const api = Effect.runSync(createTikTokProvider({
      clientKey: "tiktok_client_key",
      clientSecret: "tiktok_client_secret",
      verifiedMediaUrlPrefixes: ["https://media.example.test/social/"],
      httpClient,
    }))
    const result = await Effect.runPromise(Effect.either(api.publish(
      credential(),
      videoRequest({
        url: "https://media.example.test/social/%252e%252e%252fprivate/video.mp4",
      }),
      acknowledge,
    )))

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) expect(result.left).toBeInstanceOf(InvalidSocialRequestError)
    expect(httpClient.requests).toHaveLength(0)
  })

  it("treats malformed creator data as an invalid provider response", async () => {
    const httpClient = new QueueHttpClient([
      jsonResponse({ data: {}, error: { code: "ok", message: "", log_id: "log_6" } }),
    ])
    const result = await Effect.runPromise(Effect.either(provider(httpClient).getCreatorInfo(
      credential(),
    )))

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(InvalidSocialProviderResponseError)
    }
  })

  it("preserves TikTok int64 post IDs exactly", async () => {
    const httpClient = new QueueHttpClient([rawResponse(
      '{"data":{"status":"PUBLISH_COMPLETE","publicaly_available_post_id":[7421234567890123456]},"error":{"code":"ok","message":"","log_id":"log_int64"}}',
    )])
    const result = await Effect.runPromise(provider(httpClient).advancePublish(credential(), {
      provider: "tiktok",
      accountId,
      phase: "processing",
      publishId: "publish_int64",
      postIds: [],
      failureReason: null,
    }, acknowledge))

    expect(result).toMatchObject({
      phase: "published",
      postIds: ["7421234567890123456"],
    })
  })

  it("rejects malformed TikTok post IDs instead of coercing them", async () => {
    const httpClient = new QueueHttpClient([jsonResponse({
      data: { status: "PUBLISH_COMPLETE", publicaly_available_post_id: [null] },
      error: { code: "ok", message: "", log_id: "log_bad_id" },
    })])
    const result = await Effect.runPromise(Effect.either(
      provider(httpClient).advancePublish(credential(), {
        provider: "tiktok",
        accountId,
        phase: "processing",
        publishId: "publish_bad_id",
        postIds: [],
        failureReason: null,
      }, acknowledge),
    ))

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(InvalidSocialProviderResponseError)
    }
  })

  it("marks an unparseable publish acknowledgement as uncertain", async () => {
    const httpClient = new QueueHttpClient([
      accountInfo(),
      creatorInfo(),
      rawResponse("gateway returned an invalid body"),
    ])
    const result = await Effect.runPromise(Effect.either(
      provider(httpClient).publish(credential(), videoRequest(), acknowledge),
    ))

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) expect(result.left).toBeInstanceOf(SocialPublishUncertainError)
  })

  it("maps a synchronously throwing publish client to an uncertain outcome", async () => {
    const httpClient = new ThrowingNthHttpClient([accountInfo(), creatorInfo()], 3)
    const result = await Effect.runPromise(Effect.either(
      provider(httpClient).publish(credential(), videoRequest(), acknowledge),
    ))

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) expect(result.left).toBeInstanceOf(SocialPublishUncertainError)
  })

  it("marks a 2xx publish response without TikTok's success envelope as uncertain", async () => {
    const httpClient = new QueueHttpClient([
      accountInfo(),
      creatorInfo(),
      jsonResponse({ data: { publish_id: "possibly_accepted" } }),
    ])
    const result = await Effect.runPromise(Effect.either(
      provider(httpClient).publish(credential(), videoRequest(), acknowledge),
    ))

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(SocialPublishUncertainError)
      expect(result.left).toMatchObject({ providerReference: "possibly_accepted" })
    }
  })

  it("requires explicit per-post consent and disclosure choices", async () => {
    const request = { ...videoRequest(), userConsent: undefined } as unknown as TikTokVideoPublishRequest
    const result = await Effect.runPromise(Effect.either(
      provider(new QueueHttpClient([])).publish(credential(), request, acknowledge),
    ))

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) expect(result.left).toBeInstanceOf(InvalidSocialRequestError)
  })

  it("rejects a video cover timestamp beyond the declared duration", async () => {
    const result = await Effect.runPromise(Effect.either(provider(new QueueHttpClient([])).publish(
      credential(),
      videoRequest({ durationSeconds: 10, coverTimestampMs: 10_001 }),
      acknowledge,
    )))

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) expect(result.left).toBeInstanceOf(InvalidSocialRequestError)
  })

  it("rejects impossible receipt states before polling TikTok", async () => {
    const invalidReceipt = {
      provider: "tiktok",
      accountId,
      phase: "processing",
      publishId: "publish_invalid",
      postIds: ["7421234567890123456"],
      failureReason: null,
    } as unknown as Parameters<TikTokProvider["advancePublish"]>[1]
    const result = await Effect.runPromise(Effect.either(
      provider(new QueueHttpClient([])).advancePublish(credential(), invalidReceipt, acknowledge),
    ))

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) expect(result.left).toBeInstanceOf(InvalidSocialRequestError)
  })

  it("sends the complete photo Direct Post payload", async () => {
    const httpClient = new QueueHttpClient([
      accountInfo(),
      creatorInfo(),
      jsonResponse({
        data: { publish_id: "photo_publish_1" },
        error: { code: "ok", message: "", log_id: "log_photo" },
      }),
    ])
    await Effect.runPromise(provider(httpClient).publish(credential(), photoRequest({
      title: "A photo set",
      autoAddMusic: true,
      isAiGenerated: true,
    }), acknowledge))

    expect(JSON.parse(httpClient.requests[2]!.body!)).toEqual({
      post_mode: "DIRECT_POST",
      media_type: "PHOTO",
      post_info: {
        title: "A photo set",
        description: "Photos",
        privacy_level: "SELF_ONLY",
        disable_comment: true,
        auto_add_music: true,
        brand_content_toggle: false,
        brand_organic_toggle: false,
      },
      source_info: {
        source: "PULL_FROM_URL",
        photo_cover_index: 0,
        photo_images: ["https://media.example.test/photo.jpg"],
      },
      is_aigc: true,
    })
  })

  it("revokes the TikTok grant before local disconnect", async () => {
    const httpClient = new QueueHttpClient([accountInfo(), rawResponse("")])
    const result = await Effect.runPromise(provider(httpClient).revokeCredential(credential()))

    expect(result).toEqual({ status: "revoked" })
    expect(httpClient.requests[1]).toMatchObject({
      method: "POST",
      operation: "credential revocation",
      url: "https://open.tiktokapis.com/v2/oauth/revoke/",
    })
    expect(new URLSearchParams(httpClient.requests[1]!.body).get("token"))
      .toBe("tiktok_access_token")
  })

  it("requires reauthorization for a revoked or expired refresh grant", async () => {
    const httpClient = new QueueHttpClient([jsonResponse({
      error: "invalid_grant",
      error_description: "The refresh grant is no longer valid",
    }, 400)])
    const result = await Effect.runPromise(Effect.either(
      provider(httpClient).refreshCredential(credential()),
    ))

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(SocialAuthorizationError)
      expect(result.left).toMatchObject({ reauthorize: true })
    }
  })

  it("classifies a non-JSON rate limit before decoding the body", async () => {
    const httpClient = new QueueHttpClient([rawResponse("slow down", 429, {
      "retry-after": "42",
    })])
    const result = await Effect.runPromise(Effect.either(
      provider(httpClient).getCreatorInfo(credential()),
    ))

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(SocialRateLimitError)
      expect(result.left).toMatchObject({ retryAfterSeconds: 42 })
    }
  })
})
