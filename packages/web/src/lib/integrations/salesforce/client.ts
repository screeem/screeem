import "server-only"

import {
  SalesforceError,
  salesforceApiVersion,
  snapshotSalesforceIdentity,
  snapshotSalesforceIdentityResponse,
  type SalesforceApiLimits,
  type SalesforceAccessCredential,
  type SalesforceIdentity,
  type SalesforceObjectDescription,
  type SalesforceUpsertResult,
} from "./contract"
import { readBoundedSalesforceResponse, throwIfSalesforceAborted } from "./response"
import {
  IntegrationOperationError,
} from "../action-contract"
import type { CrmLeadWriter, CrmUpsertLeadInput, CrmOperationContext } from "../crm/contract"
import { integrationErrorCodeForSalesforce } from "./contract"

export interface SalesforceAccessTokenProvider {
  get(signal?: AbortSignal): Promise<SalesforceAccessCredential>
  refresh(rejectedAccessToken: string, signal?: AbortSignal): Promise<SalesforceAccessCredential>
}

export interface SalesforceClient extends CrmLeadWriter {
  identity(signal?: AbortSignal): Promise<SalesforceIdentity>
  testConnection(signal?: AbortSignal): Promise<SalesforceApiLimits>
  describeObject(objectName: string, signal?: AbortSignal): Promise<SalesforceObjectDescription>
  upsertRecord(
    objectName: string,
    externalIdField: string,
    externalId: string,
    values: Readonly<Record<string, unknown>>,
    signal?: AbortSignal,
  ): Promise<SalesforceUpsertResult>
  revoke(signal?: AbortSignal): Promise<void>
}

export type SalesforceApiLimitObserver = (limits: SalesforceApiLimits) => void | Promise<void>

export class SalesforceHttpClient implements SalesforceClient {
  constructor(
    private readonly tokens: SalesforceAccessTokenProvider,
    private readonly revokeToken: (token: string, signal?: AbortSignal) => Promise<void>,
    private readonly fetcher: typeof fetch = fetch,
    private readonly observeLimits?: SalesforceApiLimitObserver,
    private readonly crmLeadExternalIdField?: string,
  ) {}

  async upsertLead(input: CrmUpsertLeadInput, context: CrmOperationContext) {
    let externalIdField: string
    try {
      externalIdField = snapshotSalesforceApiName(this.crmLeadExternalIdField ?? "")
    } catch {
      throw new IntegrationOperationError("invalid_configuration", false)
    }
    try {
      return await this.upsertRecord(
        "Lead",
        externalIdField,
        context.externalId,
        { LastName: input.lastName, Company: input.company, Email: input.email },
        context.signal,
      )
    } catch (error) {
      if (error instanceof IntegrationOperationError) throw error
      if (error instanceof SalesforceError) {
        throw new IntegrationOperationError(
          integrationErrorCodeForSalesforce(error),
          error.retryable,
          error.retryAfterMs,
        )
      }
      throw new IntegrationOperationError("unknown", true)
    }
  }

  async identity(signal?: AbortSignal) {
    const response = await this.authorizedFetch((credential) => credential.identityUrl, {}, signal)
    return snapshotSalesforceIdentityResponse(await responseJson(response, signal))
  }

  async testConnection(signal?: AbortSignal) {
    const response = await this.instanceRequest(`/services/data/${salesforceApiVersion}/limits`, {}, signal)
    await responseJson(response, signal)
    return parseLimits(response.headers.get("sforce-limit-info"))
  }

  async describeObject(objectName: string, signal?: AbortSignal) {
    const safeObject = snapshotSalesforceApiName(objectName)
    const response = await this.instanceRequest(
      `/services/data/${salesforceApiVersion}/sobjects/${safeObject}/describe`,
      {},
      signal,
    )
    return snapshotDescription(await responseJson(response, signal))
  }

