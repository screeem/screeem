import "server-only"

import {
  decodeSocialDeliveryEventActionV1,
  decodeSocialDeliveryEventV1,
  encodeSocialDeliveryEventActionV1,
  encodeSocialDeliveryEventV1,
  InvalidSocialDeliveryEventContractError,
  materializeSocialDeliveryEventV1,
  type SocialDeliveryEventActionV1Encoded,
  type SocialDeliveryEventContractError,
  type SocialDeliveryEventV1Encoded,
  UnsupportedSocialDeliveryEventVersionError,
} from "@screeem/integrations/social"
import { Data, Effect, Either } from "effect"
import type postgres from "postgres"

import { getDatabase } from "../../db/database"
import { snapshotIntegrationIdentifier } from "../contract"

export interface SealedSocialDeliveryReceipt {
  readonly expectedPreviousRevision: number
  readonly keyId: string
  readonly sealedPayload: string
}

export interface AppendSystemSocialDeliveryEvent {
  readonly teamId: string
  readonly targetId: string
  readonly eventId: string
  readonly action: unknown
  readonly receipt?: SealedSocialDeliveryReceipt
}

export class SocialDeliveryEventRequestError extends Data.TaggedError(
  "SocialDeliveryEventRequestError",
)<{ readonly reason: "invalid" }> {}

export class SocialDeliveryEventStateError extends Data.TaggedError(
  "SocialDeliveryEventStateError",
)<{
  readonly reason:
    | "invalid_transition"
    | "receipt_conflict"
    | "request_conflict"
    | "target_inactive"
    | "target_missing"
}> {}

export class SocialDeliveryEventPersistenceError extends Data.TaggedError(
  "SocialDeliveryEventPersistenceError",
)<{ readonly operation: "append" | "load" }> {}

export type SocialDeliveryEventFailure =
  | SocialDeliveryEventContractError
  | SocialDeliveryEventRequestError
  | SocialDeliveryEventStateError
  | SocialDeliveryEventPersistenceError

type Database = ReturnType<typeof getDatabase>
type DatabaseTransaction = postgres.TransactionSql

interface TargetRow {
  readonly calendar_post_id: string
  readonly calendar_revision: number | string
  readonly provider: string
  readonly status: string
}

interface EventRow {
  readonly sequence: number | string
  readonly event_id: string
  readonly event_type: string
  readonly event_contract: unknown
}

interface ReceiptRow {
  readonly attempt_id: string
  readonly revision: number | string
  readonly key_id: string
  readonly sealed_payload: string
}

type PublishEvent = Extract<
  SocialDeliveryEventV1Encoded,
  { eventType:
    | "publish.started"
    | "publish.progressed"
    | "publish.resumed"
    | "publish.succeeded"
    | "publish.failed"
    | "publish.uncertain" }
>

