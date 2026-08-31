import "server-only"

import { getDatabase } from "../../db/database"
import {
  snapshotIntegrationIdentifier,
  type IntegrationIdentifier,
} from "../contract"
import {
  integrationNameForSocialProvider,
  snapshotSocialProviderName,
  snapshotSocialRedirectUri,
  snapshotSocialReturnPath,
  type SupportedSocialProviderName,
} from "./contract"

export interface SocialOAuthState {
  readonly stateHash: string
  readonly provider: SupportedSocialProviderName
  readonly teamId: IntegrationIdentifier
  readonly attemptId: IntegrationIdentifier
  readonly userId: IntegrationIdentifier
  readonly redirectUri: string
  readonly returnPath: string
  readonly createdAt: string
  readonly expiresAt: string
}

export type CreateSocialOAuthState = Omit<SocialOAuthState, "createdAt" | "expiresAt">

export interface SocialOAuthStateStore {
  create(state: CreateSocialOAuthState): Promise<void>
  consume(
    stateHash: string,
    provider: SupportedSocialProviderName,
    userId: IntegrationIdentifier,
  ): Promise<SocialOAuthState | null>
}

export interface SocialDisconnectLeaseStore {
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
  readonly provider: string
  readonly team_id: string
  readonly attempt_id: string
  readonly user_id: string
  readonly redirect_uri: string
  readonly return_path: string
  readonly created_at: Date
  readonly expires_at: Date
}

export class PostgresSocialOAuthStateStore implements SocialOAuthStateStore {
  constructor(private readonly database: Database = getDatabase()) {}

  async create(input: CreateSocialOAuthState) {
    const state = snapshotSocialOAuthStateInput(input)
    const provider = integrationNameForSocialProvider(state.provider)
    await this.database.begin(async (transaction) => {
      await transaction`SELECT id FROM teams WHERE id = ${state.teamId} FOR UPDATE`
      await transaction`
        DELETE FROM integration_oauth_states
        WHERE team_id = ${state.teamId} AND provider = ${provider}
      `
      await transaction`
        INSERT INTO integration_oauth_attempts (
          team_id, provider, attempt_id, user_id, created_at, expires_at
        ) VALUES (
          ${state.teamId}, ${provider}, ${state.attemptId}, ${state.userId},
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
          redirect_uri, return_path, created_at, expires_at
        ) VALUES (
          ${state.stateHash}, ${provider}, ${state.teamId}, ${state.attemptId},
          ${state.userId}, NULL, ${state.redirectUri}, ${state.returnPath},
          statement_timestamp(), statement_timestamp() + interval '10 minutes'
        )
      `
      await transaction`
        DELETE FROM integration_oauth_attempts
        WHERE expires_at <= statement_timestamp()
      `
    })
  }

  async consume(
    stateHash: string,
    providerInput: SupportedSocialProviderName,
    userId: IntegrationIdentifier,
  ) {
    const safeHash = stateHashToken(stateHash)
    const provider = integrationNameForSocialProvider(providerInput)
    const safeUserId = snapshotIntegrationIdentifier(userId)
    const rows = await this.database<OAuthStateRow[]>`
      DELETE FROM integration_oauth_states AS state
      USING integration_oauth_attempts AS attempt
      WHERE state.state_hash = ${safeHash}
        AND state.provider = ${provider}
        AND state.user_id = ${safeUserId}
        AND state.expires_at > statement_timestamp()
        AND attempt.team_id = state.team_id
        AND attempt.provider = state.provider
        AND attempt.attempt_id = state.attempt_id
        AND attempt.user_id = state.user_id
        AND attempt.expires_at > statement_timestamp()
      RETURNING state.state_hash, state.provider, state.team_id, state.attempt_id,
        state.user_id, state.redirect_uri, state.return_path,
        state.created_at, state.expires_at
    `
    return rows[0] ? mapOAuthState(rows[0]) : null
  }
}

export class PostgresSocialDisconnectLeaseStore implements SocialDisconnectLeaseStore {
  constructor(private readonly database: Database = getDatabase()) {}