  async upsertRecord(
    objectName: string,
    externalIdField: string,
    externalId: string,
    values: Readonly<Record<string, unknown>>,
    signal?: AbortSignal,
  ) {
    const safeObject = snapshotSalesforceApiName(objectName)
    const safeField = snapshotSalesforceApiName(externalIdField)
    const safeExternalId = externalIdentifier(externalId)
    const { body } = snapshotUpsertValues(values)
    const response = await this.instanceRequest(
      `/services/data/${salesforceApiVersion}/sobjects/${safeObject}/${safeField}/${encodeURIComponent(safeExternalId)}`,
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body },
      signal,
    )
    if (response.status === 204) return Object.freeze({ id: null, created: false })
    const value = await responseJson(response, signal)
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new SalesforceError("invalid_provider_response", true)
    }
    const result = value as Record<string, unknown>
    if (typeof result.id !== "string" || result.id.length === 0 || result.id.length > 128) {
      throw new SalesforceError("invalid_provider_response", true)
    }
    return Object.freeze({ id: result.id, created: true })
  }

  async revoke(signal?: AbortSignal) {
    const credential = await this.tokens.get(signal)
    await this.revokeToken(credential.refreshToken, signal)
  }

  private async instanceRequest(path: string, init: RequestInit, signal?: AbortSignal) {
    return this.authorizedFetch(
      (credential) => new URL(path, credential.instanceUrl),
      init,
      signal,
    )
  }

  private async authorizedFetch(
    url: (credential: SalesforceAccessCredential) => string | URL,
    init: RequestInit,
    signal?: AbortSignal,
  ) {
    const operationSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(15_000)])
      : AbortSignal.timeout(15_000)
    let credential = await this.tokens.get(operationSignal)
    let response = await this.fetchOnce(url(credential), init, credential.accessToken, operationSignal)
    if (response.status === 401) {
      await response.body?.cancel().catch(() => undefined)
      credential = await this.tokens.refresh(credential.accessToken, operationSignal)
      response = await this.fetchOnce(url(credential), init, credential.accessToken, operationSignal)
    }
    if (!response.ok) throw await classifyResponse(response, operationSignal)
    if (this.observeLimits) {
      await Promise.resolve(
        this.observeLimits(parseLimits(response.headers.get("sforce-limit-info"))),
      ).catch(() => undefined)
    }
    return response
  }

  private async fetchOnce(url: string | URL, init: RequestInit, token: string, signal?: AbortSignal) {
    const headers = new Headers(init.headers)
    headers.set("Authorization", `Bearer ${token}`)
    try {
      return await this.fetcher(url, {
        ...init,
        headers,
        redirect: "error",
        signal,
      })
    } catch (error) {
      throwIfSalesforceAborted(signal, error)
      throw new SalesforceError("provider_unavailable", true)
    }
  }
}

export class FakeSalesforceClient implements SalesforceClient {
  readonly calls: string[] = []
  readonly upserts: Array<Readonly<{
    objectName: string
    externalIdField: string
    externalId: string
    values: Readonly<Record<string, unknown>>
  }>> = []

  constructor(
    private readonly identityValue: SalesforceIdentity = snapshotSalesforceIdentity({
      organizationId: "00D000000000001",
      userId: "005000000000001",
      displayName: "Test User",
      username: "test@example.invalid",
    }),
  ) {}

  async identity(signal?: AbortSignal) {
    throwIfSalesforceAborted(signal)
    this.calls.push("identity")
    return this.identityValue
  }

  async upsertLead(input: CrmUpsertLeadInput, context: CrmOperationContext) {
    return this.upsertRecord(
      "Lead",
      "Screeem_Delivery_Key__c",
      context.externalId,
      { LastName: input.lastName, Company: input.company, Email: input.email },
      context.signal,
    )
  }

  async testConnection(signal?: AbortSignal) {
    throwIfSalesforceAborted(signal)
    this.calls.push("testConnection")
    return Object.freeze({ remaining: 10_000, maximum: 15_000 })
  }

  async describeObject(objectName: string, signal?: AbortSignal) {
    throwIfSalesforceAborted(signal)
    const safeObject = snapshotSalesforceApiName(objectName)
    this.calls.push(`describeObject:${safeObject}`)
    return Object.freeze({ name: safeObject, label: safeObject, fields: Object.freeze([]) })
  }

  async upsertRecord(
    objectName: string,
    externalIdField: string,
    externalId: string,
    values: Readonly<Record<string, unknown>>,
    signal?: AbortSignal,
  ) {
    throwIfSalesforceAborted(signal)
    const safeObject = snapshotSalesforceApiName(objectName)
    const safeField = snapshotSalesforceApiName(externalIdField)
    const safeExternalId = externalIdentifier(externalId)
    const { values: safeValues } = snapshotUpsertValues(values)
    this.calls.push(`upsertRecord:${safeObject}:${safeField}:${safeExternalId}`)
    this.upserts.push(Object.freeze({
      objectName: safeObject,
      externalIdField: safeField,
      externalId: safeExternalId,
      values: safeValues,
    }))
    return Object.freeze({ id: "00Q000000000001", created: true })
  }

  async revoke(signal?: AbortSignal) {
    throwIfSalesforceAborted(signal)
    this.calls.push("revoke")
  }
}

export function snapshotSalesforceApiName(input: string) {
  if (!/^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(input)) {
    throw new SalesforceError("invalid_request", false)
  }
  return input
}

function externalIdentifier(input: string) {
  if (typeof input !== "string" || input.length === 0 || input.length > 512) {
    throw new SalesforceError("invalid_request", false)
  }
  return input
}