export class PostgresSocialDeliveryEventStore {
  constructor(
    private readonly database: Database = getDatabase(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  appendSystemEvent(
    input: AppendSystemSocialDeliveryEvent,
  ): Effect.Effect<SocialDeliveryEventV1Encoded, SocialDeliveryEventFailure> {
    return Effect.tryPromise({
      try: () => this.persist(input),
      catch: deliveryFailure,
    })
  }

  private async persist(input: AppendSystemSocialDeliveryEvent) {
    const request = deliveryRequest(input)
    const action = await canonicalAction(request.action)
    if (action.eventType.startsWith("target.")) {
      throw new SocialDeliveryEventRequestError({ reason: "invalid" })
    }
    const receipt = deliveryReceipt(request.receipt, action)
    const occurredAt = this.now().toISOString()

    return this.database.begin(async (transaction) => {
      await transaction`SELECT pg_advisory_xact_lock(hashtextextended(
        ${`${request.teamId}:${request.eventId}`}, 2
      ))`
      const targets = await transaction<TargetRow[]>`
        SELECT calendar_post_id, calendar_revision, provider, status
        FROM social_post_targets
        WHERE team_id = ${request.teamId} AND id = ${request.targetId}
        FOR UPDATE
      `
      const target = targets[0]
      if (!target) {
        throw new SocialDeliveryEventStateError({ reason: "target_missing" })
      }
      if (target.provider !== "instagram") {
        throw new SocialDeliveryEventStateError({ reason: "target_inactive" })
      }

      const identities = await transaction<{ readonly target_id: string }[]>`
        SELECT target_id
        FROM social_delivery_events
        WHERE team_id = ${request.teamId} AND event_id = ${request.eventId}
      `
      if (identities[0] && identities[0].target_id !== request.targetId) {
        throw new SocialDeliveryEventStateError({ reason: "request_conflict" })
      }

      const rows = await transaction<EventRow[]>`
        SELECT sequence, event_id, event_type, event_contract
        FROM social_delivery_events
        WHERE team_id = ${request.teamId} AND target_id = ${request.targetId}
        ORDER BY sequence
      `
      const events = await decodeStoredEvents(rows)
      const existingIndex = rows.findIndex((row) => row.event_id === request.eventId)
      if (existingIndex >= 0) {
        const existing = events[existingIndex]
        if (!existing || canonicalJson(eventAction(existing)) !== canonicalJson(action)) {
          throw new SocialDeliveryEventStateError({ reason: "request_conflict" })
        }
        if (newReceiptRevision(action) !== null) {
          await verifyReceiptReplay(transaction, request, action, receipt)
        }
        return existing
      }

      validateTransition(action, target.status, events, new Date(occurredAt))
      if (action.eventType === "publish.resumed") {
        await verifyResumeReceipt(transaction, request, action)
      }
      const sequence = rows.length === 0
        ? 1
        : positiveDatabaseInteger(rows[rows.length - 1]!.sequence) + 1
      const event = await materializeEvent(
        action,
        request.teamId,
        request.targetId,
        request.eventId,
        sequence,
        occurredAt,
      )

      await transaction`
        INSERT INTO social_delivery_events (
          team_id, target_id, sequence, event_id, provider, event_type,
          schema_version, event_contract, actor_kind, system_source, occurred_at
        ) VALUES (
          ${request.teamId}, ${request.targetId}, ${sequence}, ${request.eventId},
          'instagram', ${action.eventType}, 1, ${transaction.json(event as never)},
          'system', 'dispatcher', ${occurredAt}
        )
      `
      if (newReceiptRevision(action) !== null) {
        await persistReceipt(transaction, request, action, receipt, occurredAt)
      }
      if (isTerminalPublishAction(action)) {
        await supersedeAfterCalendarChange(
          transaction,
          request,
          target,
          occurredAt,
        )
      }
      return event
    })
  }
}

function deliveryRequest(input: AppendSystemSocialDeliveryEvent) {
  try {
    return Object.freeze({
      teamId: snapshotIntegrationIdentifier(input.teamId),
      targetId: snapshotIntegrationIdentifier(input.targetId),
      eventId: snapshotIntegrationIdentifier(input.eventId),
      action: input.action,
      receipt: input.receipt,
    })
  } catch {
    throw new SocialDeliveryEventRequestError({ reason: "invalid" })
  }
}

async function canonicalAction(input: unknown): Promise<SocialDeliveryEventActionV1Encoded> {
  const result = await Effect.runPromise(Effect.either(
    decodeSocialDeliveryEventActionV1(input).pipe(
      Effect.flatMap(encodeSocialDeliveryEventActionV1),
    ),
  ))
  if (Either.isLeft(result)) throw result.left
  return result.right
}

function deliveryReceipt(
  input: SealedSocialDeliveryReceipt | undefined,
  action: SocialDeliveryEventActionV1Encoded,
): SealedSocialDeliveryReceipt | null {
  const revision = newReceiptRevision(action)
  if (revision === null) {
    if (input !== undefined) throw new SocialDeliveryEventRequestError({ reason: "invalid" })
    return null
  }
  if (!input
    || !Number.isSafeInteger(input.expectedPreviousRevision)
    || input.expectedPreviousRevision < 0
    || typeof input.keyId !== "string"
    || !/^[A-Za-z0-9._-]{1,128}$/.test(input.keyId)
    || typeof input.sealedPayload !== "string"
    || input.sealedPayload.length > 131_072
    || !/^v[0-9]+\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/.test(input.sealedPayload)) {
    throw new SocialDeliveryEventRequestError({ reason: "invalid" })
  }
  if (revision !== input.expectedPreviousRevision + 1) {
    throw new SocialDeliveryEventStateError({ reason: "receipt_conflict" })
  }
  return Object.freeze({ ...input })
}

async function decodeStoredEvents(rows: readonly EventRow[]) {
  const events: SocialDeliveryEventV1Encoded[] = []
  for (const [index, row] of rows.entries()) {
    const result = await Effect.runPromise(Effect.either(
      decodeSocialDeliveryEventV1(row.event_contract).pipe(
        Effect.flatMap(encodeSocialDeliveryEventV1),
      ),
    ))
    if (Either.isLeft(result)) {
      throw new SocialDeliveryEventPersistenceError({ operation: "load" })
    }
    if (result.right.sequence !== positiveDatabaseInteger(row.sequence)
      || result.right.sequence !== index + 1
      || result.right.id !== row.event_id
      || result.right.eventType !== row.event_type) {
      throw new SocialDeliveryEventPersistenceError({ operation: "load" })
    }
    events.push(result.right)
  }
  return events
}

function validateTransition(
  action: SocialDeliveryEventActionV1Encoded,
  targetStatus: string,
  events: readonly SocialDeliveryEventV1Encoded[],
  occurredAt: Date,
) {
  const latestPublish = [...events].reverse().find(isPublishEvent)
  const latestDelete = [...events].reverse().find((event) =>
    event.eventType.startsWith("remote-delete.")
  )

  if (action.eventType === "publish.started") {
    if (targetStatus !== "scheduled") return invalidTarget()
    if (events.some((event) =>
      isPublishEvent(event) && event.data.attemptId === action.data.attemptId
    )) return invalidTransition()
    if (!latestPublish) return
    if (latestPublish.eventType !== "publish.failed"
      || !latestPublish.data.retryable
      || latestPublish.data.retryMode !== "restart") {
      return invalidTransition()
    }
    if (!retryIsDue(latestPublish.data.retryAt, occurredAt)) return invalidTransition()
    return
  }

  if (action.eventType === "publish.resumed") {
    if (targetStatus !== "scheduled") return invalidTarget()
    if (!latestPublish
      || latestPublish.eventType !== "publish.failed"
      || !latestPublish.data.retryable
      || latestPublish.data.retryMode !== "resume"
      || latestPublish.data.attemptId !== action.data.attemptId
      || latestPublish.data.receipt.revision !== action.data.receiptRevision
      || !retryIsDue(latestPublish.data.retryAt, occurredAt)) {
      return invalidTransition()
    }
    return
  }

  if (action.eventType === "publish.progressed"
    || action.eventType === "publish.succeeded"
    || action.eventType === "publish.failed"
    || action.eventType === "publish.uncertain") {
    if (!latestPublish
      || (latestPublish.eventType !== "publish.started"
        && latestPublish.eventType !== "publish.resumed"
        && latestPublish.eventType !== "publish.progressed")
      || latestPublish.data.attemptId !== action.data.attemptId) {
      return invalidTransition()
    }
    const previousRevision = currentReceiptRevision(events, action.data.attemptId)
    if (action.eventType === "publish.progressed"
      && action.data.receiptRevision !== previousRevision + 1) {
      return invalidTransition()
    }
    if (action.eventType === "publish.succeeded"
      && (previousRevision === 0
        || action.data.receiptRevision !== previousRevision + 1)) {
      return invalidTransition()
    }
    if (action.eventType === "publish.failed") {
      const failureRevision = action.data.receipt.revision ?? 0
      const expectedRevision = action.data.receipt.kind === "recorded"
        ? previousRevision + 1
        : previousRevision
      if (failureRevision !== expectedRevision) return invalidTransition()
    }
    if (action.eventType === "publish.succeeded"
      && latestPublish.eventType === "publish.started") return invalidTransition()
    return
  }

  if (action.eventType !== "remote-delete.requested"
    && action.eventType !== "remote-delete.succeeded"
    && action.eventType !== "remote-delete.failed") {
    return invalidTransition()
  }

  const published = [...events].reverse().find((event) =>
    event.eventType === "publish.succeeded"
  )
  if (!published || published.data.remotePostId !== action.data.remotePostId) {
    return invalidTransition()
  }
  if (action.eventType === "remote-delete.requested") {
    if (!latestDelete) return
    if (latestDelete.eventType !== "remote-delete.failed"
      || !latestDelete.data.retryable) return invalidTransition()
    if (latestDelete.data.retryAt !== null
      && new Date(latestDelete.data.retryAt).getTime() > occurredAt.getTime()) {
      return invalidTransition()
    }
    return
  }
  if (!latestDelete
    || latestDelete.eventType !== "remote-delete.requested"
    || latestDelete.data.remotePostId !== action.data.remotePostId) {
    return invalidTransition()
  }
}

async function materializeEvent(
  action: SocialDeliveryEventActionV1Encoded,
  teamId: string,
  targetId: string,
  eventId: string,
  sequence: number,
  occurredAt: string,
) {
  const result = await Effect.runPromise(Effect.either(
    materializeSocialDeliveryEventV1(action, {
      schema: "screeem.social-delivery-event",
      schemaVersion: 1,
      id: eventId,
      teamId,
      targetId,
      provider: "instagram",
      sequence,
      actor: { kind: "system", source: "dispatcher" },
      occurredAt,
    }).pipe(Effect.flatMap(encodeSocialDeliveryEventV1)),
  ))
  if (Either.isLeft(result)) throw result.left
  return result.right
}

async function persistReceipt(
  transaction: DatabaseTransaction,
  request: ReturnType<typeof deliveryRequest>,
  action: SocialDeliveryEventActionV1Encoded,
  receipt: SealedSocialDeliveryReceipt | null,
  occurredAt: string,
) {
  if (!receipt) throw new SocialDeliveryEventRequestError({ reason: "invalid" })
  const attemptId = publishAttemptId(action)
  const revision = newReceiptRevision(action)
  if (!attemptId || revision === null) {
    throw new SocialDeliveryEventRequestError({ reason: "invalid" })
  }
  const current = await transaction<ReceiptRow[]>`
    SELECT attempt_id, revision, key_id, sealed_payload
    FROM social_delivery_receipts
    WHERE team_id = ${request.teamId}
      AND target_id = ${request.targetId}
      AND attempt_id = ${attemptId}
    ORDER BY revision DESC
    LIMIT 1
    FOR UPDATE
  `
  const previousRevision = current[0]
    ? positiveDatabaseInteger(current[0].revision)
    : 0
  if (previousRevision !== receipt.expectedPreviousRevision) {
    throw new SocialDeliveryEventStateError({ reason: "receipt_conflict" })
  }
  await transaction`
    INSERT INTO social_delivery_receipts (
      team_id, target_id, event_id, attempt_id, revision, key_id,
      sealed_payload, updated_at
    ) VALUES (
      ${request.teamId}, ${request.targetId}, ${request.eventId},
      ${attemptId}, ${revision}, ${receipt.keyId},
      ${receipt.sealedPayload}, ${occurredAt}
    )
  `
}

async function verifyReceiptReplay(
  transaction: DatabaseTransaction,
  request: ReturnType<typeof deliveryRequest>,
  action: SocialDeliveryEventActionV1Encoded,
  receipt: SealedSocialDeliveryReceipt | null,
) {
  if (!receipt) throw new SocialDeliveryEventRequestError({ reason: "invalid" })
  const attemptId = publishAttemptId(action)
  const revision = newReceiptRevision(action)
  if (!attemptId || revision === null) {
    throw new SocialDeliveryEventRequestError({ reason: "invalid" })
  }
  const rows = await transaction<ReceiptRow[]>`
    SELECT attempt_id, revision, key_id, sealed_payload
    FROM social_delivery_receipts
    WHERE team_id = ${request.teamId}
      AND target_id = ${request.targetId}
      AND attempt_id = ${attemptId}
      AND revision = ${revision}
  `
  const row = rows[0]
  if (!row
    || row.attempt_id !== attemptId
    || positiveDatabaseInteger(row.revision) !== revision
    || row.key_id !== receipt.keyId
    || row.sealed_payload !== receipt.sealedPayload) {
    throw new SocialDeliveryEventStateError({ reason: "receipt_conflict" })
  }
}

async function verifyResumeReceipt(
  transaction: DatabaseTransaction,
  request: ReturnType<typeof deliveryRequest>,
  action: Extract<SocialDeliveryEventActionV1Encoded, { eventType: "publish.resumed" }>,
) {
  const rows = await transaction<{ readonly revision: number | string }[]>`
    SELECT revision
    FROM social_delivery_receipts
    WHERE team_id = ${request.teamId}
      AND target_id = ${request.targetId}
      AND attempt_id = ${action.data.attemptId}
    ORDER BY revision DESC
    LIMIT 1
    FOR UPDATE
  `
  if (!rows[0]
    || positiveDatabaseInteger(rows[0].revision) !== action.data.receiptRevision) {
    throw new SocialDeliveryEventStateError({ reason: "receipt_conflict" })
  }
}

function isPublishEvent(event: SocialDeliveryEventV1Encoded): event is PublishEvent {
  return event.eventType === "publish.started"
    || event.eventType === "publish.progressed"
    || event.eventType === "publish.resumed"
    || event.eventType === "publish.succeeded"
    || event.eventType === "publish.failed"
    || event.eventType === "publish.uncertain"
}

function publishAttemptId(
  action: SocialDeliveryEventActionV1Encoded,
): string | null {
  return action.eventType === "publish.started"
    || action.eventType === "publish.progressed"
    || action.eventType === "publish.resumed"
    || action.eventType === "publish.succeeded"
    || action.eventType === "publish.failed"
    || action.eventType === "publish.uncertain"
    ? action.data.attemptId
    : null
}

function newReceiptRevision(action: SocialDeliveryEventActionV1Encoded): number | null {
  if (action.eventType === "publish.progressed"
    || action.eventType === "publish.succeeded") return action.data.receiptRevision
  if (action.eventType === "publish.failed" && action.data.receipt.kind === "recorded") {
    return action.data.receipt.revision
  }
  return null
}

function currentReceiptRevision(
  events: readonly SocialDeliveryEventV1Encoded[],
  attemptId: string,
) {
  for (const event of [...events].reverse()) {
    if (!isPublishEvent(event) || event.data.attemptId !== attemptId) continue
    if (event.eventType === "publish.failed") return event.data.receipt.revision ?? 0
    if (event.eventType === "publish.progressed"
      || event.eventType === "publish.resumed"
      || event.eventType === "publish.succeeded") {
      return event.data.receiptRevision
    }
  }
  return 0
}

function retryIsDue(retryAt: string | null, occurredAt: Date) {
  return retryAt === null || new Date(retryAt).getTime() <= occurredAt.getTime()
}

function isTerminalPublishAction(
  action: SocialDeliveryEventActionV1Encoded,
): action is Extract<SocialDeliveryEventActionV1Encoded, {
  eventType: "publish.succeeded" | "publish.failed" | "publish.uncertain"
}> {
  return action.eventType === "publish.succeeded"
    || action.eventType === "publish.failed"
    || action.eventType === "publish.uncertain"
}

async function supersedeAfterCalendarChange(
  transaction: DatabaseTransaction,
  request: ReturnType<typeof deliveryRequest>,
  target: TargetRow,
  occurredAt: string,
) {
  if (target.status !== "scheduled") return
  const workflows = await transaction<{ readonly revision: number | string }[]>`
    SELECT revision
    FROM calendar_post_workflows
    WHERE team_id = ${request.teamId}
      AND aggregate_id = ${target.calendar_post_id}
  `
  if (!workflows[0]
    || positiveDatabaseInteger(workflows[0].revision)
      <= positiveDatabaseInteger(target.calendar_revision)) return

  await transaction`
    UPDATE social_post_targets
    SET status = 'superseded', superseded_at = ${occurredAt},
        transition_event_id = ${crypto.randomUUID()}, transitioned_by = NULL
    WHERE team_id = ${request.teamId}
      AND id = ${request.targetId}
      AND status = 'scheduled'
  `
}

function eventAction(event: SocialDeliveryEventV1Encoded) {
  return { eventType: event.eventType, data: event.data }
}

function invalidTransition(): never {
  throw new SocialDeliveryEventStateError({ reason: "invalid_transition" })
}

function invalidTarget(): never {
  throw new SocialDeliveryEventStateError({ reason: "target_inactive" })
}

function canonicalJson(input: unknown): string {
  if (Array.isArray(input)) return `[${input.map(canonicalJson).join(",")}]`
  if (input !== null && typeof input === "object") {
    const record = input as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(record[key])}`
    ).join(",")}}`
  }
  return JSON.stringify(input)
}

function positiveDatabaseInteger(input: number | string): number {
  const value = typeof input === "number" ? input : Number(input)
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new SocialDeliveryEventPersistenceError({ operation: "load" })
  }
  return value
}

function deliveryFailure(error: unknown): SocialDeliveryEventFailure {
  if (error instanceof InvalidSocialDeliveryEventContractError
    || error instanceof UnsupportedSocialDeliveryEventVersionError
    || error instanceof SocialDeliveryEventRequestError
    || error instanceof SocialDeliveryEventStateError
    || error instanceof SocialDeliveryEventPersistenceError) return error
  return new SocialDeliveryEventPersistenceError({ operation: "append" })
}
