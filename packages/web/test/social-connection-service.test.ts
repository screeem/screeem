import { afterEach, describe, expect, it, vi } from "vitest"
import { SocialAuthorizationError } from "@screeem/integrations/social"

vi.mock("server-only", () => ({}))

import type {
  SocialCredential,
  SupportedSocialProviderName,
} from "../src/lib/integrations/social/contract"
import {
  snapshotIntegrationConnection,
  snapshotIntegrationIdentifier,
  snapshotIntegrationProviderName,
  snapshotIntegrationTeamControl,
} from "../src/lib/integrations/contract"
import { SealedIntegrationCredential } from "../src/lib/integrations/stores"
import { IntegrationExternalAccountConflictError } from "../src/lib/integrations/provisioning-store"
import { snapshotSocialReturnPath } from "../src/lib/integrations/social/contract"
import { SocialAccountSwitchError, SocialConnectionService } from "../src/lib/integrations/social/service"
import { MemorySocialOAuthStateStore } from "../src/lib/integrations/social/stores"
import { socialEnvironmentConfigured } from "../src/lib/integrations/social/server"

const teamId = snapshotIntegrationIdentifier("72000000-0000-0000-0000-000000000001")
const userId = snapshotIntegrationIdentifier("73000000-0000-0000-0000-000000000001")
const connectionId = snapshotIntegrationIdentifier("71000000-0000-0000-0000-000000000001")
const attemptId = snapshotIntegrationIdentifier("74000000-0000-0000-0000-000000000001")
const now = "2026-08-31T12:00:00.000Z"
const callbackUri = "https://app.screeem.com/api/integrations/instagram/callback"

afterEach(() => vi.unstubAllEnvs())

