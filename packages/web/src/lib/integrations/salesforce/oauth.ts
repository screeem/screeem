import "server-only"

import {
  SalesforceError,
  snapshotSalesforceAccessCredential,
  snapshotSalesforceIdentityUrl,
  snapshotSalesforceInstanceUrl,
  type SalesforceAccessCredential,
} from "./contract"
import { readBoundedSalesforceResponse, throwIfSalesforceAborted } from "./response"

export interface SalesforceOAuthConfiguration {
  readonly clientId: string
  readonly clientSecret?: string
  readonly loginUrl: string
  readonly callbackUrl: string
}

export interface SalesforcePkceChallenge {
  readonly verifier: string
  readonly challenge: string
}

export interface SalesforceOAuthClient {
  authorizationUrl(state: string, challenge: string): string
  exchange(code: string, verifier: string, signal?: AbortSignal): Promise<SalesforceAccessCredential>
  refresh(
    refreshToken: string,
    previous: SalesforceAccessCredential,
    signal?: AbortSignal,
  ): Promise<SalesforceAccessCredential>
  revoke(token: string, signal?: AbortSignal): Promise<void>
}

export class SalesforceOAuthAdapter implements SalesforceOAuthClient {
  readonly #configuration: SalesforceOAuthConfiguration

  constructor(
    configuration: SalesforceOAuthConfiguration,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.#configuration = snapshotOAuthConfiguration(configuration)
  }

