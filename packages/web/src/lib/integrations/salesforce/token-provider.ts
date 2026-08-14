import "server-only"

import {
  snapshotIntegrationConnection,
  snapshotIntegrationTeamControl,
  type IntegrationConnection,
} from "../contract"
import type { IntegrationCredentialCipher } from "../credential-cipher"
import {
  IntegrationCredentialRevisionConflictError,
  snapshotStoredIntegrationCredential,
  type IntegrationConnectionStore,
  type IntegrationCredentialStore,
  type IntegrationExecutionStore,
  type StoredIntegrationCredential,
} from "../stores"
import type { SalesforceAccessTokenProvider } from "./client"
import {
  SalesforceError,
  salesforceProviderName,
  snapshotSalesforceCredential,
  type SalesforceCredential,
} from "./contract"
import type { SalesforceOAuthClient } from "./oauth"
import type { SalesforceRefreshLeaseStore } from "./stores"

export class RefreshingSalesforceAccessTokenProvider implements SalesforceAccessTokenProvider {
  private constructor(
    inputConnection: IntegrationConnection,
    inputCredential: StoredIntegrationCredential,
    private readonly expectedGeneration: SalesforceCredential["generation"],
    private readonly connections: IntegrationConnectionStore,
    private readonly execution: IntegrationExecutionStore,
    private readonly credentials: IntegrationCredentialStore,
    private readonly cipher: IntegrationCredentialCipher,
    private readonly oauth: SalesforceOAuthClient,
    private readonly leases: SalesforceRefreshLeaseStore,
  ) {
    this.connection = snapshotIntegrationConnection(inputConnection)
    const stored = snapshotStoredIntegrationCredential(inputCredential)
    if (
      stored.teamId !== this.connection.teamId ||
      stored.connectionId !== this.connection.id ||
      this.connection.provider !== salesforceProviderName
    ) throw new TypeError("Salesforce credential scope mismatch")
  }

  private readonly connection: IntegrationConnection

  static async create(
    inputConnection: IntegrationConnection,
    inputCredential: StoredIntegrationCredential,
    connections: IntegrationConnectionStore,
    execution: IntegrationExecutionStore,
    credentials: IntegrationCredentialStore,
    cipher: IntegrationCredentialCipher,
    oauth: SalesforceOAuthClient,
    leases: SalesforceRefreshLeaseStore,
  ) {
    const connection = snapshotIntegrationConnection(inputConnection)
    const stored = snapshotStoredIntegrationCredential(inputCredential)
    if (
      stored.teamId !== connection.teamId ||
      stored.connectionId !== connection.id ||
      connection.provider !== salesforceProviderName
    ) throw new TypeError("Salesforce credential scope mismatch")
    const opened = snapshotSalesforceCredential(await cipher.open(
      {
        teamId: connection.teamId,
        connectionId: connection.id,
        provider: salesforceProviderName,
      },
      stored.credential,
    ))
    return new RefreshingSalesforceAccessTokenProvider(
      connection,
      stored,
      opened.generation,
      connections,
      execution,
      credentials,
      cipher,
      oauth,
      leases,
    )
  }

  async get(signal?: AbortSignal) {
    const operationSignal = signal ?? AbortSignal.timeout(15_000)
    return (await abortable(this.load(), operationSignal)).credential
  }

  async refresh(rejectedAccessToken: string, signal?: AbortSignal) {
    const operationSignal = signal ?? AbortSignal.timeout(15_000)
    const current = await this.get(operationSignal)
    if (current.accessToken !== rejectedAccessToken) return current

    const latest = await abortable(this.load(), operationSignal)
    if (latest.credential.accessToken !== rejectedAccessToken) return latest.credential

    const owner = randomToken()
    const acquired = await this.leases.acquire(
      this.connection.teamId,
      this.connection.id,
      owner,
    )
    if (!acquired) return this.waitForRefresh(rejectedAccessToken, operationSignal)

    const heartbeat = this.startLeaseHeartbeat(owner)
    try {
      const afterLease = await abortable(this.load(), operationSignal)
      if (afterLease.credential.accessToken !== rejectedAccessToken) return afterLease.credential
      let refreshedAccess
      try {
        refreshedAccess = await this.oauth.refresh(
          afterLease.credential.refreshToken,
          afterLease.credential,
          operationSignal,
        )
      } catch (error) {
        if (error instanceof SalesforceError && error.code === "authentication_failed") {
          await this.connections.markReauthorizationRequired(
            this.connection.teamId,
            this.connection.id,
            afterLease.connection.revision,
            new Date().toISOString(),
          ).catch(() => undefined)
        }
        throw error
      }
      const refreshed = snapshotSalesforceCredential({
        ...refreshedAccess,
        generation: afterLease.credential.generation,
      })
      if (!(await heartbeat.renew())) throw new SalesforceError("provider_unavailable", true)
      const sealed = await this.cipher.seal(this.scope(), refreshed)
      if (!(await heartbeat.renew())) throw new SalesforceError("provider_unavailable", true)
      try {
        if (operationSignal.aborted) throw new SalesforceError("provider_unavailable", true)
        await this.credentials.compareAndSet(
          this.connection.teamId,
          this.connection.id,
          afterLease.stored.revision,
          sealed,
          new Date().toISOString(),
        )
        return (await abortable(this.load(), operationSignal)).credential
      } catch (error) {
        if (!(error instanceof IntegrationCredentialRevisionConflictError)) throw error
        const winner = await abortable(this.load(), operationSignal)
        if (winner.credential.accessToken === rejectedAccessToken) throw error
        return winner.credential
      }
    } finally {
      heartbeat.stop()
      await this.leases.release(this.connection.teamId, this.connection.id, owner).catch(() => undefined)
    }
  }