describe("social connection service", () => {
  it("stores and consumes one exact redirect-bound authorization state", async () => {
    const fixture = createFixture()
    const started = await fixture.service.begin(teamId, userId, "/dashboard/integrations")
    const stateToken = new URL(started.authorizationUrl).searchParams.get("state")!

    const state = await fixture.service.consumeState(stateToken, userId)

    expect(state).toMatchObject({
      provider: "instagram",
      teamId,
      userId,
      redirectUri: callbackUri,
      returnPath: "/dashboard/integrations",
    })
    await expect(fixture.service.consumeState(stateToken, userId)).resolves.toBeNull()
  })

  it("commits an encrypted credential envelope with absolute expiry metadata", async () => {
    const fixture = createFixture()
    const state = socialState()

    await expect(fixture.service.complete(state, "s".repeat(43), "provider-code")).resolves.toMatchObject({
      status: "connected",
    })

    const sealInput = fixture.cipher.seal.mock.calls[0]
    const scope = sealInput[0] as { readonly connectionId: string }
    expect(scope).toEqual({
      teamId,
      connectionId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      provider: "instagram",
    })
    expect(fixture.provisioning.connect).toHaveBeenCalledWith(
      teamId,
      expect.objectContaining({ connectionId: scope.connectionId }),
    )
    expect(sealInput[1]).toMatchObject({
      version: 1,
      generation: attemptId,
      issuedAt: now,
      accessExpiresAt: "2026-10-30T12:00:00.000Z",
      refreshExpiresAt: null,
      refreshEligibleAt: "2026-09-01T12:00:00.000Z",
      credential: { provider: "instagram", accountId: "account-one" },
    })
    expect(fixture.provider.exchangeCode).toHaveBeenCalledWith({
      code: "provider-code",
      redirectUri: callbackUri,
      expectedRedirectUri: callbackUri,
      state: "s".repeat(43),
      expectedState: "s".repeat(43),
    })
  })

  it("requires disconnect before switching a connected external account", async () => {
    const fixture = createFixture({ existing: connection({ externalAccountId: "account-old" }) })
    fixture.provider.exchangeCode.mockResolvedValueOnce(connectedAccount("account-new"))

    await expect(fixture.service.complete(socialState(), "s".repeat(43), "code"))
      .rejects.toBeInstanceOf(SocialAccountSwitchError)
    expect(fixture.provider.revokeCredential).not.toHaveBeenCalled()
    expect(fixture.provisioning.connect).not.toHaveBeenCalled()
  })

  it("does not revoke a grant already owned by another team", async () => {
    const fixture = createFixture()
    fixture.provisioning.connect.mockRejectedValueOnce(
      new IntegrationExternalAccountConflictError(snapshotIntegrationProviderName("instagram"), "global"),
    )

    await expect(fixture.service.complete(socialState(), "s".repeat(43), "code"))
      .rejects.toMatchObject({ scope: "global" })
    expect(fixture.provider.revokeCredential).not.toHaveBeenCalled()
  })

  it("does not revoke the live grant when same-account reconnect provisioning fails", async () => {
    const fixture = createFixture({ existing: connection({ externalAccountId: "account-one" }) })
    fixture.provisioning.connect.mockRejectedValueOnce(new Error("database unavailable"))

    await expect(fixture.service.complete(socialState(), "s".repeat(43), "code"))
      .rejects.toThrow("database unavailable")
    expect(fixture.provider.revokeCredential).not.toHaveBeenCalled()
  })

  it("keeps the disabled credential retryable when provider revocation fails", async () => {
    const fixture = createFixture()
    fixture.provisioning.beginDisconnect.mockResolvedValue({
      connection: connection({ status: "disconnecting", enabled: false, revision: 2 }),
      credential: storedCredential(),
    })
    fixture.provider.revokeCredential.mockRejectedValueOnce(new Error("provider unavailable"))

    await expect(fixture.service.disconnect(teamId, userId)).rejects.toThrow("provider unavailable")
    expect(fixture.provisioning.completeDisconnect).not.toHaveBeenCalled()
  })

  it("revokes remotely before deleting the retained local credential", async () => {
    const events: string[] = []
    const fixture = createFixture()
    let beginCalls = 0
    fixture.provisioning.beginDisconnect.mockImplementation(async () => {
      events.push(beginCalls++ === 0 ? "disable" : "reload")
      return {
        connection: connection({ status: "disconnecting", enabled: false, revision: 2 }),
        credential: storedCredential(),
      }
    })
    fixture.provider.revokeCredential.mockImplementationOnce(async () => {
      events.push("revoke")
      return { status: "revoked" as const }
    })
    fixture.provisioning.completeDisconnect.mockImplementationOnce(async () => {
      events.push("delete")
      return connection({ status: "disconnected", enabled: false, revision: 3 })
    })

    await fixture.service.disconnect(teamId, userId)

    expect(events).toEqual(["disable", "reload", "revoke", "delete"])
  })

  it("finishes local disconnect when the provider confirms the grant is already inactive", async () => {
    const fixture = createFixture()
    fixture.provisioning.beginDisconnect.mockResolvedValue({
      connection: connection({ status: "disconnecting", enabled: false, revision: 2 }),
      credential: storedCredential(),
    })
    fixture.provider.revokeCredential.mockRejectedValueOnce(new SocialAuthorizationError({
      provider: "instagram",
      reason: "grant inactive",
      providerCode: "190",
      reauthorize: true,
      grantInactive: false,
    }))
    fixture.provisioning.completeDisconnect.mockResolvedValueOnce(
      connection({ status: "disconnected", enabled: false, revision: 3 }),
    )

    await expect(fixture.service.disconnect(teamId, userId)).resolves.toMatchObject({
      connection: { status: "disconnected" },
      providerAccessRemoved: false,
    })
  })

  it("refreshes an expired credential before revoking it", async () => {
    const fixture = createFixture()
    const refreshed = { ...instagramCredential(), accessToken: "refreshed-access-token" }
    fixture.provisioning.beginDisconnect.mockResolvedValue({
      connection: connection({ status: "disconnecting", enabled: false, revision: 2 }),
      credential: storedCredential(),
    })
    fixture.cipher.open.mockResolvedValueOnce({
      ...storedEnvelope(),
      issuedAt: "2026-08-30T11:00:00.000Z",
      accessExpiresAt: "2026-08-31T11:59:00.000Z",
      refreshEligibleAt: "2026-08-31T11:00:00.000Z",
    })
    fixture.provider.refreshCredential.mockResolvedValueOnce(refreshed)
    fixture.provisioning.completeDisconnect.mockResolvedValueOnce(
      connection({ status: "disconnected", enabled: false, revision: 3 }),
    )

    await fixture.service.disconnect(teamId, userId)

    expect(fixture.provider.refreshCredential).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: "access-token" }),
    )
    expect(fixture.provisioning.updateDisconnectCredential).toHaveBeenCalledWith(
      teamId,
      connectionId,
      2,
      1,
      expect.any(SealedIntegrationCredential),
      userId,
      now,
    )
    expect(fixture.disconnectLeases.acquire).toHaveBeenCalledOnce()
    expect(fixture.disconnectLeases.release).toHaveBeenCalledOnce()
    expect(fixture.provider.revokeCredential).toHaveBeenCalledWith(refreshed)
  })

  it("refreshes TikTok after an early-invalid access token before local cleanup", async () => {
    const fixture = createFixture({ provider: "tiktok" })
    const refreshed = { ...tiktokCredential(), accessToken: "refreshed-tiktok-access" }
    fixture.provisioning.beginDisconnect.mockResolvedValue({
      connection: connection({
        provider: "tiktok",
        externalAccountId: "tiktok-account",
        status: "disconnecting",
        enabled: false,
        revision: 2,
      }),
      credential: storedCredential(),
    })
    fixture.cipher.open.mockResolvedValueOnce(tiktokStoredEnvelope())
    fixture.provider.revokeCredential.mockRejectedValueOnce(new SocialAuthorizationError({
      provider: "tiktok",
      reason: "access token invalid",
      providerCode: "access_token_invalid",
      reauthorize: true,
      grantInactive: false,
    }))
    fixture.provider.refreshCredential.mockResolvedValueOnce(refreshed)
    fixture.provisioning.completeDisconnect.mockResolvedValueOnce(
      connection({
        provider: "tiktok",
        externalAccountId: "tiktok-account",
        status: "disconnected",
        enabled: false,
        revision: 3,
      }),
    )

    await expect(fixture.service.disconnect(teamId, userId)).resolves.toMatchObject({
      connection: { status: "disconnected" },
      providerAccessRemoved: true,
    })
    expect(fixture.provider.refreshCredential).toHaveBeenCalledOnce()
    expect(fixture.disconnectLeases.acquire).toHaveBeenCalledOnce()
    expect(fixture.disconnectLeases.release).toHaveBeenCalledOnce()
    expect(fixture.provisioning.updateDisconnectCredential).toHaveBeenCalledOnce()
    expect(fixture.provider.revokeCredential).toHaveBeenCalledTimes(2)
  })

  it("claims a disconnect refresh lease before contacting the provider", async () => {
    const fixture = createFixture()
    fixture.provisioning.beginDisconnect.mockResolvedValue({
      connection: connection({ status: "disconnecting", enabled: false, revision: 2 }),
      credential: storedCredential(),
    })
    fixture.cipher.open.mockResolvedValueOnce({
      ...storedEnvelope(),
      issuedAt: "2026-08-30T11:00:00.000Z",
      accessExpiresAt: "2026-08-31T11:59:00.000Z",
      refreshEligibleAt: "2026-08-31T11:00:00.000Z",
    })
    fixture.disconnectLeases.acquire.mockResolvedValueOnce(false)

    await expect(fixture.service.disconnect(teamId, userId)).rejects.toThrow(
      "refresh is already in progress",
    )
    expect(fixture.provider.refreshCredential).not.toHaveBeenCalled()
    expect(fixture.provisioning.updateDisconnectCredential).not.toHaveBeenCalled()
  })

  it("stops before provider mutation when disconnect lease ownership is lost", async () => {
    const fixture = createFixture()
    fixture.provisioning.beginDisconnect.mockResolvedValue({
      connection: connection({ status: "disconnecting", enabled: false, revision: 2 }),
      credential: storedCredential(),
    })
    fixture.disconnectLeases.renew.mockResolvedValueOnce(false)

    await expect(fixture.service.disconnect(teamId, userId)).rejects.toThrow(
      "refresh is already in progress",
    )
    expect(fixture.provider.revokeCredential).not.toHaveBeenCalled()
    expect(fixture.provisioning.completeDisconnect).not.toHaveBeenCalled()
    expect(fixture.disconnectLeases.release).toHaveBeenCalledOnce()
  })

  it("reloads the disconnecting credential after acquiring the lease", async () => {
    const fixture = createFixture()
    const currentCredential = storedCredential({
      credential: SealedIntegrationCredential.create("test-key", "v1.c.d"),
      revision: 2,
    })
    fixture.provisioning.beginDisconnect.mockResolvedValue({
      connection: connection({ status: "disconnecting", enabled: false, revision: 2 }),
      credential: currentCredential,
    })
    fixture.cipher.open.mockResolvedValueOnce({
      ...storedEnvelope(),
      credential: { ...instagramCredential(), accessToken: "current-access-token" },
    })
    fixture.provisioning.completeDisconnect.mockResolvedValueOnce(
      connection({ status: "disconnected", enabled: false, revision: 3 }),
    )

    await fixture.service.finishDisconnect(teamId, userId, {
      connection: connection({ status: "disconnecting", enabled: false, revision: 2 }),
      credential: storedCredential(),
    })

    expect(fixture.cipher.open).toHaveBeenCalledWith(
      expect.objectContaining({ connectionId }),
      currentCredential.credential,
    )
    expect(fixture.provider.revokeCredential).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: "current-access-token" }),
    )
    expect(fixture.provisioning.completeDisconnect).toHaveBeenCalledWith(
      teamId,
      connectionId,
      2,
      2,
      userId,
      now,
    )
    expect(fixture.disconnectLeases.renew).toHaveBeenCalled()
  })

  it("removes an unusable local credential instead of leaving disconnect stuck", async () => {
    const fixture = createFixture()
    fixture.provisioning.beginDisconnect.mockResolvedValue({
      connection: connection({ status: "disconnecting", enabled: false, revision: 2 }),
      credential: storedCredential(),
    })
    fixture.cipher.open.mockRejectedValueOnce(new Error("credential key unavailable"))
    fixture.provisioning.completeDisconnect.mockResolvedValueOnce(
      connection({ status: "disconnected", enabled: false, revision: 3 }),
    )

    await expect(fixture.service.disconnect(teamId, userId)).resolves.toMatchObject({
      connection: { status: "disconnected" },
      providerAccessRemoved: false,
    })
    expect(fixture.provider.revokeCredential).not.toHaveBeenCalled()
  })

  it("accepts a committed connection when the provisioning acknowledgement is lost", async () => {
    const fixture = createFixture()
    fixture.provisioning.connect.mockRejectedValueOnce(new Error("connection dropped"))
    fixture.execution.load.mockImplementationOnce(async (_team, id) => ({
      connection: connection({ id }),
      control: snapshotIntegrationTeamControl({
        teamId,
        revision: null,
        enabled: true,
        disabledBy: null,
        disabledAt: null,
        updatedBy: null,
        updatedAt: null,
      }),
      credential: { ...storedCredential(), connectionId: id },
    }))

    await expect(fixture.service.complete(socialState(), "s".repeat(43), "code"))
      .resolves.toMatchObject({ status: "connected" })
  })

  it("rejects a provider response whose credential belongs to another account", async () => {
    const fixture = createFixture()
    fixture.provider.exchangeCode.mockResolvedValueOnce({
      ...connectedAccount("account-one"),
      credential: instagramCredential("account-two"),
    })

    await expect(fixture.service.complete(socialState(), "s".repeat(43), "code"))
      .rejects.toThrow("mismatched account credentials")
    expect(fixture.provisioning.connect).not.toHaveBeenCalled()
  })

  it("rejects return paths that can be parsed as a different authority", () => {
    expect(() => snapshotSocialReturnPath("/\\evil.example/path")).toThrow(
      "Invalid integration return path",
    )
    expect(() => snapshotSocialReturnPath("/%5cevil.example/path")).toThrow(
      "Invalid integration return path",
    )
  })
})