  authorizationUrl(state: string, challenge: string) {
    const safeState = oauthValue(state, 256)
    const safeChallenge = oauthValue(challenge, 128)
    const url = new URL("/services/oauth2/authorize", this.#configuration.loginUrl)
    url.searchParams.set("response_type", "code")
    url.searchParams.set("client_id", this.#configuration.clientId)
    url.searchParams.set("redirect_uri", this.#configuration.callbackUrl)
    url.searchParams.set("state", safeState)
    url.searchParams.set("scope", "id api refresh_token")
    url.searchParams.set("code_challenge", safeChallenge)
    url.searchParams.set("code_challenge_method", "S256")
    return url.toString()
  }

  async exchange(code: string, verifier: string, signal?: AbortSignal) {
    return this.token(
      {
        grant_type: "authorization_code",
        code: oauthValue(code, 2_048),
        code_verifier: oauthValue(verifier, 128),
        redirect_uri: this.#configuration.callbackUrl,
      },
      null,
      signal,
    )
  }

  async refresh(refreshToken: string, previous: SalesforceAccessCredential, signal?: AbortSignal) {
    return this.token(
      { grant_type: "refresh_token", refresh_token: oauthValue(refreshToken, 16_384) },
      previous.refreshToken,
      signal,
    )
  }

  async revoke(token: string, signal?: AbortSignal) {
    const body = new URLSearchParams({ token: oauthValue(token, 16_384) })
    const operationSignal = boundedSignal(signal)
    let response: Response
    try {
      response = await this.fetcher(new URL("/services/oauth2/revoke", this.#configuration.loginUrl), {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        redirect: "error",
        signal: operationSignal,
      })
    } catch (error) {
      throwIfSalesforceAborted(operationSignal, error)
      throw new SalesforceError("provider_unavailable", true)
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)
      throw classifyOAuthFailure(response.status)
    }
  }

  private async token(
    parameters: Record<string, string>,
    retainedRefreshToken: string | null,
    signal?: AbortSignal,
  ) {
    const body = new URLSearchParams({ client_id: this.#configuration.clientId, ...parameters })
    if (this.#configuration.clientSecret) body.set("client_secret", this.#configuration.clientSecret)
    const operationSignal = boundedSignal(signal)
    let response: Response
    try {
      response = await this.fetcher(new URL("/services/oauth2/token", this.#configuration.loginUrl), {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        redirect: "error",
        signal: operationSignal,
      })
    } catch (error) {
      throwIfSalesforceAborted(operationSignal, error)
      throw new SalesforceError("provider_unavailable", true)
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)
      throw classifyOAuthFailure(response.status)
    }
    const value = await boundedJson(response, operationSignal)
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new SalesforceError("invalid_provider_response", true)
    }
    const token = value as Record<string, unknown>
    const refreshToken = token.refresh_token ?? retainedRefreshToken
    try {
      return snapshotSalesforceAccessCredential({
        accessToken: token.access_token,
        refreshToken,
        instanceUrl: snapshotSalesforceInstanceUrl(token.instance_url),
        identityUrl: snapshotSalesforceIdentityUrl(token.id),
        issuedAt: issuedAt(token.issued_at),
      })
    } catch {
      throw new SalesforceError("invalid_provider_response", true)
    }
  }
}

export async function createSalesforcePkceChallenge(): Promise<SalesforcePkceChallenge> {
  const verifier = encodeBase64Url(crypto.getRandomValues(new Uint8Array(64)))
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
  return Object.freeze({ verifier, challenge: encodeBase64Url(new Uint8Array(digest)) })
}

export function createSalesforceOAuthStateToken() {
  return encodeBase64Url(crypto.getRandomValues(new Uint8Array(32)))
}

export async function hashSalesforceOAuthState(state: string) {
  const value = oauthValue(state, 256)
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  return encodeBase64Url(new Uint8Array(digest))
}

function snapshotOAuthConfiguration(input: SalesforceOAuthConfiguration): SalesforceOAuthConfiguration {
  const clientId = oauthValue(input.clientId, 512)
  const clientSecret = input.clientSecret === undefined ? undefined : oauthValue(input.clientSecret, 512)
  const loginUrl = loginOrigin(input.loginUrl)
  const callback = new URL(input.callbackUrl)
  if (
    (callback.protocol !== "https:" && !(callback.protocol === "http:" && ["localhost", "127.0.0.1"].includes(callback.hostname))) ||
    callback.username || callback.password || callback.hash
  ) {
    throw new TypeError("Invalid Salesforce callback URL")
  }
  return Object.freeze({ clientId, clientSecret, loginUrl, callbackUrl: callback.toString() })
}

function loginOrigin(input: string) {
  const url = new URL(input)
  if (
    url.protocol !== "https:" ||
    url.username || url.password || url.port || url.pathname !== "/" || url.search || url.hash ||
    !["login.salesforce.com", "test.salesforce.com"].includes(url.hostname.toLowerCase())
  ) {
    throw new TypeError("Invalid Salesforce login URL")
  }
  return url.origin
}

function issuedAt(input: unknown) {
  if (typeof input !== "string" || !/^\d{10,17}$/.test(input)) {
    throw new TypeError("Invalid Salesforce issued time")
  }
  const milliseconds = Number(input)
  if (!Number.isSafeInteger(milliseconds)) throw new TypeError("Invalid Salesforce issued time")
  return new Date(milliseconds).toISOString()
}

function oauthValue(input: unknown, maximum: number) {
  if (typeof input !== "string" || input.length === 0 || input.length > maximum) {
    throw new TypeError("Invalid Salesforce OAuth value")
  }
  return input
}

function classifyOAuthFailure(status: number) {
  if (status === 400 || status === 401) return new SalesforceError("authentication_failed", false)
  if (status === 403) return new SalesforceError("authorization_failed", false)
  if (status === 429) return new SalesforceError("rate_limited", true)
  return new SalesforceError("provider_unavailable", status >= 500)
}

async function boundedJson(response: Response, signal?: AbortSignal) {
  const text = await readBoundedSalesforceResponse(response, 256_000, signal)
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new SalesforceError("invalid_provider_response", true)
  }
}

function boundedSignal(parent?: AbortSignal) {
  return parent ? AbortSignal.any([parent, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000)
}

function encodeBase64Url(value: Uint8Array) {
  return Buffer.from(value).toString("base64url")
}
