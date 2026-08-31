import "server-only"

import type {
  ConnectedSocialAccount,
  SocialAccountProfile,
  SocialAuthorization,
  SocialAuthorizationRequest,
  SocialCodeExchangeRequest,
  SocialCredentialRevocation,
} from "@screeem/integrations/social"
import { SocialAuthorizationError } from "@screeem/integrations/social"

import type { IntegrationCredentialCipher } from "../credential-cipher"
import {
  snapshotIntegrationConnection,
  snapshotIntegrationIdentifier,
  snapshotIntegrationTeamControl,
  type IntegrationConnection,
  type IntegrationIdentifier,
} from "../contract"
import {
  IntegrationExternalAccountConflictError,
  type DisconnectingIntegration,
  type SocialIntegrationProvisioningStore,
} from "../provisioning-store"
import {
  snapshotStoredIntegrationCredential,
  type IntegrationConnectionStore,
  type IntegrationExecutionStore,
} from "../stores"
import {
  createStoredSocialCredential,
  integrationNameForSocialProvider,
  snapshotSocialReturnPath,
  snapshotStoredSocialCredential,
  type SocialCredential,
  type SupportedSocialProviderName,
} from "./contract"
import type {
  SocialDisconnectLeaseStore,
  SocialOAuthState,
  SocialOAuthStateStore,
} from "./stores"

export interface SocialConnectionProvider {
  readonly name: SupportedSocialProviderName
  authorizationUrl(request: SocialAuthorizationRequest): Promise<SocialAuthorization>
  exchangeCode(request: SocialCodeExchangeRequest): Promise<ConnectedSocialAccount<SocialCredential>>
  refreshCredential(credential: SocialCredential): Promise<SocialCredential>
  revokeCredential(credential: SocialCredential): Promise<SocialCredentialRevocation>
}

export interface SocialConnectionServiceDependencies {
  readonly provider: SocialConnectionProvider
  readonly redirectUri: string | null
  readonly states: SocialOAuthStateStore
  readonly cipher: IntegrationCredentialCipher
  readonly provisioning: SocialIntegrationProvisioningStore
  readonly connections: IntegrationConnectionStore
  readonly execution: IntegrationExecutionStore
  readonly disconnectLeases: SocialDisconnectLeaseStore
  readonly now?: () => Date
}

export interface SocialDisconnectOutcome {
  readonly connection: IntegrationConnection | null
  readonly providerAccessRemoved: boolean | null
}

export class SocialConnectionService {
  readonly #now: () => Date

  constructor(private readonly dependencies: SocialConnectionServiceDependencies) {
    this.#now = dependencies.now ?? (() => new Date())
  }

  async begin(
    teamId: IntegrationIdentifier,
    userId: IntegrationIdentifier,
    returnPath?: unknown,
    forceReauthorization = false,
  ) {
    if (this.dependencies.redirectUri === null) {
      throw new TypeError("Social OAuth redirect URI is unavailable")
    }
    const redirectUri = this.dependencies.redirectUri
    const state = createOAuthStateToken()
    const attemptId = snapshotIntegrationIdentifier(crypto.randomUUID())
    const authorization = await this.dependencies.provider.authorizationUrl({
      redirectUri,
      state,
      forceReauthorization,
    })
    if (authorization.provider !== this.dependencies.provider.name || authorization.state !== state) {
      throw new TypeError("Invalid social authorization response")
    }
    await this.dependencies.states.create({
      stateHash: await hashOAuthState(state),
      provider: this.dependencies.provider.name,
      teamId,
      attemptId,
      userId,
      redirectUri,
      returnPath: snapshotSocialReturnPath(returnPath),
    })
    return Object.freeze({ authorizationUrl: authorization.url })
  }

  async consumeState(state: string, userId: IntegrationIdentifier) {
    return this.dependencies.states.consume(
      await hashOAuthState(state),
      this.dependencies.provider.name,
      userId,
    )
  }