  async acquire(
    teamId: IntegrationIdentifier,
    connectionId: IntegrationIdentifier,
    ownerToken: string,
  ) {
    const safeTeamId = snapshotIntegrationIdentifier(teamId)
    const safeConnectionId = snapshotIntegrationIdentifier(connectionId)
    const owner = leaseOwner(ownerToken)
    const rows = await this.database<{ readonly owner_token: string }[]>`
      INSERT INTO integration_refresh_leases (
        team_id, connection_id, owner_token, expires_at, updated_at
      ) VALUES (
        ${safeTeamId}, ${safeConnectionId}, ${owner},
        statement_timestamp() + interval '2 minutes', statement_timestamp()
      )
      ON CONFLICT (team_id, connection_id) DO UPDATE
      SET owner_token = EXCLUDED.owner_token,
          expires_at = EXCLUDED.expires_at,
          updated_at = EXCLUDED.updated_at
      WHERE integration_refresh_leases.expires_at <= statement_timestamp()
      RETURNING owner_token
    `
    return rows[0]?.owner_token === owner
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
        AND owner_token = ${leaseOwner(ownerToken)}
    `
  }

  async renew(
    teamId: IntegrationIdentifier,
    connectionId: IntegrationIdentifier,
    ownerToken: string,
  ) {
    const owner = leaseOwner(ownerToken)
    const rows = await this.database<{ readonly owner_token: string }[]>`
      UPDATE integration_refresh_leases
      SET expires_at = statement_timestamp() + interval '2 minutes',
          updated_at = statement_timestamp()
      WHERE team_id = ${snapshotIntegrationIdentifier(teamId)}
        AND connection_id = ${snapshotIntegrationIdentifier(connectionId)}
        AND owner_token = ${owner}
        AND expires_at > statement_timestamp()
      RETURNING owner_token
    `
    return rows[0]?.owner_token === owner
  }
}

export class MemorySocialOAuthStateStore implements SocialOAuthStateStore {
  readonly #states = new Map<string, SocialOAuthState>()

  constructor(private readonly now: () => Date = () => new Date()) {}

  async create(input: CreateSocialOAuthState) {
    const current = this.now()
    const state = snapshotSocialOAuthState({
      ...snapshotSocialOAuthStateInput(input),
      createdAt: current.toISOString(),
      expiresAt: new Date(current.getTime() + 10 * 60_000).toISOString(),
    })
    for (const [key, existing] of this.#states) {
      if (existing.teamId === state.teamId && existing.provider === state.provider) {
        this.#states.delete(key)
      }
    }
    this.#states.set(state.stateHash, state)
  }

  async consume(
    stateHash: string,
    provider: SupportedSocialProviderName,
    userId: IntegrationIdentifier,
  ) {
    const safeHash = stateHashToken(stateHash)
    const safeProvider = snapshotSocialProviderName(provider)
    const safeUserId = snapshotIntegrationIdentifier(userId)
    const state = this.#states.get(safeHash)
    if (
      !state ||
      state.provider !== safeProvider ||
      state.userId !== safeUserId ||
      Date.parse(state.expiresAt) <= this.now().getTime()
    ) {
      return null
    }
    this.#states.delete(safeHash)
    return snapshotSocialOAuthState(state)
  }
}

export function snapshotSocialOAuthState(input: unknown): SocialOAuthState {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Invalid social OAuth state")
  }
  const value = input as Record<string, unknown>
  const provider = snapshotSocialProviderName(value.provider)
  const createdAt = timestamp(value.createdAt, "OAuth state creation time")
  const expiresAt = timestamp(value.expiresAt, "OAuth state expiry")
  if (Date.parse(expiresAt) <= Date.parse(createdAt)) {
    throw new TypeError("Invalid OAuth state expiry")
  }
  return Object.freeze({
    stateHash: stateHashToken(value.stateHash),
    provider,
    teamId: snapshotIntegrationIdentifier(value.teamId),
    attemptId: snapshotIntegrationIdentifier(value.attemptId),
    userId: snapshotIntegrationIdentifier(value.userId),
    redirectUri: snapshotSocialRedirectUri(value.redirectUri, provider),
    returnPath: snapshotSocialReturnPath(value.returnPath),
    createdAt,
    expiresAt,
  })
}

function snapshotSocialOAuthStateInput(input: unknown): CreateSocialOAuthState {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Invalid social OAuth state")
  }
  const value = input as Record<string, unknown>
  const provider = snapshotSocialProviderName(value.provider)
  return Object.freeze({
    stateHash: stateHashToken(value.stateHash),
    provider,
    teamId: snapshotIntegrationIdentifier(value.teamId),
    attemptId: snapshotIntegrationIdentifier(value.attemptId),
    userId: snapshotIntegrationIdentifier(value.userId),
    redirectUri: snapshotSocialRedirectUri(value.redirectUri, provider),
    returnPath: snapshotSocialReturnPath(value.returnPath),
  })
}

function mapOAuthState(row: OAuthStateRow) {
  return snapshotSocialOAuthState({
    stateHash: row.state_hash,
    provider: row.provider,
    teamId: row.team_id,
    attemptId: row.attempt_id,
    userId: row.user_id,
    redirectUri: row.redirect_uri,
    returnPath: row.return_path,
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
  })
}

function stateHashToken(input: unknown) {
  if (typeof input !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(input)) {
    throw new TypeError("Invalid OAuth state hash")
  }
  return input
}

function leaseOwner(input: unknown) {
  if (typeof input !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(input)) {
    throw new TypeError("Invalid social disconnect lease owner")
  }
  return input
}

function timestamp(input: unknown, label: string) {
  const date = new Date(typeof input === "string" ? input : NaN)
  if (!Number.isFinite(date.getTime())) throw new TypeError(`Invalid ${label}`)
  return date.toISOString()
}
