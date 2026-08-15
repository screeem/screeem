import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { AesGcmIntegrationCredentialCipher } from "../src/lib/integrations/credential-cipher"
import {
  snapshotIntegrationIdentifier,
} from "../src/lib/integrations/contract"
import {
  MemoryIntegrationConnectionStore,
  MemoryIntegrationCredentialStore,
  MemoryIntegrationExecutionStore,
  MemoryIntegrationTeamControlStore,
} from "../src/lib/integrations/memory-stores"
import { createIntegrationProviderRegistry, IntegrationResolver } from "../src/lib/integrations/provider-registry"
import { FakeSalesforceClient, SalesforceHttpClient } from "../src/lib/integrations/salesforce/client"
import {
  SalesforceError,
  salesforceProviderName,
  snapshotSalesforceAccessCredential,
  snapshotSalesforceCredential,
  snapshotSalesforceIdentityUrl,
  snapshotSalesforceInstanceUrl,
  snapshotSalesforcePublicSiteOrigin,
} from "../src/lib/integrations/salesforce/contract"
import {
  SalesforceOAuthAdapter,
  createSalesforcePkceChallenge,
  hashSalesforceOAuthState,
} from "../src/lib/integrations/salesforce/oauth"
import {
  MemorySalesforceOAuthStateStore,
  MemorySalesforceRefreshLeaseStore,
} from "../src/lib/integrations/salesforce/stores"
import { RefreshingSalesforceAccessTokenProvider } from "../src/lib/integrations/salesforce/token-provider"
import { createSalesforceProviderDefinition } from "../src/lib/integrations/salesforce/provider"

const teamId = snapshotIntegrationIdentifier("72000000-0000-0000-0000-000000000001")
const otherTeamId = snapshotIntegrationIdentifier("72000000-0000-0000-0000-000000000002")
const userId = snapshotIntegrationIdentifier("73000000-0000-0000-0000-000000000001")
const otherUserId = snapshotIntegrationIdentifier("73000000-0000-0000-0000-000000000002")
const now = "2026-08-14T10:00:00.000Z"

