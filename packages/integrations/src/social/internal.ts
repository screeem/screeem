import { Effect } from "effect"

import {
  InvalidSocialProviderResponseError,
  InvalidSocialRequestError,
} from "./errors.js"
import type { SocialHttpResponse } from "./http.js"
import type { SocialCodeExchangeRequest, SocialProviderName } from "./model.js"

export function validated<Value>(
  provider: SocialProviderName,
  operation: string,
  read: () => Value,
): Effect.Effect<Value, InvalidSocialRequestError> {
  return Effect.suspend(() => {
    try {
      return Effect.succeed(read())
    } catch (error) {
      return Effect.fail(
        new InvalidSocialRequestError({
          provider,
          operation,
          reason: error instanceof Error ? error.message : "invalid input",
        }),
      )
    }
  })
}

export function decoded<Value>(
  provider: SocialProviderName,
  operation: string,
  read: () => Value,
): Effect.Effect<Value, InvalidSocialProviderResponseError> {
  return Effect.suspend(() => {
    try {
      return Effect.succeed(read())
    } catch {
      return Effect.fail(new InvalidSocialProviderResponseError({ provider, operation }))
    }
  })
}

export function boundedString(input: unknown, name: string, maximum: number): string {
  if (typeof input !== "string" || input.length === 0 || input.length > maximum) {
    throw new TypeError(`${name} is invalid`)
  }
  if (/\p{Cc}/u.test(input)) throw new TypeError(`${name} is invalid`)
  return input
}

export function secret(input: unknown, name: string): string {
  return boundedString(input, name, 16_384)
}

export function bearerTokenType(input: unknown): "Bearer" {
  const value = boundedString(input, "token type", 32)
  if (value.toLowerCase() !== "bearer") throw new TypeError("token type is invalid")
  return "Bearer"
}

export function identifier(input: unknown, name: string, maximum = 256): string {
  const value = boundedString(input, name, maximum)
  if (!/^[A-Za-z0-9._~-]+$/.test(value)) throw new TypeError(`${name} is invalid`)
  return value
}

export function oauthState(input: unknown): string {
  const value = boundedString(input, "OAuth state", 512)
  if (value.length < 16 || !/^[A-Za-z0-9._~-]+$/.test(value)) {
    throw new TypeError("OAuth state is invalid")
  }
  return value
}

export function authorizationCode(input: unknown): string {
  return boundedString(input, "authorization code", 16_384)
}

export function oauthCallback(
  input: SocialCodeExchangeRequest,
  readRedirectUri: (input: unknown) => string = redirectUri,
): { readonly code: string; readonly redirectUri: string } {
  const state = oauthState(input.state)
  const expectedState = oauthState(input.expectedState)
  if (state !== expectedState) throw new TypeError("OAuth state does not match")
  const safeRedirectUri = readRedirectUri(input.redirectUri)
  const expectedRedirectUri = readRedirectUri(input.expectedRedirectUri)
  if (safeRedirectUri !== expectedRedirectUri) {
    throw new TypeError("OAuth redirect URI does not match")
  }
  return Object.freeze({
    code: authorizationCode(input.code),
    redirectUri: safeRedirectUri,
  })
}

export function redirectUri(input: unknown): string {
  const value = boundedString(input, "redirect URI", 2_048)
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new TypeError("redirect URI is invalid")
  }
  const localHttp = url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)
  if (
    (url.protocol !== "https:" && !localHttp) ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new TypeError("redirect URI is invalid")
  }
  return url.toString()
}

export function publicMediaUrl(input: unknown): string {
  const value = boundedString(input, "media URL", 4_096)
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new TypeError("media URL is invalid")
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new TypeError("media URL must be a public HTTPS URL")
  }
  return url.toString()
}

export function nonNegativeInteger(input: unknown, name: string, maximum: number): number {
  if (!Number.isSafeInteger(input) || (input as number) < 0 || (input as number) > maximum) {
    throw new TypeError(`${name} is invalid`)
  }
  return input as number
}

export function postText(
  input: unknown,
  name: string,
  maximum: number,
  allowEmpty: boolean,
): string {
  if (typeof input !== "string" || input.length > maximum || (!allowEmpty && input.length === 0)) {
    throw new TypeError(`${name} is invalid`)
  }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(input)) {
    throw new TypeError(`${name} is invalid`)
  }
  return input
}

export function scopes(input: unknown): readonly string[] {
  const values = Array.isArray(input)
    ? input
    : typeof input === "string"
      ? input.split(/[ ,]+/)
      : []
  const result = [...new Set(values.filter(Boolean).map((value) => boundedString(value, "scope", 128)))]
  return Object.freeze(result.sort())
}

export function record(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("value is not an object")
  }
  return input as Record<string, unknown>
}

export function parseProviderJson(
  provider: SocialProviderName,
  operation: string,
  response: SocialHttpResponse,
): Effect.Effect<Record<string, unknown>, InvalidSocialProviderResponseError> {
  return Effect.suspend(() => {
    try {
      return Effect.succeed(record(parseJsonPreservingIntegers(response.body)))
    } catch {
      return Effect.fail(new InvalidSocialProviderResponseError({ provider, operation }))
    }
  })
}

function parseJsonPreservingIntegers(input: string): unknown {
  return JSON.parse(quoteUnsafeJsonIntegers(input)) as unknown
}

/**
 * JSON.parse rounds int64 values before a reviver sees them. Quote only unsafe
 * integer tokens outside JSON strings so provider identifiers remain exact.
 */
function quoteUnsafeJsonIntegers(input: string): string {
  let output = ""
  let index = 0
  while (index < input.length) {
    const character = input[index]!
    if (character === '"') {
      const start = index
      index += 1
      while (index < input.length) {
        if (input[index] === "\\") {
          index += 2
          continue
        }
        if (input[index] === '"') {
          index += 1
          break
        }
        index += 1
      }
      output += input.slice(start, index)
      continue
    }
    if (character === "-" || /\d/.test(character)) {
      const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(input.slice(index))
      if (match !== null) {
        const token = match[0]
        output += isUnsafeIntegerToken(token) ? JSON.stringify(token) : token
        index += token.length
        continue
      }
    }
    output += character
    index += 1
  }
  return output
}

function isUnsafeIntegerToken(input: string): boolean {
  if (!/^-?\d+$/.test(input)) return false
  const value = BigInt(input)
  const maximum = BigInt(Number.MAX_SAFE_INTEGER)
  return value > maximum || value < -maximum
}

export function providerErrorMessage(body: Record<string, unknown>): string {
  const nested = typeof body.error === "object" && body.error !== null
    ? body.error as Record<string, unknown>
    : null
  for (const value of [nested?.message, body.error_description, body.message]) {
    if (
      typeof value === "string" &&
      value.length > 0 &&
      value.length <= 512 &&
      !/\p{Cc}/u.test(value)
    ) {
      return value
    }
  }
  return "provider rejected the request"
}

export function providerErrorCode(body: Record<string, unknown>): string | null {
  const nested = typeof body.error === "object" && body.error !== null
    ? body.error as Record<string, unknown>
    : null
  for (const value of [nested?.code, body.error, body.code]) {
    if (typeof value === "string") {
      if (value.length > 0 && value.length <= 128 && !/\p{Cc}/u.test(value)) return value
    } else if (typeof value === "number" && Number.isSafeInteger(value)) {
      return String(value)
    }
  }
  return null
}
