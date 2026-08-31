import { Effect } from "effect"

import {
  InvalidSocialProviderResponseError,
  SocialProviderUnavailableError,
  type SocialTransportFailure,
} from "./errors.js"
import type { SocialProviderName } from "./model.js"

export interface SocialHttpRequest {
  readonly provider: SocialProviderName
  readonly operation: string
  readonly method: "GET" | "POST" | "PUT" | "DELETE"
  readonly url: string
  readonly headers?: Readonly<Record<string, string>>
  readonly body?: string
}

export interface SocialHttpResponse {
  readonly status: number
  readonly headers: Readonly<Record<string, string>>
  readonly body: string
}

export interface SocialHttpClient {
  request(request: SocialHttpRequest): Effect.Effect<SocialHttpResponse, SocialTransportFailure>
}

/** Keep custom-client invocation lazy and normalize unexpected defects. */
export function executeSocialHttpRequest(
  client: SocialHttpClient,
  request: SocialHttpRequest,
): Effect.Effect<SocialHttpResponse, SocialTransportFailure> {
  return Effect.suspend(() => client.request(request)).pipe(
    Effect.catchAllDefect(() => Effect.fail(new SocialProviderUnavailableError({
      provider: request.provider,
      operation: request.operation,
    }))),
  )
}

export interface FetchSocialHttpClientOptions {
  readonly fetch?: typeof globalThis.fetch
  readonly maximumResponseBytes?: number
  readonly requestTimeoutMilliseconds?: number
}

const defaultMaximumResponseBytes = 1_048_576
const maximumAllowedResponseBytes = 16_777_216
const defaultRequestTimeoutMilliseconds = 30_000

export function createFetchSocialHttpClient(
  options: FetchSocialHttpClientOptions = {},
): SocialHttpClient {
  const fetchImplementation = options.fetch ?? globalThis.fetch
  const maximumResponseBytes = options.maximumResponseBytes ?? defaultMaximumResponseBytes
  const requestTimeoutMilliseconds =
    options.requestTimeoutMilliseconds ?? defaultRequestTimeoutMilliseconds
  if (typeof fetchImplementation !== "function") throw new TypeError("fetch is required")
  if (
    !Number.isSafeInteger(maximumResponseBytes) ||
    maximumResponseBytes < 1_024 ||
    maximumResponseBytes > maximumAllowedResponseBytes
  ) {
    throw new TypeError("maximumResponseBytes must be between 1024 and 16777216")
  }
  if (
    !Number.isSafeInteger(requestTimeoutMilliseconds) ||
    requestTimeoutMilliseconds < 100 ||
    requestTimeoutMilliseconds > 300_000
  ) {
    throw new TypeError("requestTimeoutMilliseconds must be between 100 and 300000")
  }

  return Object.freeze({
    request: (request: SocialHttpRequest) =>
      Effect.tryPromise({
        try: async (effectSignal) => {
          const signal = AbortSignal.any([
            effectSignal,
            AbortSignal.timeout(requestTimeoutMilliseconds),
          ])
          const response = await fetchImplementation(request.url, {
            method: request.method,
            ...(request.headers ? { headers: request.headers } : {}),
            ...(request.body === undefined ? {} : { body: request.body }),
            redirect: "error",
            signal,
          })
          const contentLength = response.headers.get("content-length")
          if (
            contentLength !== null &&
            /^\d+$/.test(contentLength) &&
            Number(contentLength) > maximumResponseBytes
          ) {
            await response.body?.cancel()
            throw new ResponseTooLargeError()
          }
          return Object.freeze({
            status: response.status,
            headers: Object.freeze(Object.fromEntries(response.headers.entries())),
            body: await readBoundedBody(response, maximumResponseBytes),
          })
        },
        catch: (error) =>
          error instanceof ResponseTooLargeError
            ? new InvalidSocialProviderResponseError({
                provider: request.provider,
                operation: request.operation,
              })
            : new SocialProviderUnavailableError({
                provider: request.provider,
                operation: request.operation,
              }),
      }),
  })
}

class ResponseTooLargeError extends Error {}

async function readBoundedBody(response: Response, maximumBytes: number): Promise<string> {
  if (response.body === null) return ""
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let byteLength = 0
  let result = ""
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      byteLength += chunk.value.byteLength
      if (byteLength > maximumBytes) {
        await reader.cancel()
        throw new ResponseTooLargeError()
      }
      result += decoder.decode(chunk.value, { stream: true })
    }
    return result + decoder.decode()
  } finally {
    reader.releaseLock()
  }
}