describe("Salesforce integration contracts", () => {
  it("seals credentials with tenant-bound authenticated encryption", async () => {
    const cipher = await cipherForTest()
    const connectionId = snapshotIntegrationIdentifier("71000000-0000-0000-0000-000000000001")
    const scope = { teamId, connectionId, provider: salesforceProviderName }
    const sealed = await cipher.seal(scope, storedCredential("token-one", "refresh-one"))

    expect(JSON.stringify(sealed)).toBe('"[REDACTED]"')
    await expect(cipher.open(scope, sealed)).resolves.toMatchObject({ accessToken: "token-one" })
    await expect(cipher.open({ ...scope, teamId: otherTeamId }, sealed)).rejects.toMatchObject({
      code: "invalid_credential",
    })
  })

  it("consumes OAuth state once and binds it to the initiating user", async () => {
    const states = new MemorySalesforceOAuthStateStore(() => new Date(now))
    const stateHash = await hashSalesforceOAuthState("x".repeat(43))
    const input = {
      stateHash,
      teamId,
      attemptId: snapshotIntegrationIdentifier("74000000-0000-0000-0000-000000000001"),
      userId,
      codeVerifier: "v".repeat(64),
      returnPath: "/dashboard/forms",
      createdAt: now,
      expiresAt: "2026-08-14T10:10:00.000Z",
    }
    await states.create(input)

    await expect(states.consume(stateHash, otherUserId)).resolves.toBeNull()
    await expect(states.consume(stateHash, userId)).resolves.toMatchObject(input)
    await expect(states.consume(stateHash, userId)).resolves.toBeNull()
  })

  it("rejects expired OAuth state", async () => {
    let current = new Date(now)
    const states = new MemorySalesforceOAuthStateStore(() => current)
    const stateHash = await hashSalesforceOAuthState("y".repeat(43))
    await states.create({
      stateHash,
      teamId,
      attemptId: snapshotIntegrationIdentifier("74000000-0000-0000-0000-000000000001"),
      userId,
      codeVerifier: "v".repeat(64),
      returnPath: "/dashboard/forms",
    })

    current = new Date("2026-08-14T10:10:00.000Z")

    await expect(states.consume(stateHash, userId)).resolves.toBeNull()
  })

  it("creates a PKCE authorization URL and accepts only trusted instance URLs", async () => {
    const oauth = new SalesforceOAuthAdapter({
      clientId: "client-id",
      loginUrl: "https://login.salesforce.com",
      callbackUrl: "http://localhost:3000/api/integrations/salesforce/callback",
    })
    const pkce = await createSalesforcePkceChallenge()
    const url = new URL(oauth.authorizationUrl("s".repeat(43), pkce.challenge))

    expect(url.origin).toBe("https://login.salesforce.com")
    expect(url.searchParams.get("code_challenge_method")).toBe("S256")
    expect(url.searchParams.get("scope")).toBe("id api refresh_token")
    expect(url.searchParams.get("scope")).not.toContain("full")
    expect(() => snapshotSalesforceInstanceUrl("https://salesforce.com.evil.invalid")).toThrow()
    expect(() => snapshotSalesforceInstanceUrl("https://attacker.force.com")).toThrow()
    expect(() => snapshotSalesforceIdentityUrl("https://attacker.force.com/id/org/user")).toThrow()
    expect(snapshotSalesforceInstanceUrl("https://acme.my.salesforce.com")).toBe(
      "https://acme.my.salesforce.com",
    )
    expect(snapshotSalesforceIdentityUrl(
      "https://test.salesforce.com/id/00D000000000001/005000000000001",
    )).toContain("test.salesforce.com")
  })

  it("requires an HTTPS public origin outside local development", () => {
    expect(snapshotSalesforcePublicSiteOrigin("https://app.screeem.example", false)).toBe(
      "https://app.screeem.example",
    )
    expect(() => snapshotSalesforcePublicSiteOrigin(
      "https://app.screeem.example/path",
      false,
    )).toThrow()
    expect(() => snapshotSalesforcePublicSiteOrigin("http://localhost:3000", false)).toThrow()
    expect(snapshotSalesforcePublicSiteOrigin("http://localhost:3000", true)).toBe(
      "http://localhost:3000",
    )
  })

  it("exchanges an authorization code without exposing provider response fields", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      access_token: "access-token",
      refresh_token: "refresh-token",
      instance_url: "https://acme.my.salesforce.com",
      id: "https://login.salesforce.com/id/00D000000000001/005000000000001",
      issued_at: "1786701600000",
      signature: "ignored",
      token_type: "Bearer",
    })))
    const oauth = new SalesforceOAuthAdapter({
      clientId: "client-id",
      loginUrl: "https://login.salesforce.com",
      callbackUrl: "http://localhost:3000/api/integrations/salesforce/callback",
    }, fetcher)

    await expect(oauth.exchange("authorization-code", "v".repeat(64))).resolves.toEqual(
      accessCredential("access-token", "refresh-token"),
    )
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ redirect: "error" })
    expect(String(fetcher.mock.calls[0]?.[1]?.body)).toContain("code_verifier=")
  })

  it("rejects an OAuth token response with an attacker-controlled instance host", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      access_token: "access-token",
      refresh_token: "refresh-token",
      instance_url: "https://salesforce.com.evil.invalid",
      id: "https://login.salesforce.com/id/00D000000000001/005000000000001",
      issued_at: "1786701600000",
    })))
    const oauth = new SalesforceOAuthAdapter({
      clientId: "client-id",
      loginUrl: "https://login.salesforce.com",
      callbackUrl: "http://localhost:3000/api/integrations/salesforce/callback",
    }, fetcher)

    await expect(oauth.exchange("authorization-code", "v".repeat(64))).rejects.toMatchObject({
      code: "invalid_provider_response",
    })
  })

  it("classifies Salesforce API exhaustion and never follows redirects", async () => {
    const tokens = {
      get: vi.fn().mockResolvedValue(accessCredential("access", "refresh")),
      refresh: vi.fn(),
    }
    const fetcher = vi.fn().mockResolvedValue(new Response(
      JSON.stringify([{ errorCode: "REQUEST_LIMIT_EXCEEDED" }]),
      { status: 403 },
    ))
    const client = new SalesforceHttpClient(tokens, vi.fn(), fetcher)

    await expect(client.testConnection()).rejects.toEqual(
      expect.objectContaining<Partial<SalesforceError>>({ code: "rate_limited", retryable: true }),
    )
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ redirect: "error" })
  })

  it("observes API limits on normal provider responses", async () => {
    const observer = vi.fn()
    const client = new SalesforceHttpClient(
      {
        get: vi.fn().mockResolvedValue(accessCredential("access", "refresh")),
        refresh: vi.fn(),
      },
      vi.fn(),
      vi.fn().mockResolvedValue(new Response(JSON.stringify({
        name: "Lead",
        label: "Lead",
        fields: [{
          name: "Source_Id__c",
          label: "Source ID",
          type: "string",
          createable: true,
          updateable: true,
          nillable: false,
          externalId: true,
          unique: true,
        }],
      }), { headers: { "Sforce-Limit-Info": "api-usage=25/100" } })),
      observer,
    )

    const description = await client.describeObject("Lead")
    expect(description.fields[0]).toMatchObject({ externalId: true, unique: true })
    expect(observer).toHaveBeenCalledWith({ remaining: 75, maximum: 100 })
  })

  it("keeps the fake and HTTP clients aligned on invalid input and cancellation", async () => {
    const fake = new FakeSalesforceClient()
    const aborted = new AbortController()
    aborted.abort()
    await expect(fake.identity(aborted.signal)).rejects.toMatchObject({ name: "AbortError" })
    await expect(fake.describeObject("bad-object!")).rejects.toMatchObject({
      code: "invalid_request",
    })
    await expect(fake.upsertRecord("Lead", "Source_Id__c", "key", { Score__c: NaN })).rejects.toMatchObject({
      code: "invalid_request",
    })

    const fetcher = vi.fn()
    const http = new SalesforceHttpClient({
      get: vi.fn().mockResolvedValue(accessCredential("access", "refresh")),
      refresh: vi.fn(),
    }, vi.fn(), fetcher)
    await expect(http.describeObject("bad-object!")).rejects.toMatchObject({
      code: "invalid_request",
    })
    await expect(http.upsertRecord("Lead", "Source_Id__c", "key", { Score__c: Infinity })).rejects.toMatchObject({
      code: "invalid_request",
    })
    const oversized = { Description: "x".repeat(256_001) }
    await expect(fake.upsertRecord("Lead", "Source_Id__c", "key", oversized)).rejects.toMatchObject({
      code: "invalid_request",
    })
    await expect(http.upsertRecord("Lead", "Source_Id__c", "key", oversized)).rejects.toMatchObject({
      code: "invalid_request",
    })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it("preserves cancellation instead of classifying it as a provider outage", async () => {
    const controller = new AbortController()
    const fetcher = vi.fn().mockImplementation(
      (_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
        if (init.signal?.aborted) {
          reject(init.signal.reason)
          return
        }
        init.signal?.addEventListener(
          "abort",
          () => reject(init.signal?.reason),
          { once: true },
        )
      }),
    )
    const client = new SalesforceHttpClient({
      get: vi.fn().mockResolvedValue(accessCredential("access", "refresh")),
      refresh: vi.fn(),
    }, vi.fn(), fetcher)

    const pending = client.identity(controller.signal)
    controller.abort(new DOMException("Cancelled", "AbortError"))

    await expect(pending).rejects.toMatchObject({ name: "AbortError" })
  })

  it("cancels an oversized chunked OAuth response before buffering it all", async () => {
    const cancelled = vi.fn()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(200_000))
        controller.enqueue(new Uint8Array(200_000))
      },
      cancel: cancelled,
    })
    const oauth = new SalesforceOAuthAdapter({
      clientId: "client-id",
      loginUrl: "https://login.salesforce.com",
      callbackUrl: "http://localhost:3000/api/integrations/salesforce/callback",
    }, vi.fn().mockResolvedValue(new Response(body)))

    await expect(oauth.exchange("authorization-code", "v".repeat(64))).rejects.toMatchObject({
      code: "invalid_provider_response",
    })
    expect(cancelled).toHaveBeenCalledOnce()
  })

  it("cancels a rejected response before retrying with a refreshed token", async () => {
    const cancelled = vi.fn()
    const rejectedBody = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array([1])) },
      cancel: cancelled,
    })
    const tokens = {
      get: vi.fn().mockResolvedValue(accessCredential("old-access", "refresh")),
      refresh: vi.fn().mockResolvedValue(accessCredential("new-access", "refresh")),
    }
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(rejectedBody, { status: 401 }))
      .mockResolvedValueOnce(new Response("{}"))
    const client = new SalesforceHttpClient(tokens, vi.fn(), fetcher)

    await expect(client.testConnection()).resolves.toEqual({ remaining: null, maximum: null })
    expect(cancelled).toHaveBeenCalledOnce()
    expect(tokens.refresh).toHaveBeenCalledWith("old-access", expect.any(AbortSignal))
  })

  it("refreshes one token across concurrent provider instances", async () => {
    const connections = new MemoryIntegrationConnectionStore()
    const credentials = new MemoryIntegrationCredentialStore(connections)
    const connection = await connections.create(teamId, {
      provider: salesforceProviderName,
      status: "connected",
      actorId: userId,
      createdAt: now,
    })
    const cipher = await cipherForTest()
    const scope = { teamId, connectionId: connection.id, provider: salesforceProviderName }
    const initial = await credentials.compareAndSet(
      teamId,
      connection.id,
      null,
      await cipher.seal(scope, storedCredential("old-access", "refresh")),
      now,
    )
    const oauth = {
      refresh: vi.fn().mockImplementation(async () => accessCredential("new-access", "refresh")),
    }
    const leases = new MemorySalesforceRefreshLeaseStore()
    const controls = new MemoryIntegrationTeamControlStore()
    const execution = new MemoryIntegrationExecutionStore(connections, controls, credentials)
    const first = await RefreshingSalesforceAccessTokenProvider.create(
      connection, initial, connections, execution, credentials, cipher, oauth as never, leases,
    )
    const second = await RefreshingSalesforceAccessTokenProvider.create(
      connection, initial, connections, execution, credentials, cipher, oauth as never, leases,
    )

    const results = await Promise.all([
      first.refresh("old-access"),
      second.refresh("old-access"),
    ])

    expect(results.map((value) => value.accessToken)).toEqual(["new-access", "new-access"])
    expect(oauth.refresh).toHaveBeenCalledTimes(1)
  })

  it("does not let a stale client adopt a later connection generation", async () => {
    const connections = new MemoryIntegrationConnectionStore()
    const credentials = new MemoryIntegrationCredentialStore(connections)
    const controls = new MemoryIntegrationTeamControlStore()
    const connection = await connections.create(teamId, {
      provider: salesforceProviderName,
      status: "connected",
      actorId: userId,
      createdAt: now,
    })
    const cipher = await cipherForTest()
    const scope = { teamId, connectionId: connection.id, provider: salesforceProviderName }
    const first = await credentials.compareAndSet(
      teamId,
      connection.id,
      null,
      await cipher.seal(scope, storedCredential("org-a", "refresh-a")),
      now,
    )
    const provider = await RefreshingSalesforceAccessTokenProvider.create(
      connection,
      first,
      connections,
      new MemoryIntegrationExecutionStore(connections, controls, credentials),
      credentials,
      cipher,
      { refresh: vi.fn() } as never,
      new MemorySalesforceRefreshLeaseStore(),
    )
    await credentials.compareAndSet(
      teamId,
      connection.id,
      first.revision,
      await cipher.seal(scope, storedCredential(
        "org-b",
        "refresh-b",
        "74000000-0000-0000-0000-000000000002",
      )),
      now,
    )

    await expect(provider.get()).rejects.toMatchObject({ code: "authentication_failed" })
  })

  it("rechecks tenant availability and records terminal refresh authentication", async () => {
    const connections = new MemoryIntegrationConnectionStore()
    const credentials = new MemoryIntegrationCredentialStore(connections)
    const controls = new MemoryIntegrationTeamControlStore()
    const connection = await connections.create(teamId, {
      provider: salesforceProviderName,
      status: "connected",
      actorId: userId,
      createdAt: now,
    })
    const cipher = await cipherForTest()
    const scope = { teamId, connectionId: connection.id, provider: salesforceProviderName }
    const stored = await credentials.compareAndSet(
      teamId,
      connection.id,
      null,
      await cipher.seal(scope, storedCredential("old-access", "revoked-refresh")),
      now,
    )
    const oauth = {
      refresh: vi.fn().mockRejectedValue(new SalesforceError("authentication_failed", false)),
    }
    const provider = await RefreshingSalesforceAccessTokenProvider.create(
      connection,
      stored,
      connections,
      new MemoryIntegrationExecutionStore(connections, controls, credentials),
      credentials,
      cipher,
      oauth as never,
      new MemorySalesforceRefreshLeaseStore(),
    )

    await expect(provider.refresh("old-access")).rejects.toMatchObject({
      code: "authentication_failed",
    })
    await expect(connections.get(teamId, connection.id)).resolves.toMatchObject({
      status: "reauthorization_required",
      health: "degraded",
      lastErrorCode: "authentication_failed",
    })

    const replacementConnection = await connections.updateAuthState(
      teamId,
      connection.id,
      2,
      {
        status: "connected",
        displayName: null,
        externalAccountId: null,
        actorId: userId,
        updatedAt: "2026-08-14T10:01:00.000Z",
      },
    )
    const replacement = await RefreshingSalesforceAccessTokenProvider.create(
      replacementConnection,
      stored,
      connections,
      new MemoryIntegrationExecutionStore(connections, controls, credentials),
      credentials,
      cipher,
      oauth as never,
      new MemorySalesforceRefreshLeaseStore(),
    )
    await controls.setEnabled(
      teamId,
      null,
      false,
      userId,
      "2026-08-14T10:02:00.000Z",
    )
    await expect(replacement.get()).rejects.toMatchObject({ code: "authentication_failed" })
  })

  it("renews refresh leases using the store clock", async () => {
    let current = new Date(now)
    const leases = new MemorySalesforceRefreshLeaseStore(() => current)
    const connectionId = snapshotIntegrationIdentifier("71000000-0000-0000-0000-000000000001")
    const ownerA = "a".repeat(43)
    const ownerB = "b".repeat(43)
    expect(await leases.acquire(teamId, connectionId, ownerA)).toBe(true)
    current = new Date("2026-08-14T10:01:30.000Z")
    expect(await leases.renew(teamId, connectionId, ownerA)).toBe(true)
    current = new Date("2026-08-14T10:02:10.000Z")
    expect(await leases.acquire(teamId, connectionId, ownerB)).toBe(false)
    current = new Date("2026-08-14T10:03:31.000Z")
    expect(await leases.acquire(teamId, connectionId, ownerB)).toBe(true)
  })

  it("does not return a refreshed token after a team kill switch changes", async () => {
    const connections = new MemoryIntegrationConnectionStore()
    const credentials = new MemoryIntegrationCredentialStore(connections)
    const controls = new MemoryIntegrationTeamControlStore()
    const connection = await connections.create(teamId, {
      provider: salesforceProviderName,
      status: "connected",
      actorId: userId,
      createdAt: now,
    })
    const cipher = await cipherForTest()
    const scope = { teamId, connectionId: connection.id, provider: salesforceProviderName }
    const stored = await credentials.compareAndSet(
      teamId,
      connection.id,
      null,
      await cipher.seal(scope, storedCredential("old-access", "refresh")),
      now,
    )
    let finishRefresh!: (value: ReturnType<typeof accessCredential>) => void
    const oauth = {
      refresh: vi.fn().mockImplementation(() => new Promise((resolve) => {
        finishRefresh = resolve
      })),
    }
    const provider = await RefreshingSalesforceAccessTokenProvider.create(
      connection,
      stored,
      connections,
      new MemoryIntegrationExecutionStore(connections, controls, credentials),
      credentials,
      cipher,
      oauth as never,
      new MemorySalesforceRefreshLeaseStore(),
    )

    const refreshing = provider.refresh("old-access")
    await vi.waitFor(() => expect(oauth.refresh).toHaveBeenCalledOnce())
    await controls.setEnabled(
      teamId,
      null,
      false,
      userId,
      "2026-08-14T10:01:00.000Z",
    )
    finishRefresh(accessCredential("new-access", "refresh"))

    await expect(refreshing).rejects.toMatchObject({ code: "authentication_failed" })
  })

  it("opens the registered provider through the shared resolver", async () => {
    const connections = new MemoryIntegrationConnectionStore()
    const credentials = new MemoryIntegrationCredentialStore(connections)
    const controls = new MemoryIntegrationTeamControlStore()
    const connection = await connections.create(teamId, {
      provider: salesforceProviderName,
      status: "connected",
      actorId: userId,
      createdAt: now,
    })
    const cipher = await cipherForTest()
    await credentials.compareAndSet(
      teamId,
      connection.id,
      null,
      await cipher.seal(
        { teamId, connectionId: connection.id, provider: salesforceProviderName },
        storedCredential("access", "refresh"),
      ),
      now,
    )
    const fetcher = vi.fn().mockResolvedValue(new Response("{}", {
      headers: { "Sforce-Limit-Info": "api-usage=2/100" },
    }))
    const observeLimits = vi.fn()
    const definition = createSalesforceProviderDefinition({
      enabled: true,
      connections,
      execution: new MemoryIntegrationExecutionStore(connections, controls, credentials),
      credentials,
      cipher,
      oauth: {
        authorizationUrl: vi.fn(),
        exchange: vi.fn(),
        refresh: vi.fn(),
        revoke: vi.fn(),
      },
      leases: new MemorySalesforceRefreshLeaseStore(),
      fetcher,
      observeLimits,
    })
    const registry = createIntegrationProviderRegistry().register(definition)
    const resolver = new IntegrationResolver(
      registry,
      connections,
      controls,
      credentials,
    )

    const resolved = await resolver.resolve(teamId, registry.reference(definition))
    await expect(resolved.client.testConnection()).resolves.toEqual({
      remaining: 98,
      maximum: 100,
    })
    expect(fetcher).toHaveBeenCalledOnce()
    expect(observeLimits).toHaveBeenCalledWith({ remaining: 98, maximum: 100 })
  })
})

function accessCredential(accessToken: string, refreshToken: string) {
  return snapshotSalesforceAccessCredential({
    accessToken,
    refreshToken,
    instanceUrl: "https://acme.my.salesforce.com",
    identityUrl: "https://login.salesforce.com/id/00D000000000001/005000000000001",
    issuedAt: now,
  })
}

function storedCredential(
  accessToken: string,
  refreshToken: string,
  generation = "74000000-0000-0000-0000-000000000001",
) {
  return snapshotSalesforceCredential({
    ...accessCredential(accessToken, refreshToken),
    generation,
  })
}

function cipherForTest() {
  return AesGcmIntegrationCredentialCipher.create(
    "test-key",
    Buffer.alloc(32, 7).toString("base64url"),
  )
}
