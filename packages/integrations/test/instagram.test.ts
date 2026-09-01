import { Effect, Either, Fiber } from "effect"
import { describe, expect, it } from "vitest"

import {
  InvalidSocialProviderResponseError,
  InvalidSocialRequestError,
  SocialProviderUnavailableError,
  SocialPublishPersistenceError,
  SocialPublishUncertainError,
  type SocialHttpClient,
  type SocialHttpRequest,
} from "../src/social/index.js"
import {
  createInstagramProvider,
  type InstagramCredential,
  type InstagramProvider,
  type InstagramPublishReceipt,
} from "../src/social/instagram/index.js"
import { jsonResponse, QueueHttpClient, rawResponse, ThrowingNthHttpClient } from "./helpers.js"

const state = "state_for_social_oauth_123"
const redirectUri = "https://app.example.test/api/integrations/instagram/callback"
const accountId = "17841400000000000"

function provider(httpClient: SocialHttpClient): InstagramProvider {
  return Effect.runSync(createInstagramProvider({
    clientId: "123456789",
    clientSecret: "instagram_client_secret",
    httpClient,
  }))
}

function credential(): InstagramCredential {
  return {
    provider: "instagram",
    accessToken: "instagram_long_lived_access_token",
    refreshToken: null,
    expiresInSeconds: 5_184_000,
    refreshExpiresInSeconds: null,
    scopes: ["instagram_business_basic", "instagram_business_content_publish"],
    accountId,
  }
}

const acknowledge = {
  claim: () => Effect.void,
  acknowledge: () => Effect.void,
}

function accountInfo(id = accountId) {
  return jsonResponse({
    data: [{
      user_id: id,
      username: "screeem_creator",
      name: "Screeem Creator",
      profile_picture_url: "https://cdn.example.test/avatar.jpg",
    }],
  })
}

