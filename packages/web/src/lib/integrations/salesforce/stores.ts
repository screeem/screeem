import "server-only"

import { getDatabase } from "../../db/database"
import {
  snapshotIntegrationIdentifier,
  type IntegrationIdentifier,
} from "../contract"
import { snapshotSalesforceReturnPath, salesforceProviderName } from "./contract"

export interface SalesforceOAuthState {
  readonly stateHash: string
  readonly teamId: IntegrationIdentifier
  readonly attemptId: IntegrationIdentifier
  readonly userId: IntegrationIdentifier
  readonly codeVerifier: string
  readonly returnPath: string
  readonly createdAt: string
  readonly expiresAt: string
}

export type CreateSalesforceOAuthState = Omit<SalesforceOAuthState, "createdAt" | "expiresAt">

export interface SalesforceOAuthStateStore {
  create(state: CreateSalesforceOAuthState): Promise<void>
  consume(
    stateHash: string,
    userId: IntegrationIdentifier,
  ): Promise<SalesforceOAuthState | null>
}

export interface SalesforceRefreshLeaseStore {
  acquire(
    teamId: IntegrationIdentifier,
    connectionId: IntegrationIdentifier,
    ownerToken: string,
  ): Promise<boolean>
  renew(
    teamId: IntegrationIdentifier,
    connectionId: IntegrationIdentifier,
    ownerToken: string,
  ): Promise<boolean>
  release(
    teamId: IntegrationIdentifier,
    connectionId: IntegrationIdentifier,
    ownerToken: string,
  ): Promise<void>
}

type Database = ReturnType<typeof getDatabase>

interface OAuthStateRow {
  readonly state_hash: string
  readonly team_id: string
  readonly attempt_id: string
  readonly user_id: string
  readonly code_verifier: string
  readonly return_path: string
  readonly created_at: Date
  readonly expires_at: Date
}

export class PostgresSalesforceOAuthStateStore implements SalesforceOAuthStateStore {
  constructor(private readonly database: Database = getDatabase()) {}

  async create(input: CreateSalesforceOAuthState) {
    const state = snapshotSalesforceOAuthStateInput(input)
    await this.database.begin(async (transaction) => {
      await transaction`SELECT id FROM teams WHERE id = ${state.teamId} FOR UPDATE`
      await transaction`DELETE FROM integration_oauth_states WHERE team_id = ${state.teamId} AND provider = ${salesforceProviderName}`
      await transaction`
        INSERT INTO integration_oauth_attempts (
          team_id, provider, attempt_id, user_id, created_at, expires_at
        ) VALUES (
          ${state.teamId}, ${salesforceProviderName}, ${state.attemptId}, ${state.userId},
          statement_timestamp(), statement_timestamp() + interval '10 minutes'
        )
        ON CONFLICT (team_id, provider) DO UPDATE
        SET attempt_id = EXCLUDED.attempt_id,
            user_id = EXCLUDED.user_id,
            created_at = EXCLUDED.created_at,
            expires_at = EXCLUDED.expires_at
      `
      await transaction`
        INSERT INTO integration_oauth_states (
          state_hash, provider, team_id, attempt_id, user_id, code_verifier,
          return_path, created_at, expires_at
        ) VALUES (
          ${state.stateHash}, ${salesforceProviderName}, ${state.teamId}, ${state.attemptId},
          ${state.userId}, ${state.codeVerifier}, ${state.returnPath},
          statement_timestamp(), statement_timestamp() + interval '10 minutes'
        )
      `
      await transaction`DELETE FROM integration_oauth_attempts WHERE expires_at <= statement_timestamp()`
    })
  }

  async consume(stateHash: string, userId: IntegrationIdentifier) {
    const safeHash = stateHashToken(stateHash)
    const safeUserId = snapshotIntegrationIdentifier(userId)
    const rows = await this.database<OAuthStateRow[]>`
      DELETE FROM integration_oauth_states AS state
      USING integration_oauth_attempts AS attempt
      WHERE state.state_hash = ${safeHash}
        AND state.provider = ${salesforceProviderName}
        AND state.user_id = ${safeUserId}
        AND state.expires_at > statement_timestamp()
        AND attempt.team_id = state.team_id
        AND attempt.provider = state.provider
        AND attempt.attempt_id = state.attempt_id
        AND attempt.user_id = state.user_id
        AND attempt.expires_at > statement_timestamp()
      RETURNING state.state_hash, state.team_id, state.attempt_id, state.user_id,
        state.code_verifier, state.return_path, state.created_at, state.expires_at
    `
    return rows[0] ? mapOAuthState(rows[0]) : null
  }
}

