import { Effect } from "effect"

import type {
  SocialHttpClient,
  SocialHttpRequest,
  SocialHttpResponse,
} from "../src/social/index.js"

export class QueueHttpClient implements SocialHttpClient {
  readonly requests: SocialHttpRequest[] = []
  readonly responses: SocialHttpResponse[]

  constructor(responses: readonly SocialHttpResponse[]) {
    this.responses = [...responses]
  }

  request(request: SocialHttpRequest) {
    this.requests.push(request)
    const response = this.responses.shift()
    return response === undefined
      ? Effect.die(new Error(`No fake response for ${request.operation}`))
      : Effect.succeed(response)
  }
}

export class ThrowingNthHttpClient implements SocialHttpClient {
  readonly requests: SocialHttpRequest[] = []
  readonly responses: SocialHttpResponse[]

  constructor(
    responses: readonly SocialHttpResponse[],
    readonly throwAtRequest: number,
  ) {
    this.responses = [...responses]
  }

  request(request: SocialHttpRequest) {
    this.requests.push(request)
    if (this.requests.length === this.throwAtRequest) {
      throw new Error(`Synchronous client failure during ${request.operation}`)
    }
    const response = this.responses.shift()
    return response === undefined
      ? Effect.die(new Error(`No fake response for ${request.operation}`))
      : Effect.succeed(response)
  }
}

export function jsonResponse(
  body: unknown,
  status = 200,
  headers: Readonly<Record<string, string>> = {},
): SocialHttpResponse {
  return Object.freeze({ status, headers, body: JSON.stringify(body) })
}

export function rawResponse(
  body: string,
  status = 200,
  headers: Readonly<Record<string, string>> = {},
): SocialHttpResponse {
  return Object.freeze({ status, headers, body })
}