describe("social integration configuration", () => {
  it("rejects local HTTP callbacks in production", () => {
    configureCommonEnvironment("http://localhost:3000")
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("INSTAGRAM_INTEGRATION_ENABLED", "true")
    vi.stubEnv("INSTAGRAM_CLIENT_ID", "client")
    vi.stubEnv("INSTAGRAM_CLIENT_SECRET", "secret")

    expect(socialEnvironmentConfigured("instagram")).toBe(false)
  })

  it("rejects invalid Instagram API versions and TikTok media prefixes", () => {
    configureCommonEnvironment("https://app.screeem.com")
    vi.stubEnv("INSTAGRAM_INTEGRATION_ENABLED", "true")
    vi.stubEnv("INSTAGRAM_CLIENT_ID", "client")
    vi.stubEnv("INSTAGRAM_CLIENT_SECRET", "secret")
    vi.stubEnv("INSTAGRAM_API_VERSION", "latest")
    expect(socialEnvironmentConfigured("instagram")).toBe(false)

    vi.stubEnv("TIKTOK_INTEGRATION_ENABLED", "true")
    vi.stubEnv("TIKTOK_CLIENT_KEY", "client")
    vi.stubEnv("TIKTOK_CLIENT_SECRET", "secret")
    vi.stubEnv("TIKTOK_VERIFIED_MEDIA_URL_PREFIXES", "https://127.0.0.1/social/")
    expect(socialEnvironmentConfigured("tiktok")).toBe(false)
  })
})

