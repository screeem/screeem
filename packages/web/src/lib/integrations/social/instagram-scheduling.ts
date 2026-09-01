import "server-only"

import { randomUUID } from "node:crypto"
import {
  InstagramAssetResolutionError,
  InvalidInstagramPostContractError,
  UnsupportedInstagramPostVersionError,
  decodeInstagramScheduledPostInputV1,
  decodeScheduledInstagramPostV1,
  encodeInstagramScheduledPostInputV1,
  encodeScheduledInstagramPostV1,
  materializeScheduledInstagramPostV1,
  type InstagramScheduledPostInputV1Encoded,
  type ScheduledInstagramPostV1Encoded,
} from "@screeem/integrations/social/instagram"
import { Data, Effect, Either } from "effect"

import { getDatabase } from "../../db/database"
import { snapshotIntegrationIdentifier } from "../contract"

export interface CreateApprovedInstagramTarget {
  readonly teamId: string
  readonly calendarPostId: string
  readonly expectedCalendarRevision: number
  readonly requestId: string
  readonly actorId: string
}

export class InstagramSchedulingRequestError extends Data.TaggedError(
  "InstagramSchedulingRequestError",
)<{ readonly reason: "invalid" }> {
  readonly code = "instagram_scheduling_request_invalid" as const
}

export class InstagramSchedulingAuthorizationError extends Data.TaggedError(
  "InstagramSchedulingAuthorizationError",
)<{ readonly reason: "forbidden" }> {
  readonly code = "instagram_scheduling_forbidden" as const
}

export class InstagramSchedulingStateError extends Data.TaggedError(
  "InstagramSchedulingStateError",
)<{
  readonly reason:
    | "asset_unavailable"
    | "calendar_missing"
    | "connection_unavailable"
    | "integration_disabled"
    | "not_approved"
    | "request_conflict"
    | "revision_conflict"
    | "target_not_configured"
}> {
  readonly code = "instagram_scheduling_state_conflict" as const
}

export class InstagramSchedulingPersistenceError extends Data.TaggedError(
  "InstagramSchedulingPersistenceError",
)<{ readonly operation: "create" | "load" }> {
  readonly code = "instagram_scheduling_persistence_failed" as const
}

export type InstagramSchedulingFailure =
  | InstagramSchedulingRequestError
  | InstagramSchedulingAuthorizationError
  | InstagramSchedulingStateError
  | InstagramSchedulingPersistenceError

type Database = ReturnType<typeof getDatabase>

interface CalendarWorkflowRow {
  readonly revision: number | string
  readonly status: string
  readonly review_revision: number | string | null
}

interface CalendarEventRow {
  readonly id: number | string
  readonly client_event_id: string
  readonly event_type: string
  readonly payload: unknown
  readonly reverts_event_id: number | string | null
}

interface ConnectionRow {
  readonly id: string
  readonly external_account_id: string | null
  readonly status: string
  readonly enabled: boolean
}

interface AssetRow {
  readonly id: string
  readonly checksum: string
  readonly status: string
  readonly asset_contract: unknown
}

interface TargetRow {
  readonly calendar_post_id: string
  readonly calendar_revision: number | string
  readonly provider: string
  readonly connection_id: string
  readonly external_account_id: string
  readonly status: string
  readonly target_contract: unknown
}

interface TargetConfiguration {
  readonly clientEventId: string
  readonly input: unknown
}

export class PostgresInstagramSchedulingStore {
  constructor(
    private readonly database: Database = getDatabase(),
    private readonly newId: () => string = randomUUID,
    private readonly now: () => Date = () => new Date(),
  ) {}

  createApprovedTarget(
    input: CreateApprovedInstagramTarget,
  ): Effect.Effect<ScheduledInstagramPostV1Encoded, InstagramSchedulingFailure> {
    return Effect.tryPromise({
      try: () => this.persist(input),
      catch: schedulingFailure,
    })
  }