  async complete(state: SocialOAuthState, returnedState: string, code: string) {
    if (state.provider !== this.dependencies.provider.name) {
      throw new TypeError("Social provider state mismatch")
    }
    if (await hashOAuthState(returnedState) !== state.stateHash) {
      throw new TypeError("Social OAuth state does not match")
    }
    const providerName = integrationNameForSocialProvider(state.provider)
    const connected = await this.dependencies.provider.exchangeCode({
      code,
      redirectUri: state.redirectUri,
      expectedRedirectUri: state.redirectUri,
      state: returnedState,
      expectedState: returnedState,
    })
    validateConnectedAccount(connected, state.provider)
    let connectionId: IntegrationIdentifier | null = null
    let provisioningStarted = false
    try {
      const existing = await this.dependencies.connections.getByProvider(state.teamId, providerName)
      if (
        existing &&
        existing.status !== "disconnected" &&
        existing.externalAccountId !== null &&
        existing.externalAccountId !== connected.account.id
      ) {
        throw new SocialAccountSwitchError(state.provider)
      }
      connectionId = existing?.id ?? snapshotIntegrationIdentifier(crypto.randomUUID())
      const issuedAt = this.#now().toISOString()
      const envelope = createStoredSocialCredential(state.attemptId, connected.credential, issuedAt)
      const sealed = await this.dependencies.cipher.seal(
        { teamId: state.teamId, connectionId, provider: providerName },
        envelope,
      )
      provisioningStarted = true
      const provisioned = await this.dependencies.provisioning.connect(state.teamId, {
        connectionId,
        authorizationAttemptId: state.attemptId,
        provider: providerName,
        displayName: accountDisplayName(connected.account),
        externalAccountId: connected.account.id,
        credential: sealed,
        actorId: state.userId,
        connectedAt: issuedAt,
      })
      return provisioned.connection
    } catch (error) {
      if (error instanceof IntegrationExternalAccountConflictError) {
        if (error.scope === "team") throw new SocialAccountSwitchError(state.provider)
        throw error
      }
      if (provisioningStarted && connectionId) {
        const reconciled = await this.reconcileProvisioning(
          state.teamId,
          connectionId,
          state.attemptId,
        )
        if (reconciled.status === "committed") return reconciled.connection
      }
      throw error
    }
  }

  async disconnect(teamId: IntegrationIdentifier, actorId: IntegrationIdentifier) {
    const providerName = integrationNameForSocialProvider(this.dependencies.provider.name)
    const started = await this.dependencies.provisioning.beginDisconnect(
      teamId,
      providerName,
      actorId,
      this.#now().toISOString(),
    )
    if (!started || started.connection.status === "disconnected") {
      return Object.freeze({
        connection: started?.connection ?? null,
        providerAccessRemoved: null,
      })
    }
    return this.finishDisconnect(teamId, actorId, started)
  }