function createFixture(options: {
  existing?: ReturnType<typeof connection>
  provider?: SupportedSocialProviderName
} = {}) {
  const providerName = options.provider ?? "instagram"
  const provider = {
    name: providerName,
    authorizationUrl: vi.fn(async (request: { state: string; redirectUri: string }) => ({
      provider: providerName,
      state: request.state,
      url: `https://www.instagram.com/oauth/authorize?state=${request.state}`,
      scopes: ["instagram_business_basic", "instagram_business_content_publish"],
    })),
    exchangeCode: vi.fn(async () => connectedAccount("account-one")),
    refreshCredential: vi.fn(async (credential: SocialCredential) => credential),
    revokeCredential: vi.fn(async () => ({ status: "revoked" as const })),
  }
  const cipher = {
    seal: vi.fn(async (_scope: unknown, _value: unknown) =>
      SealedIntegrationCredential.create("test-key", "v1.a.b")),
    open: vi.fn(async (_scope: unknown, _credential: unknown): Promise<unknown> => storedEnvelope()),
  }
  const provisioning = {
    connect: vi.fn(async () => ({ connection: connection(), previousCredential: null })),
    disconnect: vi.fn(),
    beginDisconnect: vi.fn(),
    completeDisconnect: vi.fn(),
    updateDisconnectCredential: vi.fn(async () => ({ ...storedCredential(), revision: 2 })),
    recordHealth: vi.fn(),
  }
  const connections = {
    list: vi.fn(),
    get: vi.fn(),
    getByProvider: vi.fn(async () => options.existing ?? null),
    create: vi.fn(),
    updateAuthState: vi.fn(),
    markReauthorizationRequired: vi.fn(),
    recordHealth: vi.fn(),
    setEnabled: vi.fn(),
  }
  const execution = { load: vi.fn() }
  const disconnectLeases = {
    acquire: vi.fn(async () => true),
    renew: vi.fn(async () => true),
    release: vi.fn(async () => undefined),
  }
  return {
    provider,
    cipher,
    provisioning,
    execution,
    disconnectLeases,
    service: new SocialConnectionService({
      provider,
      redirectUri: callbackUri,
      states: new MemorySocialOAuthStateStore(() => new Date(now)),
      cipher,
      provisioning,
      connections,
      execution,
      disconnectLeases,
      now: () => new Date(now),
    }),
  }
}