  private async persist(input: CreateApprovedInstagramTarget) {
    const request = schedulingRequest(input)
    return this.database.begin(async (transaction) => {
      await transaction`SELECT pg_advisory_xact_lock(hashtextextended(
        ${`${request.teamId}:${request.requestId}`}, 0
      ))`
      await transaction`SELECT pg_advisory_xact_lock(hashtextextended(
        ${`${request.teamId}:${request.calendarPostId}`}, 1
      ))`

      const memberships = await transaction<{ readonly present: boolean }[]>`
        SELECT true AS present
        FROM team_members
        WHERE team_id = ${request.teamId} AND user_id = ${request.actorId}
        FOR KEY SHARE
      `
      if (!memberships[0]) {
        throw new InstagramSchedulingAuthorizationError({ reason: "forbidden" })
      }

      const workflows = await transaction<CalendarWorkflowRow[]>`
        SELECT revision, status, review_revision
        FROM calendar_post_workflows
        WHERE team_id = ${request.teamId}
          AND aggregate_id = ${request.calendarPostId}
        FOR UPDATE
      `
      const workflow = workflows[0]
      if (!workflow) {
        throw new InstagramSchedulingStateError({ reason: "calendar_missing" })
      }

      const existingRequest = await transaction<TargetRow[]>`
        SELECT calendar_post_id, calendar_revision, provider, connection_id,
          external_account_id, status, target_contract
        FROM social_post_targets
        WHERE team_id = ${request.teamId} AND request_id = ${request.requestId}
      `
      if (existingRequest[0]) {
        if (existingRequest[0].calendar_post_id !== request.calendarPostId) {
          throw new InstagramSchedulingStateError({ reason: "request_conflict" })
        }
      }

      const revision = positiveDatabaseInteger(workflow.revision)
      if (revision !== request.expectedCalendarRevision) {
        throw new InstagramSchedulingStateError({ reason: "revision_conflict" })
      }
      if (workflow.status !== "approved"
        || positiveDatabaseIntegerOrNull(workflow.review_revision) !== revision) {
        throw new InstagramSchedulingStateError({ reason: "not_approved" })
      }

      const eventRows = await transaction<CalendarEventRow[]>`
        SELECT id, client_event_id, event_type, payload, reverts_event_id
        FROM calendar_events
        WHERE team_id = ${request.teamId} AND aggregate_id = ${request.calendarPostId}
        ORDER BY id
      `
      const instagramState = currentInstagramConfiguration(eventRows)
      if (!instagramState.postExists) {
        throw new InstagramSchedulingStateError({ reason: "calendar_missing" })
      }
      const configuration = instagramState.configuration
      if (!configuration) {
        throw new InstagramSchedulingStateError({ reason: "target_not_configured" })
      }
      const encodedInput = await decodeConfiguredInput(configuration.input)

      const connections = await transaction<ConnectionRow[]>`
        SELECT id, external_account_id, status, enabled
        FROM integration_connections
        WHERE team_id = ${request.teamId} AND provider = 'instagram'
        FOR UPDATE
      `
      const connection = connections[0]
      if (!connection
        || connection.status !== "connected"
        || !connection.enabled
        || connection.external_account_id === null) {
        throw new InstagramSchedulingStateError({ reason: "connection_unavailable" })
      }

      const credentials = await transaction<{ readonly present: boolean }[]>`
        SELECT true AS present
        FROM integration_credentials
        WHERE team_id = ${request.teamId} AND connection_id = ${connection.id}
        FOR KEY SHARE
      `
      if (!credentials[0]) {
        throw new InstagramSchedulingStateError({ reason: "connection_unavailable" })
      }
      await transaction`
        INSERT INTO integration_team_controls (
          team_id, revision, enabled, updated_by, updated_at
        ) VALUES (
          ${request.teamId}, 1, true, ${request.actorId}, statement_timestamp()
        )
        ON CONFLICT (team_id) DO NOTHING
      `
      const controls = await transaction<{ readonly enabled: boolean }[]>`
        SELECT enabled
        FROM integration_team_controls
        WHERE team_id = ${request.teamId}
        FOR UPDATE
      `
      if (controls[0]?.enabled === false) {
        throw new InstagramSchedulingStateError({ reason: "integration_disabled" })
      }

      const references = inputAssetReferences(encodedInput)
      const uniqueReferences = [...new Map(
        references.map((reference) => [assetReferenceKey(reference), reference]),
      ).values()].sort((left, right) =>
        assetReferenceKey(left).localeCompare(assetReferenceKey(right))
      )
      const inspectedAssets: unknown[] = []
      for (const reference of uniqueReferences) {
        const rows = await transaction<AssetRow[]>`
          SELECT id, checksum, status, asset_contract
          FROM social_media_assets
          WHERE team_id = ${request.teamId}
            AND id = ${reference.assetId}
            AND checksum = ${reference.checksum}
          FOR SHARE
        `
        if (!rows[0] || rows[0].status !== "ready") {
          throw new InstagramSchedulingStateError({ reason: "asset_unavailable" })
        }
        inspectedAssets.push(rows[0].asset_contract)
      }

      if (existingRequest[0]) {
        if (!targetMatchesAuthority(existingRequest[0], revision, connection)) {
          throw new InstagramSchedulingStateError({ reason: "request_conflict" })
        }
        return decodeStoredTarget(existingRequest[0].target_contract)
      }

      const sameRevision = await transaction<TargetRow[]>`
        SELECT calendar_post_id, calendar_revision, provider, connection_id,
          external_account_id, status, target_contract
        FROM social_post_targets
        WHERE team_id = ${request.teamId}
          AND calendar_post_id = ${request.calendarPostId}
          AND provider = 'instagram'
          AND calendar_revision = ${revision}
        FOR UPDATE
      `
      if (sameRevision[0]) {
        throw new InstagramSchedulingStateError({ reason: "request_conflict" })
      }

      const targetId = snapshotIntegrationIdentifier(this.newId())
      const createdAt = this.now().toISOString()
      const materialized = await Effect.runPromise(Effect.either(
        materializeScheduledInstagramPostV1(
          encodedInput,
          {
            schema: "screeem.social-post-target",
            schemaVersion: 1,
            id: targetId,
            teamId: request.teamId,
            calendarPostId: request.calendarPostId,
            calendarRevision: revision,
            connectionId: connection.id,
            schedule: encodedInput.schedule,
            createdBy: request.actorId,
            createdAt,
          },
          inspectedAssets,
        ).pipe(Effect.flatMap(encodeScheduledInstagramPostV1)),
      ))
      if (Either.isLeft(materialized)) throw materialized.left
      const target = materialized.right

      await transaction`
        UPDATE social_post_targets
        SET status = 'superseded', superseded_at = ${createdAt}
        WHERE team_id = ${request.teamId}
          AND calendar_post_id = ${request.calendarPostId}
          AND provider = 'instagram'
          AND status = 'scheduled'
      `
      await transaction`
        INSERT INTO social_post_targets (
          id, team_id, request_id, calendar_post_id, calendar_revision,
          provider, connection_id, external_account_id, source_client_event_id,
          schema_version, template_version, target_contract, publish_at,
          timezone, status, created_by, created_at
        ) VALUES (
          ${target.id}, ${request.teamId}, ${request.requestId},
          ${request.calendarPostId}, ${revision}, 'instagram', ${connection.id},
          ${connection.external_account_id}, ${configuration.clientEventId},
          ${target.schemaVersion}, ${target.template.version},
          ${transaction.json(target as never)}, ${target.schedule.publishAt},
          ${target.schedule.timezone}, 'scheduled', ${request.actorId}, ${createdAt}
        )
      `
      for (const [ordinal, reference] of references.entries()) {
        await transaction`
          INSERT INTO social_post_target_assets (
            team_id, target_id, ordinal, asset_id, checksum
          ) VALUES (
            ${request.teamId}, ${target.id}, ${ordinal},
            ${reference.assetId}, ${reference.checksum}
          )
        `
      }
      return target
    })
  }
}