  async finishDisconnect(
    teamId: IntegrationIdentifier,
    actorId: IntegrationIdentifier,
    started: DisconnectingIntegration,
  ) {
    const providerName = integrationNameForSocialProvider(this.dependencies.provider.name)
    if (!started.credential) {
      return this.completeDisconnect(teamId, actorId, started, false, null)
    }

    const owner = createOAuthStateToken()
    const acquired = await this.dependencies.disconnectLeases.acquire(
      teamId,
      started.connection.id,
      owner,
    )
    if (!acquired) throw new SocialDisconnectRefreshInProgressError()
    try {
      const current = await this.dependencies.provisioning.beginDisconnect(
        teamId,
        providerName,
        actorId,
        this.#now().toISOString(),
      )
      if (!current || current.connection.status === "disconnected") {
        return Object.freeze({
          connection: current?.connection ?? null,
          providerAccessRemoved: null,
        })
      }
      if (current.connection.id !== started.connection.id) {
        throw new TypeError("Social disconnect lease no longer matches its connection")
      }
      if (!current.credential) {
        return this.completeDisconnect(teamId, actorId, current, false, null, owner)
      }

      const credentialRevision = current.credential.revision
      let opened: ReturnType<typeof snapshotStoredSocialCredential>
      try {
        opened = snapshotStoredSocialCredential(await this.dependencies.cipher.open(
          {
            teamId,
            connectionId: current.connection.id,
            provider: providerName,
          },
          current.credential.credential,
        ))
      } catch {
        return this.completeDisconnect(
          teamId,
          actorId,
          current,
          false,
          credentialRevision,
          owner,
        )
      }
      if (
        opened.credential.provider !== this.dependencies.provider.name ||
        opened.credential.accountId !== current.connection.externalAccountId
      ) {
        return this.completeDisconnect(
          teamId,
          actorId,
          current,
          false,
          credentialRevision,
          owner,
        )
      }
      const credential = opened.credential
      if (Date.parse(opened.accessExpiresAt) <= this.#now().getTime()) {
        try {
          const outcome = await this.refreshAndRevokeDisconnectCredential(
            teamId,
            actorId,
            current,
            opened.generation,
            credential,
            credentialRevision,
            owner,
          )
          return this.completeDisconnect(
            teamId,
            actorId,
            current,
            outcome.providerAccessRemoved,
            outcome.revision,
            owner,
          )
        } catch (error) {
          if (!(error instanceof SocialAuthorizationError) || !error.reauthorize) throw error
          return this.completeDisconnect(
            teamId,
            actorId,
            current,
            false,
            credentialRevision,
            owner,
          )
        }
      }
      try {
        await this.renewDisconnectLease(teamId, current.connection.id, owner)
        await this.dependencies.provider.revokeCredential(credential)
      } catch (error) {
        if (!(error instanceof SocialAuthorizationError) || !error.reauthorize) throw error
        if (this.dependencies.provider.name !== "tiktok") {
          return this.completeDisconnect(
            teamId,
            actorId,
            current,
            false,
            credentialRevision,
            owner,
          )
        }
        try {
          const outcome = await this.refreshAndRevokeDisconnectCredential(
            teamId,
            actorId,
            current,
            opened.generation,
            credential,
            credentialRevision,
            owner,
          )
          return this.completeDisconnect(
            teamId,
            actorId,
            current,
            outcome.providerAccessRemoved,
            outcome.revision,
            owner,
          )
        } catch (refreshError) {
          if (
            !(refreshError instanceof SocialAuthorizationError) ||
            !refreshError.reauthorize
          ) throw refreshError
          return this.completeDisconnect(
            teamId,
            actorId,
            current,
            false,
            credentialRevision,
            owner,
          )
        }
      }
      return this.completeDisconnect(
        teamId,
        actorId,
        current,
        true,
        credentialRevision,
        owner,
      )
    } finally {
      await this.dependencies.disconnectLeases.release(
        teamId,
        started.connection.id,
        owner,
      ).catch(() => undefined)
    }
  }

  private async refreshAndRevokeDisconnectCredential(
    teamId: IntegrationIdentifier,
    actorId: IntegrationIdentifier,
    started: DisconnectingIntegration,
    generation: IntegrationIdentifier,
    credential: SocialCredential,
    expectedCredentialRevision: number,
    leaseOwner: string,
  ) {
    await this.renewDisconnectLease(teamId, started.connection.id, leaseOwner)
    const refreshed = await this.dependencies.provider.refreshCredential(credential)
    if (
      refreshed.provider !== this.dependencies.provider.name ||
      refreshed.accountId !== started.connection.externalAccountId
    ) {
      throw new TypeError("Refreshed social credential does not match its connection")
    }
    await this.renewDisconnectLease(teamId, started.connection.id, leaseOwner)
    const providerName = integrationNameForSocialProvider(this.dependencies.provider.name)
    const updatedAt = this.#now().toISOString()
    const envelope = createStoredSocialCredential(generation, refreshed, updatedAt)
    const sealed = await this.dependencies.cipher.seal(
      { teamId, connectionId: started.connection.id, provider: providerName },
      envelope,
    )
    await this.renewDisconnectLease(teamId, started.connection.id, leaseOwner)
    const stored = await this.dependencies.provisioning.updateDisconnectCredential(
      teamId,
      started.connection.id,
      started.connection.revision,
      expectedCredentialRevision,
      sealed,
      actorId,
      updatedAt,
    )
    await this.renewDisconnectLease(teamId, started.connection.id, leaseOwner)
    try {
      await this.dependencies.provider.revokeCredential(refreshed)
      return Object.freeze({ revision: stored.revision, providerAccessRemoved: true })
    } catch (error) {
      if (!(error instanceof SocialAuthorizationError) || !error.reauthorize) throw error
      return Object.freeze({ revision: stored.revision, providerAccessRemoved: false })
    }
  }