function snapshotDescription(input: unknown): SalesforceObjectDescription {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new SalesforceError("invalid_provider_response", true)
  }
  const value = input as Record<string, unknown>
  if (typeof value.name !== "string" || typeof value.label !== "string" || !Array.isArray(value.fields) || value.fields.length > 2_000) {
    throw new SalesforceError("invalid_provider_response", true)
  }
  const fields = value.fields.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new SalesforceError("invalid_provider_response", true)
    const field = entry as Record<string, unknown>
    if (
      typeof field.name !== "string" || typeof field.label !== "string" || typeof field.type !== "string" ||
      typeof field.createable !== "boolean" || typeof field.updateable !== "boolean" ||
      typeof field.nillable !== "boolean" || typeof field.externalId !== "boolean" ||
      typeof field.unique !== "boolean"
    ) throw new SalesforceError("invalid_provider_response", true)
    return Object.freeze({
      name: snapshotSalesforceApiName(field.name),
      label: bounded(field.label, 160),
      type: bounded(field.type, 64),
      createable: field.createable,
      updateable: field.updateable,
      nillable: field.nillable,
      externalId: field.externalId,
      unique: field.unique,
    })
  })
  return Object.freeze({
    name: snapshotSalesforceApiName(value.name),
    label: bounded(value.label, 160),
    fields: Object.freeze(fields),
  })
}

function snapshotRecordValues(input: Readonly<Record<string, unknown>>) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new SalesforceError("invalid_request", false)
  const descriptors = Object.getOwnPropertyDescriptors(input)
  if (Object.keys(descriptors).length > 200 || Object.getOwnPropertySymbols(input).length > 0) {
    throw new SalesforceError("invalid_request", false)
  }
  const result: Record<string, unknown> = Object.create(null)
  for (const [name, descriptor] of Object.entries(descriptors)) {
    snapshotSalesforceApiName(name)
    if (!("value" in descriptor)) throw new SalesforceError("invalid_request", false)
    const value = descriptor.value
    if (
      value !== null &&
      !["string", "number", "boolean"].includes(typeof value)
    ) {
      throw new SalesforceError("invalid_request", false)
    }
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new SalesforceError("invalid_request", false)
    }
    result[name] = value
  }
  return result
}

function snapshotUpsertValues(input: Readonly<Record<string, unknown>>) {
  const values = Object.freeze(snapshotRecordValues(input))
  const body = JSON.stringify(values)
  if (new TextEncoder().encode(body).byteLength > 256_000) {
    throw new SalesforceError("invalid_request", false)
  }
  return { values, body }
}

async function responseJson(response: Response, signal?: AbortSignal) {
  const text = await readBoundedSalesforceResponse(response, 2_000_000, signal)
  try {
    return text.length === 0 ? null : JSON.parse(text) as unknown
  } catch {
    throw new SalesforceError("invalid_provider_response", true)
  }
}

function parseLimits(input: string | null): SalesforceApiLimits {
  const match = input?.match(/api-usage=(\d+)\/(\d+)/i)
  if (!match) return Object.freeze({ remaining: null, maximum: null })
  const used = Number(match[1])
  const maximum = Number(match[2])
  if (
    !Number.isSafeInteger(used) || !Number.isSafeInteger(maximum) ||
    used < 0 || maximum < 0
  ) return Object.freeze({ remaining: null, maximum: null })
  return Object.freeze({ remaining: Math.max(0, maximum - used), maximum })
}

async function classifyResponse(response: Response, signal?: AbortSignal) {
  const retryAfter = retryAfterMs(response.headers.get("retry-after"))
  if (response.status === 401) {
    await response.body?.cancel().catch(() => undefined)
    return new SalesforceError("authentication_failed", false)
  }
  if (response.status === 403) {
    const providerRateLimit = await hasErrorCode(response, "REQUEST_LIMIT_EXCEEDED", signal)
    return new SalesforceError(
      providerRateLimit || retryAfter !== null ? "rate_limited" : "authorization_failed",
      providerRateLimit || retryAfter !== null,
      retryAfter,
    )
  }
  await response.body?.cancel().catch(() => undefined)
  if (response.status === 429) return new SalesforceError("rate_limited", true, retryAfter)
  if (response.status >= 500) return new SalesforceError("provider_unavailable", true, retryAfter)
  return new SalesforceError("invalid_request", false)
}

async function hasErrorCode(response: Response, expected: string, signal?: AbortSignal) {
  const text = await readBoundedSalesforceResponse(response, 64_000, signal)
  try {
    const value = JSON.parse(text) as unknown
    return Array.isArray(value) && value.some(
      (entry) => entry && typeof entry === "object" &&
        (entry as Record<string, unknown>).errorCode === expected,
    )
  } catch {
    return false
  }
}

function retryAfterMs(input: string | null) {
  if (!input) return null
  const seconds = Number(input)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1_000, 3_600_000)
  const date = new Date(input).getTime()
  return Number.isFinite(date) ? Math.max(0, Math.min(date - Date.now(), 3_600_000)) : null
}

function bounded(input: string, maximum: number) {
  if (input.length === 0 || input.length > maximum) throw new SalesforceError("invalid_provider_response", true)
  return input
}