function socialState() {
  return {
    stateHash: "1kuTyfG2DrM45ctBXWo2vZIO3Q6bNvfqXHMNDhD_FH8",
    provider: "instagram" as const,
    teamId,
    attemptId,
    userId,
    redirectUri: callbackUri,
    returnPath: "/dashboard/integrations",
    createdAt: now,
    expiresAt: "2026-08-31T12:10:00.000Z",
  }
}

function instagramCredential(accountId = "account-one"): SocialCredential {
  return {
    provider: "instagram",
    accessToken: "access-token",
    refreshToken: null,
    expiresInSeconds: 60 * 24 * 60 * 60,
    refreshExpiresInSeconds: null,
    scopes: ["instagram_business_basic", "instagram_business_content_publish"],
    accountId,
  }
}

function tiktokCredential(): SocialCredential {
  return {
    provider: "tiktok",
    accessToken: "tiktok-access-token",
    refreshToken: "tiktok-refresh-token",
    expiresInSeconds: 86_400,
    refreshExpiresInSeconds: 365 * 86_400,
    scopes: ["user.info.basic", "video.publish"],
    accountId: "tiktok-account",
  }
}

function connectedAccount(accountId: string) {
  return {
    credential: instagramCredential(accountId),
    account: {
      provider: "instagram" as const,
      id: accountId,
      username: "studio",
      displayName: "Studio",
      pictureUrl: null,
    },
  }
}