describe("Instagram provider", () => {
  it("builds an Instagram Login URL with host-owned OAuth state", async () => {
    const result = await Effect.runPromise(
      provider(new QueueHttpClient([])).authorizationUrl({ redirectUri, state }),
    )
    const url = new URL(result.url)

    expect(url.origin + url.pathname).toBe("https://www.instagram.com/oauth/authorize")
    expect(url.searchParams.get("client_id")).toBe("123456789")
    expect(url.searchParams.get("redirect_uri")).toBe(redirectUri)
    expect(url.searchParams.get("state")).toBe(state)
    expect(url.searchParams.get("scope")?.split(",")).toEqual([
      "instagram_business_basic",
      "instagram_business_content_publish",
    ])
  })

  it("exchanges the code for a long-lived token and resolves the account", async () => {
    const httpClient = new QueueHttpClient([
      jsonResponse({
        data: [{
          access_token: "short_lived_token",
          user_id: accountId,
          permissions: ["instagram_business_basic", "instagram_business_content_publish"],
        }],
      }),
      jsonResponse({ access_token: "long_lived_token", token_type: "bearer", expires_in: 5_184_000 }),
      jsonResponse({
        data: [{
          user_id: accountId,
          username: "screeem_creator",
          name: "Screeem Creator",
          profile_picture_url: "https://cdn.example.test/avatar.jpg",
        }],
      }),
    ])

    const result = await Effect.runPromise(provider(httpClient).exchangeCode({
      code: "instagram_authorization_code",
      redirectUri,
      expectedRedirectUri: redirectUri,
      state,
      expectedState: state,
    }))

    expect(result).toMatchObject({
      credential: {
        provider: "instagram",
        accountId,
        accessToken: "long_lived_token",
        expiresInSeconds: 5_184_000,
      },
      account: {
        id: accountId,
        username: "screeem_creator",
        displayName: "Screeem Creator",
      },
    })
    expect(httpClient.requests[0]).toMatchObject({
      method: "POST",
      url: "https://api.instagram.com/oauth/access_token",
    })
    expect(new URL(httpClient.requests[1]!.url).searchParams.get("grant_type"))
      .toBe("ig_exchange_token")
  })

  it("creates, waits for, and publishes a single image container", async () => {
    const httpClient = new QueueHttpClient([
      accountInfo(),
      jsonResponse({ id: "container_1" }),
      accountInfo(),
      jsonResponse({ status_code: "FINISHED", status: "Finished" }),
      jsonResponse({ id: "media_1" }),
    ])
    const api = provider(httpClient)
    const initial = await Effect.runPromise(api.publish(credential(), {
      caption: "A scheduled post",
      media: [{ kind: "image", url: "https://media.example.test/post.jpg", altText: "Desk" }],
      isAiGenerated: false,
    }, acknowledge))
    const completed = await Effect.runPromise(api.advancePublish(
      credential(),
      initial,
      acknowledge,
    ))

    expect(initial).toMatchObject({ phase: "processing", containerId: "container_1" })
    expect(completed).toMatchObject({ phase: "published", mediaId: "media_1" })
    expect(JSON.parse(httpClient.requests[1]!.body!)).toEqual({
      image_url: "https://media.example.test/post.jpg",
      alt_text: "Desk",
      caption: "A scheduled post",
      is_ai_generated: false,
    })
    expect(JSON.parse(httpClient.requests[4]!.body!)).toEqual({ creation_id: "container_1" })
  })

  it("sends the explicit Reel feed destination and persists it for resumption", async () => {
    const httpClient = new QueueHttpClient([
      accountInfo(),
      jsonResponse({ id: "reel_container" }),
      accountInfo(),
      jsonResponse({ status_code: "FINISHED" }),
      jsonResponse({ id: "published_reel" }),
    ])
    const api = provider(httpClient)
    const initial = await Effect.runPromise(api.publish(credential(), {
      caption: "A scheduled Reel",
      media: [{ kind: "video", url: "https://media.example.test/reel.mp4" }],
      shareToFeed: false,
    }, acknowledge))
    const persisted = JSON.parse(JSON.stringify(initial)) as InstagramPublishReceipt
    const completed = await Effect.runPromise(api.advancePublish(
      credential(),
      persisted,
      acknowledge,
    ))

    expect(initial).toMatchObject({ shareToFeed: false })
    expect(completed).toMatchObject({ phase: "published", shareToFeed: false })
    expect(JSON.parse(httpClient.requests[1]!.body!)).toEqual({
      video_url: "https://media.example.test/reel.mp4",
      media_type: "REELS",
      caption: "A scheduled Reel",
      share_to_feed: false,
    })
  })

  it("normalizes legacy receipts without Reel feed state", async () => {
    const httpClient = new QueueHttpClient([
      accountInfo(),
      jsonResponse({ id: "legacy_container" }),
      accountInfo(),
      jsonResponse({ status_code: "FINISHED" }),
      jsonResponse({ id: "legacy_media" }),
    ])
    const api = provider(httpClient)
    const initial = await Effect.runPromise(api.publish(credential(), {
      caption: "Legacy image",
      media: [{ kind: "image", url: "https://media.example.test/legacy.jpg" }],
    }, acknowledge))
    const { shareToFeed: _missingInLegacyReceipt, ...legacy } = JSON.parse(
      JSON.stringify(initial),
    ) as InstagramPublishReceipt
    const completed = await Effect.runPromise(api.advancePublish(
      credential(),
      legacy as InstagramPublishReceipt,
      acknowledge,
    ))

    expect(completed).toMatchObject({ phase: "published", shareToFeed: null })
  })

  it("rejects Reel feed sharing on image and carousel requests", async () => {
    const api = provider(new QueueHttpClient([]))
    const image = await Effect.runPromise(Effect.either(api.publish(credential(), {
      caption: "Image",
      media: [{ kind: "image", url: "https://media.example.test/image.jpg" }],
      shareToFeed: true,
    }, acknowledge)))
    const carousel = await Effect.runPromise(Effect.either(api.publish(credential(), {
      caption: "Carousel",
      media: [
        { kind: "video", url: "https://media.example.test/one.mp4" },
        { kind: "video", url: "https://media.example.test/two.mp4" },
      ],
      shareToFeed: true,
    }, acknowledge)))

    expect(Either.isLeft(image)).toBe(true)
    expect(Either.isLeft(carousel)).toBe(true)
    if (Either.isLeft(image)) expect(image.left).toBeInstanceOf(InvalidSocialRequestError)
    if (Either.isLeft(carousel)) expect(carousel.left).toBeInstanceOf(InvalidSocialRequestError)
  })

  it("resumes a carousel through child processing, parent processing, and publish", async () => {
    const httpClient = new QueueHttpClient([
      accountInfo(),
      jsonResponse({ id: "child_1" }),
      accountInfo(),
      jsonResponse({ id: "child_2" }),
      accountInfo(),
      jsonResponse({ status_code: "FINISHED" }),
      jsonResponse({ status_code: "FINISHED" }),
      jsonResponse({ id: "carousel_1" }),
      accountInfo(),
      jsonResponse({ status_code: "FINISHED" }),
      jsonResponse({ id: "media_2" }),
    ])
    const api = provider(httpClient)
    const children = await Effect.runPromise(api.publish(credential(), {
      caption: "Two parts",
      media: [
        { kind: "image", url: "https://media.example.test/one.jpg" },
        { kind: "video", url: "https://media.example.test/two.mp4" },
      ],
      isAiGenerated: true,
    }, acknowledge))
    const allChildren = await Effect.runPromise(api.advancePublish(
      credential(),
      children,
      acknowledge,
    ))
    const parent = await Effect.runPromise(api.advancePublish(
      credential(),
      allChildren,
      acknowledge,
    ))
    const completed = await Effect.runPromise(api.advancePublish(
      credential(),
      parent,
      acknowledge,
    ))

    expect(parent).toMatchObject({ phase: "processing", containerId: "carousel_1" })
    expect(completed).toMatchObject({ phase: "published", mediaId: "media_2" })
    expect(allChildren).toMatchObject({ nextMediaIndex: 2, childContainerIds: ["child_1", "child_2"] })
    expect(JSON.parse(httpClient.requests[7]!.body!)).toEqual({
      media_type: "CAROUSEL",
      children: "child_1,child_2",
      caption: "Two parts",
      is_ai_generated: true,
    })
  })

  it("creates a carousel parent when child containers report PUBLISHED", async () => {
    const httpClient = new QueueHttpClient([
      accountInfo(),
      jsonResponse({ id: "child_published_1" }),
      accountInfo(),
      jsonResponse({ id: "child_published_2" }),
      accountInfo(),
      jsonResponse({ status_code: "PUBLISHED" }),
      jsonResponse({ status_code: "PUBLISHED" }),
      jsonResponse({ id: "carousel_from_published_children" }),
    ])
    const api = provider(httpClient)
    const firstChild = await Effect.runPromise(api.publish(credential(), {
      caption: "Already processed children",
      media: [
        { kind: "image", url: "https://media.example.test/published-one.jpg" },
        { kind: "image", url: "https://media.example.test/published-two.jpg" },
      ],
    }, acknowledge))
    const children = await Effect.runPromise(api.advancePublish(
      credential(),
      firstChild,
      acknowledge,
    ))
    const parent = await Effect.runPromise(api.advancePublish(
      credential(),
      children,
      acknowledge,
    ))

    expect(parent).toMatchObject({
      phase: "processing",
      containerId: "carousel_from_published_children",
      mediaId: null,
    })
  })

  it("rejects non-HTTPS media before making a provider request", async () => {
    const httpClient = new QueueHttpClient([])
    const result = await Effect.runPromise(Effect.either(provider(httpClient).publish(credential(), {
      caption: "Unsafe URL",
      media: [{ kind: "image", url: "http://media.example.test/post.jpg" }],
    }, acknowledge)))

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) expect(result.left).toBeInstanceOf(InvalidSocialRequestError)
    expect(httpClient.requests).toHaveLength(0)
  })

  it("requires a durable initial dispatch claim before provider I/O", async () => {
    const httpClient = new QueueHttpClient([])
    const result = await Effect.runPromise(Effect.either(provider(httpClient).publish(
      credential(),
      {
        caption: "Only one worker",
        media: [{ kind: "image", url: "https://media.example.test/claimed.jpg" }],
      },
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

  it("marks a malformed non-idempotent create acknowledgement as uncertain", async () => {
    const httpClient = new QueueHttpClient([accountInfo(), jsonResponse({})])
    const result = await Effect.runPromise(Effect.either(provider(httpClient).publish(credential(), {
      caption: "Valid input",
      media: [{ kind: "image", url: "https://media.example.test/post.jpg" }],
    }, acknowledge)))

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(SocialPublishUncertainError)
    }
  })

  it("maps a synchronously throwing publish client to an uncertain outcome", async () => {
    const httpClient = new ThrowingNthHttpClient([accountInfo()], 2)
    const result = await Effect.runPromise(Effect.either(provider(httpClient).publish(credential(), {
      caption: "Valid input",
      media: [{ kind: "image", url: "https://media.example.test/post.jpg" }],
    }, acknowledge)))

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) expect(result.left).toBeInstanceOf(SocialPublishUncertainError)
  })

  it("maps a synchronously throwing durable acknowledgement to uncertainty", async () => {
    const httpClient = new QueueHttpClient([accountInfo(), jsonResponse({ id: "container_ack" })])
    const result = await Effect.runPromise(Effect.either(provider(httpClient).publish(
      credential(),
      {
        caption: "Persist me",
        media: [{ kind: "image", url: "https://media.example.test/persist.jpg" }],
      },
      {
        claim: () => Effect.void,
        acknowledge: () => { throw new Error("database unavailable") },
      },
    )))

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(SocialPublishUncertainError)
      expect(result.left).toMatchObject({ providerReference: "container_ack" })
    }
  })

  it("persists an acknowledged mutation before honoring interruption", async () => {
    let releaseCreate: (() => void) | undefined
    const requests: SocialHttpRequest[] = []
    const httpClient: SocialHttpClient = {
      request: (request) => {
        requests.push(request)
        if (request.operation === "account lookup") return Effect.succeed(accountInfo())
        return Effect.async((resume) => {
          releaseCreate = () => resume(Effect.succeed(jsonResponse({ id: "container_interrupt" })))
        })
      },
    }
    const acknowledged: InstagramPublishReceipt[] = []
    const fiber = Effect.runFork(provider(httpClient).publish(
      credential(),
      {
        caption: "Do not lose me",
        media: [{ kind: "image", url: "https://media.example.test/interrupt.jpg" }],
      },
      {
        claim: () => Effect.void,
        acknowledge: (receipt) => Effect.sync(() => { acknowledged.push(receipt) }),
      },
    ))

    while (releaseCreate === undefined) await new Promise((resolve) => setTimeout(resolve, 0))
    const release = releaseCreate
    const interrupted = Effect.runPromise(Fiber.interrupt(fiber))
    await new Promise((resolve) => setTimeout(resolve, 0))
    release()
    await interrupted
    for (let attempts = 0; acknowledged.length === 0 && attempts < 20; attempts += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    expect(requests.map((request) => request.operation)).toEqual([
      "account lookup",
      "create media container",
    ])
    expect(acknowledged).toHaveLength(1)
    expect(acknowledged[0]).toMatchObject({ childContainerIds: ["container_interrupt"] })
  })

  it("stops a partial carousel after an uncertain child-container outcome", async () => {
    const httpClient = new QueueHttpClient([
      accountInfo(),
      jsonResponse({ id: "child_1" }),
      accountInfo(),
      rawResponse("upstream acknowledgement was lost"),
    ])
    const api = provider(httpClient)
    const initial = await Effect.runPromise(api.publish(
      credential(),
      {
        caption: "Two parts",
        media: [
          { kind: "image", url: "https://media.example.test/one.jpg" },
          { kind: "image", url: "https://media.example.test/two.jpg" },
        ],
      },
      acknowledge,
    ))
    const result = await Effect.runPromise(Effect.either(api.advancePublish(
      credential(),
      initial,
      acknowledge,
    )))

    expect(initial).toMatchObject({ nextMediaIndex: 1, childContainerIds: ["child_1"] })
    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) expect(result.left).toBeInstanceOf(SocialPublishUncertainError)
    expect(httpClient.requests).toHaveLength(4)
  })

  it("requires the callback state to match the consumed OAuth attempt", async () => {
    const httpClient = new QueueHttpClient([])
    const result = await Effect.runPromise(Effect.either(provider(httpClient).exchangeCode({
      code: "instagram_authorization_code",
      redirectUri,
      expectedRedirectUri: redirectUri,
      state: "returned_oauth_state_123",
      expectedState: "expected_oauth_state_123",
    })))

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) expect(result.left).toBeInstanceOf(InvalidSocialRequestError)
    expect(httpClient.requests).toHaveLength(0)
  })

  it("reports a malformed short-token response as a typed provider failure", async () => {
    const httpClient = new QueueHttpClient([jsonResponse({ data: [null] })])
    const result = await Effect.runPromise(Effect.either(provider(httpClient).exchangeCode({
      code: "instagram_authorization_code",
      redirectUri,
      expectedRedirectUri: redirectUri,
      state,
      expectedState: state,
    })))

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(InvalidSocialProviderResponseError)
    }
  })

  it("does not claim requested Instagram scopes when the provider omits permissions", async () => {
    const httpClient = new QueueHttpClient([
      jsonResponse({ data: [{ access_token: "short_lived_token", user_id: accountId }] }),
      jsonResponse({ access_token: "long_lived_token", token_type: "bearer", expires_in: 5_184_000 }),
    ])
    const result = await Effect.runPromise(Effect.either(provider(httpClient).exchangeCode({
      code: "instagram_authorization_code",
      redirectUri,
      expectedRedirectUri: redirectUri,
      state,
      expectedState: state,
    })))

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(InvalidSocialProviderResponseError)
    }
  })

  it("recovers a completed publish without fabricating a media ID", async () => {
    const httpClient = new QueueHttpClient([
      accountInfo(),
      jsonResponse({ id: "container_recovered" }),
      accountInfo(),
      jsonResponse({ status_code: "PUBLISHED" }),
    ])
    const api = provider(httpClient)
    const initial = await Effect.runPromise(api.publish(credential(), {
      caption: "Recovered",
      media: [{ kind: "image", url: "https://media.example.test/recovered.jpg" }],
    }, acknowledge))
    const completed = await Effect.runPromise(api.advancePublish(
      credential(),
      initial,
      acknowledge,
    ))

    expect(completed).toMatchObject({ phase: "published", mediaId: null })
    expect(httpClient.requests).toHaveLength(4)
  })

  it("rejects an account lookup that does not match the credential subject", async () => {
    const httpClient = new QueueHttpClient([
      jsonResponse({ data: [{ user_id: "17841499999999999", username: "other_creator" }] }),
    ])
    const result = await Effect.runPromise(Effect.either(
      provider(httpClient).getAccount(credential()),
    ))

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(InvalidSocialProviderResponseError)
    }
  })

  it("verifies the Instagram subject after refreshing a token", async () => {
    const httpClient = new QueueHttpClient([
      jsonResponse({
        access_token: "refreshed_access_token",
        token_type: "bearer",
        expires_in: 5_184_000,
      }),
      jsonResponse({ data: [{ user_id: "17841499999999999", username: "other_creator" }] }),
    ])
    const result = await Effect.runPromise(Effect.either(
      provider(httpClient).refreshCredential(credential()),
    ))

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(InvalidSocialProviderResponseError)
    }
  })

  it("revokes the provider grant before local disconnect", async () => {
    const httpClient = new QueueHttpClient([accountInfo(), jsonResponse({ success: true })])
    const result = await Effect.runPromise(provider(httpClient).revokeCredential(credential()))

    expect(result).toEqual({ status: "revoked" })
    expect(httpClient.requests[1]).toMatchObject({
      method: "DELETE",
      operation: "credential revocation",
    })
  })

  it("classifies a non-JSON provider outage before decoding the body", async () => {
    const httpClient = new QueueHttpClient([rawResponse("service unavailable", 503)])
    const result = await Effect.runPromise(Effect.either(
      provider(httpClient).getAccount(credential()),
    ))

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(SocialProviderUnavailableError)
    }
  })
})