  private async completeDisconnect(
    teamId: IntegrationIdentifier,
    actorId: IntegrationIdentifier,
    started: DisconnectingIntegration,
    providerAccessRemoved: boolean,
    expectedCredentialRevision: number | null,
    leaseOwner?: string,
  ): Promise<SocialDisconnectOutcome> {
    if (leaseOwner) {
      await this.renewDisconnectLease(teamId, started.connection.id, leaseOwner)
    }
    const connection = await this.dependencies.provisioning.completeDisconnect(
      teamId,
      started.connection.id,
      started.connection.revision,
      expectedCredentialRevision,
      actorId,
      this.#now().toISOString(),
    )
    return Object.freeze({ connection, providerAccessRemoved })
  }

  private async renewDisconnectLease(
    teamId: IntegrationIdentifier,
    connectionId: IntegrationIdentifier,
    owner: string,
  ) {
    const renewed = await this.dependencies.disconnectLeases.renew(teamId, connectionId, owner)
    if (!renewed) throw new SocialDisconnectRefreshInProgressError()
  }

  private async reconcileProvisioning(
    teamId: IntegrationIdentifier,
    connectionId: IntegrationIdentifier,
    generation: IntegrationIdentifier,
  ) {
    try {
      const runtime = await this.dependencies.execution.load(teamId, connectionId)
      if (!runtime) return { status: "not_committed" } as const
      const connection = snapshotIntegrationConnection(runtime.connection)
      const control = snapshotIntegrationTeamControl(runtime.control)
      const providerName = integrationNameForSocialProvider(this.dependencies.provider.name)
      if (
        connection.teamId !== teamId ||
        connection.id !== connectionId ||
        connection.provider !== providerName ||
        control.teamId !== teamId
      ) return { status: "unknown" } as const
      if (connection.status !== "connected") return { status: "not_committed" } as const
      if (!connection.enabled || !control.enabled) return { status: "unknown" } as const
      if (!runtime.credential) return { status: "not_committed" } as const
      const stored = snapshotStoredIntegrationCredential(runtime.credential)
      if (stored.teamId !== teamId || stored.connectionId !== connectionId) {
        return { status: "unknown" } as const
      }
      const current = snapshotStoredSocialCredential(await this.dependencies.cipher.open(
        { teamId, connectionId, provider: providerName },
        stored.credential,
      ))
      if (current.generation !== generation) return { status: "unknown" } as const
      return { status: "committed", connection } as const
    } catch {
      return { status: "unknown" } as const
    }
  }
}

export class SocialAccountSwitchError extends Error {
  constructor(readonly provider: SupportedSocialProviderName) {
    super(`Disconnect ${provider} before connecting a different account`)
    this.name = "SocialAccountSwitchError"
  }
}

export class SocialDisconnectRefreshInProgressError extends Error {
  constructor() {
    super("Social credential refresh is already in progress")
    this.name = "SocialDisconnectRefreshInProgressError"
  }
}

function accountDisplayName(account: SocialAccountProfile) {
  if (account.username) return `@${account.username}`
  return account.displayName
}

function validateConnectedAccount(
  connected: ConnectedSocialAccount<SocialCredential>,
  provider: SupportedSocialProviderName,
) {
  if (
    connected.account.provider !== provider ||
    connected.credential.provider !== provider ||
    connected.credential.accountId !== connected.account.id
  ) {
    throw new TypeError("Social provider returned mismatched account credentials")
  }
}

function createOAuthStateToken() {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url")
}

async function hashOAuthState(input: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(input)) throw new TypeError("Invalid OAuth state")
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input))
  return Buffer.from(new Uint8Array(digest)).toString("base64url")
}

export function isConnectedSocialConnection(
  connection: IntegrationConnection | null,
): connection is IntegrationConnection {
  return connection?.status === "connected" && connection.enabled
}
