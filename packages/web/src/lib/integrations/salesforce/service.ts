import "server-only"

import type {
  IntegrationCredentialCipher,
  IntegrationCredentialScope,
} from "../credential-cipher"
import {
  snapshotIntegrationConnection,
  snapshotIntegrationIdentifier,
  snapshotIntegrationTeamControl,
  type IntegrationIdentifier,
} from "../contract"
import {
  IntegrationAuthorizationAttemptError,
  type IntegrationProvisioningStore,
} from "../provisioning-store"
import type {
  IntegrationConnectionStore,
  IntegrationExecutionStore,
  SealedIntegrationCredential,
} from "../stores"
import { snapshotStoredIntegrationCredential } from "../stores"
import type { SalesforceClient } from "./client"
import {
  integrationErrorCodeForSalesforce,
  salesforceProviderName,
  snapshotSalesforceCredential,
  snapshotSalesforceReturnPath,
  type SalesforceApiLimits,
  type SalesforceAccessCredential,
  type SalesforceIdentity,
} from "./contract"
import {
  createSalesforceOAuthStateToken,
  createSalesforcePkceChallenge,
  hashSalesforceOAuthState,
  type SalesforceOAuthClient,
} from "./oauth"
import type { SalesforceOAuthState, SalesforceOAuthStateStore } from "./stores"

export interface SalesforceConnectionServiceDependencies {
  readonly oauth: SalesforceOAuthClient
  readonly states: SalesforceOAuthStateStore
  readonly cipher: IntegrationCredentialCipher
  readonly provisioning: IntegrationProvisioningStore
  readonly connections: IntegrationConnectionStore
  readonly execution: IntegrationExecutionStore
  readonly identify: (credential: SalesforceAccessCredential) => Promise<SalesforceIdentity>
  readonly resolveClient: (teamId: IntegrationIdentifier) => Promise<SalesforceClient>
  readonly redirectUri: string
  readonly now?: () => Date
}

export class SalesforceConnectionService {
  private readonly now: () => Date

  constructor(private readonly dependencies: SalesforceConnectionServiceDependencies) {
    this.now = dependencies.now ?? (() => new Date())
  }

  async begin(
    teamId: IntegrationIdentifier,
    userId: IntegrationIdentifier,
    returnPath?: unknown,
  ) {
    const { verifier, challenge } = await createSalesforcePkceChallenge()
    const state = createSalesforceOAuthStateToken()
    const attemptId = snapshotIntegrationIdentifier(crypto.randomUUID())
    const stateHash = await hashSalesforceOAuthState(state)
    await this.dependencies.states.create({
      stateHash,
      teamId,
      attemptId,
      userId,
      codeVerifier: verifier,
      redirectUri: this.dependencies.redirectUri,
      returnPath: snapshotSalesforceReturnPath(returnPath),
    })
    return Object.freeze({
      authorizationUrl: this.dependencies.oauth.authorizationUrl(state, challenge),
    })
  }

  async consumeState(state: string, userId: IntegrationIdentifier) {
    const stateHash = await hashSalesforceOAuthState(state)
    return this.dependencies.states.consume(stateHash, userId)
  }