  private async waitForRefresh(rejectedAccessToken: string, signal?: AbortSignal) {
    const deadline = Date.now() + 120_000
    let interval = 100
    while (Date.now() < deadline) {
      if (signal?.aborted) throw new SalesforceError("provider_unavailable", true)
      await delay(interval, signal)
      interval = Math.min(interval * 2, 1_000)
      const latest = await abortable(this.load(), signal)
      if (latest.credential.accessToken !== rejectedAccessToken) return latest.credential
    }
    throw new SalesforceError("provider_unavailable", true)
  }

  private async load() {
    const runtime = await this.assertAvailable()
    if (!runtime.credential) throw new SalesforceError("authentication_failed", false)
    const safe = snapshotStoredIntegrationCredential(runtime.credential)
    if (safe.teamId !== this.connection.teamId || safe.connectionId !== this.connection.id) {
      throw new TypeError("Salesforce credential scope mismatch")
    }
    const credential = await this.open(safe)
    return { stored: safe, credential, connection: runtime.connection }
  }

  private async open(stored: StoredIntegrationCredential) {
    const credential = snapshotSalesforceCredential(
      await this.cipher.open(this.scope(), stored.credential),
    )
    if (credential.generation !== this.expectedGeneration) {
      throw new SalesforceError("authentication_failed", false)
    }
    return credential
  }

  private async assertAvailable() {
    let runtime
    try {
      runtime = await this.execution.load(this.connection.teamId, this.connection.id)
    } catch {
      throw new SalesforceError("provider_unavailable", true)
    }
    if (!runtime) throw new SalesforceError("authentication_failed", false)
    const connection = snapshotIntegrationConnection(runtime.connection)
    const control = snapshotIntegrationTeamControl(runtime.control)
    const credential = runtime.credential
      ? snapshotStoredIntegrationCredential(runtime.credential)
      : null
    if (
      connection.teamId !== this.connection.teamId ||
      connection.id !== this.connection.id ||
      connection.provider !== salesforceProviderName ||
      control.teamId !== this.connection.teamId
    ) throw new TypeError("Salesforce connection scope mismatch")
    if (!control.enabled || !connection.enabled || connection.status !== "connected") {
      throw new SalesforceError("authentication_failed", false)
    }
    if (
      credential &&
      (credential.teamId !== connection.teamId ||
        credential.connectionId !== connection.id)
    ) throw new TypeError("Salesforce credential scope mismatch")
    return { connection, credential }
  }

  private startLeaseHeartbeat(owner: string) {
    let stopped = false
    let lost = false
    let pending = Promise.resolve(true)
    const renew = () => {
      if (stopped || lost) return Promise.resolve(false)
      pending = pending.then(async () => {
        if (stopped || lost) return false
        try {
          const renewed = await this.leases.renew(
            this.connection.teamId,
            this.connection.id,
            owner,
          )
          if (!renewed) lost = true
          return renewed
        } catch {
          lost = true
          return false
        }
      })
      return pending
    }
    const timer = setInterval(() => { void renew() }, 15_000)
    return {
      renew,
      stop() {
        stopped = true
        clearInterval(timer)
      },
    }
  }

  private scope() {
    return {
      teamId: this.connection.teamId,
      connectionId: this.connection.id,
      provider: salesforceProviderName,
    }
  }
}

function randomToken() {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url")
}

function delay(milliseconds: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer)
      reject(new SalesforceError("provider_unavailable", true))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }, milliseconds)
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

function abortable<Value>(promise: Promise<Value>, signal?: AbortSignal) {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(new SalesforceError("provider_unavailable", true))
  return new Promise<Value>((resolve, reject) => {
    const onAbort = () => reject(new SalesforceError("provider_unavailable", true))
    signal.addEventListener("abort", onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener("abort", onAbort)
        reject(error)
      },
    )
  })
}