function schedulingRequest(input: CreateApprovedInstagramTarget) {
  try {
    const expectedCalendarRevision = positiveSafeInteger(input.expectedCalendarRevision)
    return Object.freeze({
      teamId: snapshotIntegrationIdentifier(input.teamId),
      calendarPostId: snapshotIntegrationIdentifier(input.calendarPostId),
      requestId: snapshotIntegrationIdentifier(input.requestId),
      actorId: snapshotIntegrationIdentifier(input.actorId),
      expectedCalendarRevision,
    })
  } catch {
    throw new InstagramSchedulingRequestError({ reason: "invalid" })
  }
}

async function decodeConfiguredInput(input: unknown) {
  try {
    return await Effect.runPromise(
      decodeInstagramScheduledPostInputV1(input).pipe(
        Effect.flatMap(encodeInstagramScheduledPostInputV1),
      ),
    )
  } catch {
    throw new InstagramSchedulingStateError({ reason: "target_not_configured" })
  }
}

async function decodeStoredTarget(input: unknown) {
  try {
    return await Effect.runPromise(
      decodeScheduledInstagramPostV1(input).pipe(
        Effect.flatMap(encodeScheduledInstagramPostV1),
      ),
    )
  } catch {
    throw new InstagramSchedulingPersistenceError({ operation: "load" })
  }
}