  async complete(state: SalesforceOAuthState, code: string) {
    const accessCredential = await this.dependencies.oauth.exchange(code, state.codeVerifier)
    let committed = false
    let provisioningStarted = false
    let connectionId: IntegrationIdentifier | null = null
    try {
      const identity = await this.dependencies.identify(accessCredential)
      connectionId = await this.connectionIdFor(state.teamId)
      const credential = snapshotSalesforceCredential({
        ...accessCredential,
        generation: state.attemptId,
      })
      const scope = { teamId: state.teamId, connectionId, provider: salesforceProviderName }
      const sealed = await this.dependencies.cipher.seal(scope, credential)
      provisioningStarted = true
      const provisioned = await this.dependencies.provisioning.connect(state.teamId, {
        connectionId,
        authorizationAttemptId: state.attemptId,
        provider: salesforceProviderName,
        displayName: identity.displayName,
        externalAccountId: identity.organizationId,
        credential: sealed,
        actorId: state.userId,
        connectedAt: this.now().toISOString(),
      })
      committed = true
      if (provisioned.previousCredential) {
        await this.revokeReplacedCredential(
          scope,
          provisioned.previousCredential.credential,
          credential.refreshToken,
        )
      }
      return provisioned.connection
    } catch (error) {
      if (committed) throw error
      if (!provisioningStarted || error instanceof IntegrationAuthorizationAttemptError) {
        await this.dependencies.oauth.revoke(accessCredential.refreshToken).catch(() => undefined)
      } else if (connectionId) {
        const reconciled = await this.reconcileProvisioning(
          state.teamId,
          connectionId,
          state.attemptId,
        )
        if (reconciled.status === "committed") return reconciled.connection
        if (reconciled.status === "not_committed") {
          await this.dependencies.oauth.revoke(accessCredential.refreshToken).catch(() => undefined)
        }
      }
      throw error
    }
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
      if (
        connection.teamId !== teamId ||
        connection.id !== connectionId ||
        connection.provider !== salesforceProviderName ||
        control.teamId !== teamId
      ) return { status: "unknown" } as const
      if (connection.status !== "connected") return { status: "not_committed" } as const
      if (!connection.enabled || !control.enabled) return { status: "unknown" } as const
      if (!runtime.credential) return { status: "not_committed" } as const
      const stored = snapshotStoredIntegrationCredential(runtime.credential)
      if (stored.teamId !== teamId || stored.connectionId !== connectionId) {
        return { status: "unknown" } as const
      }
      const current = snapshotSalesforceCredential(await this.dependencies.cipher.open(
        { teamId, connectionId, provider: salesforceProviderName },
        stored.credential,
      ))
      if (current.generation !== generation) return { status: "unknown" } as const
      return {
        status: "committed",
        connection,
      } as const
    } catch {
      return { status: "unknown" } as const
    }
  }

  private async revokeReplacedCredential(
    scope: IntegrationCredentialScope,
    sealed: SealedIntegrationCredential,
    currentRefreshToken: string,
  ) {
    try {
      const previous = snapshotSalesforceCredential(
        await this.dependencies.cipher.open(scope, sealed),
      )
      if (previous.refreshToken !== currentRefreshToken) {
        await this.dependencies.oauth.revoke(previous.refreshToken)
      }
    } catch {
      return
    }
  }

  async test(teamId: IntegrationIdentifier, actorId: IntegrationIdentifier): Promise<SalesforceApiLimits> {
    const connection = await this.dependencies.connections.getByProvider(teamId, salesforceProviderName)
    if (!connection) throw new Error("Salesforce connection not found")
    try {
      const client = await this.dependencies.resolveClient(teamId)
      const limits = await client.testConnection()
      await this.dependencies.provisioning.recordHealth(teamId, connection.id, connection.revision, {
        health: "healthy",
        lastErrorCode: null,
        checkedAt: this.now().toISOString(),
        actorId,
        updatedAt: this.now().toISOString(),
      })
      return limits
    } catch (error) {
      await this.dependencies.provisioning.recordHealth(teamId, connection.id, connection.revision, {
        health: "degraded",
        lastErrorCode: integrationErrorCodeForSalesforce(error),
        checkedAt: this.now().toISOString(),
        actorId,
        updatedAt: this.now().toISOString(),
      }).catch(() => undefined)
      throw error
    }
  }

  private async connectionIdFor(teamId: IntegrationIdentifier) {
    const existing = await this.dependencies.connections.getByProvider(teamId, salesforceProviderName)
    return existing?.id ?? snapshotIntegrationIdentifier(crypto.randomUUID())
  }
}
