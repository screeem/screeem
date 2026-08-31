import { Effect, Either, Fiber } from "effect"
import { describe, expect, it } from "vitest"

import {
  createFetchSocialHttpClient,
  InvalidSocialProviderResponseError,
  SocialProviderUnavailableError,
  type SocialHttpRequest,
} from "../src/social/index.js"

const request: SocialHttpRequest = {
  provider: "tiktok",
  operation: "HTTP boundary test",
  method: "GET",
  url: "https://provider.example.test/resource",
}

describe("fetch social HTTP client", () => {
  it("enforces the response limit while streaming a chunked body", async () => {
    const fetchImplementation = (async () =>
      new Response("x".repeat(1_025))) as typeof fetch
    const client = createFetchSocialHttpClient({
      fetch: fetchImplementation,
      maximumResponseBytes: 1_024,
    })

    const result = await Effect.runPromise(Effect.either(client.request(request)))

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(InvalidSocialProviderResponseError)
    }
  })

  it("aborts a provider request at the configured deadline", async () => {
    const fetchImplementation = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"))
        }, { once: true })
      })) as typeof fetch
    const client = createFetchSocialHttpClient({
      fetch: fetchImplementation,
      requestTimeoutMilliseconds: 100,
    })

    const result = await Effect.runPromise(Effect.either(client.request(request)))

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(SocialProviderUnavailableError)
    }
  })

  it("passes Effect interruption through to fetch", async () => {
    let fetchSignal: AbortSignal | null = null
    const fetchImplementation = ((_input: RequestInfo | URL, init?: RequestInit) => {
      fetchSignal = init?.signal ?? null
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"))
        }, { once: true })
      })
    }) as typeof fetch
    const client = createFetchSocialHttpClient({ fetch: fetchImplementation })
    const fiber = Effect.runFork(client.request(request))

    await new Promise((resolve) => setTimeout(resolve, 0))
    await Effect.runPromise(Fiber.interrupt(fiber))

    expect(fetchSignal).not.toBeNull()
    expect((fetchSignal as AbortSignal | null)?.aborted).toBe(true)
  })
})