export class MemorySalesforceOAuthStateStore implements SalesforceOAuthStateStore {
  private readonly states = new Map<string, SalesforceOAuthState & { consumed: boolean }>()

  constructor(private readonly now: () => Date = () => new Date()) {}

  async create(input: CreateSalesforceOAuthState) {
    const current = this.now()
    const state = snapshotSalesforceOAuthState({
      ...snapshotSalesforceOAuthStateInput(input),
      createdAt: current.toISOString(),
      expiresAt: new Date(current.getTime() + 10 * 60_000).toISOString(),
    })
    for (const [key, stored] of this.states) {
      if (stored.teamId === state.teamId) this.states.delete(key)
    }
    this.states.set(state.stateHash, { ...state, consumed: false })
  }

  async consume(stateHash: string, userId: IntegrationIdentifier) {
    const safeHash = stateHashToken(stateHash)
    const safeUserId = snapshotIntegrationIdentifier(userId)
    const stored = this.states.get(safeHash)
    if (
      !stored || stored.consumed || stored.userId !== safeUserId ||
      new Date(stored.expiresAt).getTime() <= this.now().getTime()
    ) return null
    stored.consumed = true
    this.states.delete(safeHash)
    return snapshotSalesforceOAuthState(stored)
  }
}

export class PostgresSalesforceRefreshLeaseStore implements SalesforceRefreshLeaseStore {
  constructor(private readonly database: Database = getDatabase()) {}

  async acquire(
    teamId: IntegrationIdentifier,
    connectionId: IntegrationIdentifier,
    ownerToken: string,
  ) {
    const safeTeamId = snapshotIntegrationIdentifier(teamId)
    const safeConnectionId = snapshotIntegrationIdentifier(connectionId)
    const safeOwner = stateToken(ownerToken, "refresh lease owner")
    const rows = await this.database<{ readonly owner_token: string }[]>`
      INSERT INTO integration_refresh_leases (
        team_id, connection_id, owner_token, expires_at, updated_at
      ) VALUES (
        ${safeTeamId}, ${safeConnectionId}, ${safeOwner},
        statement_timestamp() + interval '2 minutes', statement_timestamp()
      )
      ON CONFLICT (team_id, connection_id) DO UPDATE
      SET owner_token = EXCLUDED.owner_token,
          expires_at = EXCLUDED.expires_at,
          updated_at = EXCLUDED.updated_at
      WHERE integration_refresh_leases.expires_at <= statement_timestamp()
      RETURNING owner_token
    `
    return rows[0]?.owner_token === safeOwner
  }

  async renew(
    teamId: IntegrationIdentifier,
    connectionId: IntegrationIdentifier,
    ownerToken: string,
  ) {
    const rows = await this.database<{ readonly owner_token: string }[]>`
      UPDATE integration_refresh_leases
      SET expires_at = statement_timestamp() + interval '2 minutes',
          updated_at = statement_timestamp()
      WHERE team_id = ${snapshotIntegrationIdentifier(teamId)}
        AND connection_id = ${snapshotIntegrationIdentifier(connectionId)}
        AND owner_token = ${stateToken(ownerToken, "refresh lease owner")}
        AND expires_at > statement_timestamp()
      RETURNING owner_token
    `
    return rows.length === 1
  }

  async release(
    teamId: IntegrationIdentifier,
    connectionId: IntegrationIdentifier,
    ownerToken: string,
  ) {
    await this.database`
      DELETE FROM integration_refresh_leases
      WHERE team_id = ${snapshotIntegrationIdentifier(teamId)}
        AND connection_id = ${snapshotIntegrationIdentifier(connectionId)}
        AND owner_token = ${stateToken(ownerToken, "refresh lease owner")}
    `
  }
}

export class MemorySalesforceRefreshLeaseStore implements SalesforceRefreshLeaseStore {
  private readonly leases = new Map<string, { owner: string; expiresAt: number }>()