function storedEnvelope() {
  return {
    version: 1 as const,
    generation: attemptId,
    issuedAt: now,
    accessExpiresAt: "2026-10-30T12:00:00.000Z",
    refreshExpiresAt: null,
    refreshEligibleAt: "2026-09-01T12:00:00.000Z",
    credential: instagramCredential(),
  }
}

function tiktokStoredEnvelope() {
  return {
    version: 1 as const,
    generation: attemptId,
    issuedAt: now,
    accessExpiresAt: "2026-09-01T12:00:00.000Z",
    refreshExpiresAt: "2027-08-31T12:00:00.000Z",
    refreshEligibleAt: null,
    credential: tiktokCredential(),
  }
}

function storedCredential(update: Record<string, unknown> = {}) {
  return {
    teamId,
    connectionId,
    credential: SealedIntegrationCredential.create("test-key", "v1.a.b"),
    revision: 1,
    updatedAt: now,
    ...update,
  }
}

function connection(update: Record<string, unknown> = {}) {
  const status = update.status ?? "connected"
  const enabled = update.enabled ?? true
  return snapshotIntegrationConnection({
    id: connectionId,
    teamId,
    provider: "instagram",
    revision: 1,
    status,
    health: "healthy",
    enabled,
    displayName: "@studio",
    externalAccountId: "account-one",
    lastErrorCode: null,
    lastCheckedAt: now,
    createdBy: userId,
    createdAt: now,
    updatedBy: userId,
    updatedAt: now,
    disabledBy: enabled ? null : userId,
    disabledAt: enabled ? null : now,
    disconnectedBy: status === "disconnected" ? userId : null,
    disconnectedAt: status === "disconnected" ? now : null,
    ...update,
  })
}

function configureCommonEnvironment(siteUrl: string) {
  vi.stubEnv("NODE_ENV", "production")
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", siteUrl)
  vi.stubEnv("INTEGRATION_CREDENTIAL_KEY_ID", "test-key")
  vi.stubEnv("INTEGRATION_CREDENTIAL_KEY", Buffer.alloc(32, 7).toString("base64url"))
}