function currentInstagramConfiguration(rows: readonly CalendarEventRow[]): {
  readonly postExists: boolean
  readonly configuration: TargetConfiguration | null
} {
  const activeIds = activeEventIds(rows)
  let postExists = false
  let targetEnabled = false
  let lastTargetTransitionId = 0
  let configuration: TargetConfiguration | null = null

  for (const row of rows) {
    const id = positiveDatabaseInteger(row.id)
    if (!activeIds.has(id)) continue
    const payload = objectRecord(row.payload)
    if (row.event_type === "post.created") {
      postExists = true
      const enabled = Array.isArray(payload?.targets) && payload.targets.includes("Instagram")
      targetEnabled = enabled
      if (enabled) lastTargetTransitionId = id
    } else if (row.event_type === "target.added" && payload?.value === "Instagram") {
      if (!targetEnabled) lastTargetTransitionId = id
      targetEnabled = true
    } else if (row.event_type === "target.removed" && payload?.value === "Instagram") {
      if (targetEnabled) lastTargetTransitionId = id
      targetEnabled = false
    } else if (row.event_type === "instagram.target.configured" && payload) {
      configuration = { clientEventId: row.client_event_id, input: payload.input }
    }
  }

  if (!targetEnabled || !configuration) return { postExists, configuration: null }
  const configuredRow = [...rows].reverse().find((row) =>
    activeIds.has(positiveDatabaseInteger(row.id))
      && row.event_type === "instagram.target.configured"
      && row.client_event_id === configuration?.clientEventId
  )
  return {
    postExists,
    configuration: configuredRow && positiveDatabaseInteger(configuredRow.id) > lastTargetTransitionId
      ? configuration
      : null,
  }
}

function activeEventIds(rows: readonly CalendarEventRow[]): ReadonlySet<number> {
  const active = new Set<number>()
  const reverted = new Set<number>()
  for (const row of [...rows].reverse()) {
    const id = positiveDatabaseInteger(row.id)
    if (reverted.has(id)) continue
    active.add(id)
    if (row.event_type === "change.reverted" && row.reverts_event_id !== null) {
      reverted.add(positiveDatabaseInteger(row.reverts_event_id))
    }
  }
  return active
}

function inputAssetReferences(input: InstagramScheduledPostInputV1Encoded) {
  if (input.template.kind === "instagram.image") return [input.template.image.asset]
  if (input.template.kind === "instagram.reel") return [input.template.video.asset]
  return input.template.items.map((item) => item.asset)
}

function assetReferenceKey(reference: { readonly assetId: string; readonly checksum: string }) {
  return `${reference.assetId}:${reference.checksum}`
}

function targetMatchesAuthority(
  target: TargetRow,
  revision: number,
  connection: ConnectionRow,
): boolean {
  return positiveDatabaseInteger(target.calendar_revision) === revision
    && target.provider === "instagram"
    && target.status === "scheduled"
    && target.connection_id === connection.id
    && target.external_account_id === connection.external_account_id
}

function schedulingFailure(error: unknown): InstagramSchedulingFailure {
  if (error instanceof InstagramSchedulingRequestError
    || error instanceof InstagramSchedulingAuthorizationError
    || error instanceof InstagramSchedulingStateError
    || error instanceof InstagramSchedulingPersistenceError) return error
  if (error instanceof InstagramAssetResolutionError
    || error instanceof InvalidInstagramPostContractError
    || error instanceof UnsupportedInstagramPostVersionError) {
    return new InstagramSchedulingStateError({ reason: "asset_unavailable" })
  }
  return new InstagramSchedulingPersistenceError({ operation: "create" })
}

function positiveSafeInteger(input: unknown): number {
  if (typeof input !== "number" || !Number.isSafeInteger(input) || input <= 0) {
    throw new TypeError("Expected a positive integer")
  }
  return input
}

function positiveDatabaseInteger(input: number | string): number {
  const value = typeof input === "number" ? input : Number(input)
  return positiveSafeInteger(value)
}

function positiveDatabaseIntegerOrNull(input: number | string | null): number | null {
  return input === null ? null : positiveDatabaseInteger(input)
}

function objectRecord(input: unknown): Record<string, unknown> | null {
  return input !== null && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : null
}