  constructor(private readonly now: () => Date = () => new Date()) {}

  async acquire(
    teamId: IntegrationIdentifier,
    connectionId: IntegrationIdentifier,
    ownerToken: string,
  ) {
    const key = `${snapshotIntegrationIdentifier(teamId)}:${snapshotIntegrationIdentifier(connectionId)}`
    const owner = stateToken(ownerToken, "refresh lease owner")
    const currentTime = this.now().getTime()
    const expiry = currentTime + 120_000
    const existing = this.leases.get(key)
    if (existing && existing.expiresAt > currentTime) return false
    this.leases.set(key, { owner, expiresAt: expiry })
    return true
  }


  async renew(teamId: IntegrationIdentifier, connectionId: IntegrationIdentifier, ownerToken: string) {
    const key = `${snapshotIntegrationIdentifier(teamId)}:${snapshotIntegrationIdentifier(connectionId)}`
    const owner = stateToken(ownerToken, "refresh lease owner")
    const currentTime = this.now().getTime()
    const existing = this.leases.get(key)
    if (!existing || existing.owner !== owner || existing.expiresAt <= currentTime) return false
    existing.expiresAt = currentTime + 120_000
    return true
  }

  async release(teamId: IntegrationIdentifier, connectionId: IntegrationIdentifier, ownerToken: string) {
    const key = `${snapshotIntegrationIdentifier(teamId)}:${snapshotIntegrationIdentifier(connectionId)}`
    if (this.leases.get(key)?.owner === stateToken(ownerToken, "refresh lease owner")) {
      this.leases.delete(key)
    }
  }
}

export function snapshotSalesforceOAuthState(input: unknown): SalesforceOAuthState {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("Invalid OAuth state")
  const value = input as Record<string, unknown>
  const state = Object.freeze({
    stateHash: stateHashToken(value.stateHash),
    teamId: snapshotIntegrationIdentifier(value.teamId),
    attemptId: snapshotIntegrationIdentifier(value.attemptId),
    userId: snapshotIntegrationIdentifier(value.userId),
    codeVerifier: verifier(value.codeVerifier),
    returnPath: snapshotSalesforceReturnPath(value.returnPath),
    createdAt: validDate(value.createdAt, "OAuth state creation time").toISOString(),
    expiresAt: validDate(value.expiresAt, "OAuth state expiry").toISOString(),
  })
  if (new Date(state.expiresAt) <= new Date(state.createdAt)) {
    throw new TypeError("Invalid OAuth state expiry")
  }
  return state
}

function snapshotSalesforceOAuthStateInput(input: unknown): CreateSalesforceOAuthState {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("Invalid OAuth state")
  const value = input as Record<string, unknown>
  return Object.freeze({
    stateHash: stateHashToken(value.stateHash),
    teamId: snapshotIntegrationIdentifier(value.teamId),
    attemptId: snapshotIntegrationIdentifier(value.attemptId),
    userId: snapshotIntegrationIdentifier(value.userId),
    codeVerifier: verifier(value.codeVerifier),
    returnPath: snapshotSalesforceReturnPath(value.returnPath),
  })
}

function mapOAuthState(row: OAuthStateRow) {
  return snapshotSalesforceOAuthState({
    stateHash: row.state_hash,
    teamId: row.team_id,
    attemptId: row.attempt_id,
    userId: row.user_id,
    codeVerifier: row.code_verifier,
    returnPath: row.return_path,
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
  })
}

function stateToken(input: unknown, label: string) {
  if (typeof input !== "string" || !/^[A-Za-z0-9_-]{32,128}$/.test(input)) {
    throw new TypeError(`Invalid ${label}`)
  }
  return input
}

function stateHashToken(input: unknown) {
  if (typeof input !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(input)) {
    throw new TypeError("Invalid OAuth state hash")
  }
  return input
}

function verifier(input: unknown) {
  if (typeof input !== "string" || !/^[A-Za-z0-9._~-]{43,128}$/.test(input)) {
    throw new TypeError("Invalid OAuth code verifier")
  }
  return input
}

function validDate(input: unknown, label: string) {
  const date = input instanceof Date ? new Date(input) : new Date(typeof input === "string" ? input : NaN)
  if (!Number.isFinite(date.getTime())) throw new TypeError(`Invalid ${label}`)
  return date
}
