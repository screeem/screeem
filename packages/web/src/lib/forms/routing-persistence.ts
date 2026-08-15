import "server-only"

import {
  type FormAvailability,
  type SubmissionRoutingResult,
} from "@screeem/forms"
import {
  routingActionFailure,
  type ActionOutput,
  type RoutingActionFailure,
} from "@screeem/routing"
import type postgres from "postgres"
import { getDatabase } from "../db/database"
import type {
  FormEventDeliveryRecoveryStore,
} from "./form-event-deliveries"
import {
  snapshotFormEvent,
  type FormPublicationScope,
  type PendingFormEventDelivery,
  type StoredFormEventDelivery,
} from "./form-actions"
import {
  maximumSubmissionRouteOptions,
} from "./submission-contract"
import {
  maximumFormEventDeliveries,
  type FormEventDeliveryKind,
  type FormEventDeliveryStatus,
} from "./form-delivery-contract"

const maximumAttempts = 3
const leaseDurationMs = 30_000
const recentRouteWindow = 4_096

export type PublicSubmissionSaveStatus = "saved" | "unavailable" | "rate-limited"

export interface PublicSubmissionSaveInput {
  readonly submissionId: string
  readonly tenantId: string
  readonly formId: string
  readonly publicationVersion: number | null
  readonly payload: unknown
  readonly routing: SubmissionRoutingResult
  readonly deliveries: readonly StoredFormEventDelivery[]
  readonly origin: string | null
  readonly userAgent: string | null
}

export interface FormPersistence extends FormEventDeliveryRecoveryStore {
  saveSubmission(input: PublicSubmissionSaveInput): Promise<PublicSubmissionSaveStatus>
  listRecentRoutes(tenantId: string, formId: string): Promise<readonly string[]>
}

export function createFormPersistence(): FormPersistence {
  return new PostgresFormPersistence(getDatabase())
}

type Database = ReturnType<typeof getDatabase>

interface FormStateRow {
  readonly team_id: string
  readonly is_active: boolean
  readonly legacy_unstructured: boolean
  readonly definition_availability: FormAvailability
  readonly published_version: number | string | null
}

interface DeliveryRow {
  readonly team_id: string
  readonly form_id: string
  readonly submission_id: string
  readonly publication_version: number | string | null
  readonly event_id: string
  readonly event_type: string
  readonly event_occurred_at: Date
  readonly event_payload: unknown
  readonly delivery_kind: FormEventDeliveryKind
  readonly registration_name: string
  readonly delivery_key: string
  readonly sequence: number
  readonly stream_sequence: number
  readonly status: FormEventDeliveryStatus
  readonly attempt_count: number
  readonly next_attempt_at: Date
  readonly lease_expires_at: Date | null
}

export class PostgresFormPersistence implements FormPersistence {
  constructor(private readonly database: Database) {}

  async saveSubmission(input: PublicSubmissionSaveInput): Promise<PublicSubmissionSaveStatus> {
    assertPlannedDeliveries(input)
    return this.database.begin(async (transaction) => {
      const forms = await transaction<FormStateRow[]>`
        SELECT
          team_id,
          is_active,
          legacy_unstructured,
          definition_availability,
          published_version
        FROM forms
        WHERE team_id = ${input.tenantId}
          AND id = ${input.formId}
        FOR UPDATE
      `
      const form = forms[0]
      if (!form || !form.is_active || !publicationMatches(form, input.publicationVersion)) {
        return "unavailable"
      }
      const [{ now }] = await transaction<{ readonly now: Date }[]>`
        SELECT clock_timestamp() AS now
      `
      const [{ count }] = await transaction<{ readonly count: number | string }[]>`
        SELECT count(*) AS count
        FROM form_submissions
        WHERE team_id = ${form.team_id}
          AND form_id = ${input.formId}
          AND created_at > ${new Date(now.getTime() - 60_000)}
      `
      if (Number(count) >= 60) return "rate-limited"

      await transaction`
        INSERT INTO form_submissions (
          id,
          team_id,
          form_id,
          publication_version,
          payload,
          routing_status,
          routing_route,
          matched_rule_id,
          routing_error,
          origin,
          user_agent,
          created_at
        ) VALUES (
          ${input.submissionId},
          ${form.team_id},
          ${input.formId},
          ${input.publicationVersion},
          ${transaction.json(input.payload as never)},
          ${input.routing.status},
          ${input.routing.route},
          ${input.routing.matchedRule},
          ${input.routing.error},
          ${input.origin},
          ${input.userAgent},
          ${now}
        )
      `
      for (const delivery of input.deliveries) {
        await transaction`
          INSERT INTO form_event_deliveries (
            team_id,
            form_id,
            submission_id,
            publication_version,
            event_id,
            event_type,
            event_occurred_at,
            event_payload,
            delivery_kind,
            registration_name,
            delivery_key,
            sequence,
            stream_sequence,
            next_attempt_at,
            created_at,
            updated_at
          ) VALUES (
            ${form.team_id},
            ${input.formId},
            ${input.submissionId},
            ${input.publicationVersion},
            ${delivery.event.eventId},
            ${delivery.event.type},
            ${new Date(delivery.event.occurredAt)},
            ${transaction.json(delivery.event.payload as never)},
            ${delivery.kind},
            ${delivery.registrationName},
            ${delivery.deliveryKey},
            ${delivery.sequence},
            ${delivery.streamSequence},
            ${now},
            ${now},
            ${now}
          )
        `
      }
      return "saved"
    })
  }

  async claim(delivery: PendingFormEventDelivery | StoredFormEventDelivery) {
    return this.database.begin(async (transaction) => {
      const chain = await transaction<DeliveryRow[]>`
        SELECT
          team_id,
          form_id,
          submission_id,
          publication_version,
          event_id,
          event_type,
          event_occurred_at,
          event_payload,
          delivery_kind,
          registration_name,
          delivery_key,
          sequence,
          stream_sequence,
          status,
          attempt_count,
          next_attempt_at,
          lease_expires_at
        FROM form_event_deliveries
        WHERE team_id = ${delivery.tenantId}
          AND form_id = ${delivery.formId}
          AND submission_id = ${delivery.submissionId}
        ORDER BY stream_sequence
        FOR UPDATE
      `
      const current = chain.find(({ delivery_key }) => delivery_key === delivery.deliveryKey)
      if (!current || !deliveryMatches(current, delivery)) return null
      const [{ now }] = await transaction<{ readonly now: Date }[]>`
        SELECT clock_timestamp() AS now
      `

      if (isAbandonedFinalAttempt(current, now)) {
        await failChain(transaction, chain, current, now, "delivery_abandoned")
        return null
      }
      if (
        current.attempt_count >= maximumAttempts ||
        !isDue(current, now) ||
        (current.delivery_kind === "routing_action" &&
          chain.some(
            (earlier) =>
              earlier.event_id === current.event_id &&
              earlier.delivery_kind === "routing_action" &&
              earlier.sequence < current.sequence &&
              earlier.status !== "succeeded",
          ))
      ) {
        return null
      }

      const attempt = current.attempt_count + 1
      const claimed = await transaction<{ readonly delivery_key: string }[]>`
        UPDATE form_event_deliveries
        SET
          status = 'running',
          attempt_count = ${attempt},
          last_error = NULL,
          lease_expires_at = ${new Date(now.getTime() + leaseDurationMs)},
          started_at = ${now},
          completed_at = NULL,
          updated_at = ${now}
        WHERE team_id = ${delivery.tenantId}
          AND event_id = ${delivery.event.eventId}
          AND delivery_key = ${delivery.deliveryKey}
        RETURNING delivery_key
      `
      return claimed.length === 1 ? { attempt } : null
    })
  }

  async succeed(
    delivery: PendingFormEventDelivery | StoredFormEventDelivery,
    attempt: number,
    output: ActionOutput,
  ) {
    const completed = await this.database<{ readonly delivery_key: string }[]>`
      UPDATE form_event_deliveries
      SET
        status = 'succeeded',
        output = ${this.database.json((output ?? null) as never)},
        last_error = NULL,
        lease_expires_at = NULL,
        completed_at = clock_timestamp(),
        updated_at = clock_timestamp()
      WHERE team_id = ${delivery.tenantId}
        AND event_id = ${delivery.event.eventId}
        AND delivery_key = ${delivery.deliveryKey}
        AND status = 'running'
        AND attempt_count = ${attempt}
      RETURNING delivery_key
    `
    if (completed.length !== 1) throw new FormEventDeliveryClaimLostError()
  }

  async fail(
    delivery: PendingFormEventDelivery | StoredFormEventDelivery,
    attempt: number,
    failure: RoutingActionFailure,
  ) {
    const safeFailure = routingActionFailure(failure)
    await this.database.begin(async (transaction) => {
      const chain = await transaction<DeliveryRow[]>`
        SELECT
          team_id,
          form_id,
          submission_id,
          publication_version,
          event_id,
          event_type,
          event_occurred_at,
          event_payload,
          delivery_kind,
          registration_name,
          delivery_key,
          sequence,
          stream_sequence,
          status,
          attempt_count,
          next_attempt_at,
          lease_expires_at
        FROM form_event_deliveries
        WHERE team_id = ${delivery.tenantId}
          AND form_id = ${delivery.formId}
          AND submission_id = ${delivery.submissionId}
        ORDER BY stream_sequence
        FOR UPDATE
      `
      const current = chain.find(({ delivery_key }) => delivery_key === delivery.deliveryKey)
      if (
        !current ||
        current.status !== "running" ||
        current.attempt_count !== attempt ||
        !deliveryMatches(current, delivery)
      ) {
        throw new FormEventDeliveryClaimLostError()
      }
      const [{ now }] = await transaction<{ readonly now: Date }[]>`
        SELECT clock_timestamp() AS now
      `
      if (!safeFailure.retryable || attempt >= maximumAttempts) {
        await failChain(transaction, chain, current, now, safeFailure.code)
        return
      }
      const normalBackoffMs = attempt === 1 ? 60_000 : 300_000
      const delayMs = Math.max(normalBackoffMs, safeFailure.retryAfterMs ?? 0)
      await transaction`
        UPDATE form_event_deliveries
        SET
          status = 'pending',
          last_error = ${safeFailure.code},
          next_attempt_at = ${new Date(now.getTime() + delayMs)},
          lease_expires_at = NULL,
          completed_at = NULL,
          updated_at = ${now}
        WHERE team_id = ${delivery.tenantId}
          AND event_id = ${delivery.event.eventId}
          AND delivery_key = ${delivery.deliveryKey}
      `
    })
  }

  async listPending(limit: number): Promise<{
    readonly deliveries: readonly PendingFormEventDelivery[]
    readonly invalidCount: number
  }> {
    const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 100)
    await this.reconcileAbandoned(safeLimit)
    const rows = await this.database<PendingRow[]>`
      WITH eligible_streams AS (
        SELECT
          head.team_id,
          head.form_id,
          head.submission_id,
          min(head.created_at) AS created_at
        FROM form_event_deliveries AS head
        WHERE head.attempt_count < ${maximumAttempts}
          AND (
            (head.status = 'pending' AND head.next_attempt_at <= statement_timestamp())
            OR (head.status = 'running' AND head.lease_expires_at <= statement_timestamp())
          )
          AND (
            head.delivery_kind <> 'routing_action'
            OR NOT EXISTS (
              SELECT 1
              FROM form_event_deliveries AS earlier
              WHERE earlier.team_id = head.team_id
                AND earlier.event_id = head.event_id
                AND earlier.delivery_kind = 'routing_action'
                AND earlier.sequence < head.sequence
                AND earlier.status <> 'succeeded'
            )
          )
        GROUP BY head.team_id, head.form_id, head.submission_id
        ORDER BY min(head.created_at)
        LIMIT ${safeLimit}
      )
      SELECT
        execution.team_id,
        execution.form_id,
        execution.submission_id,
        execution.publication_version,
        execution.event_id,
        execution.event_type,
        execution.event_occurred_at,
        execution.event_payload,
        execution.delivery_kind,
        execution.registration_name,
        execution.delivery_key,
        execution.sequence,
        execution.stream_sequence
      FROM form_event_deliveries AS execution
      INNER JOIN eligible_streams AS stream
        ON stream.team_id = execution.team_id
        AND stream.form_id = execution.form_id
        AND stream.submission_id = execution.submission_id
      WHERE execution.attempt_count < ${maximumAttempts}
        AND (
          (execution.status = 'pending' AND execution.next_attempt_at <= statement_timestamp())
          OR (execution.status = 'running' AND execution.lease_expires_at <= statement_timestamp())
        )
      ORDER BY stream.created_at, execution.stream_sequence
      LIMIT ${safeLimit}
    `
    const pending: PendingFormEventDelivery[] = []
    let invalidCount = 0
    for (const row of rows) {
      try {
        pending.push(mapPendingRow(row))
      } catch {
        await this.quarantineInvalidDelivery(row)
        invalidCount += 1
      }
    }
    return { deliveries: pending, invalidCount }
  }

  async loadPublication(
    identifiers: FormPublicationScope,
  ) {
    const rows = await this.database<
      { readonly definition: unknown; readonly routing_definition: unknown }[]
    >`
      SELECT definition, routing_definition
      FROM form_definition_versions
      WHERE team_id = ${identifiers.tenantId}
        AND form_id = ${identifiers.formId}
        AND version = ${identifiers.publicationVersion}
      LIMIT 1
    `
    const publication = rows[0]
    if (!publication) throw new Error("Routing publication is unavailable")
    return { definition: publication.definition, routing: publication.routing_definition }
  }

  async listRecentRoutes(tenantId: string, formId: string): Promise<readonly string[]> {
    const rows = await this.database<{ readonly routing_route: string | null }[]>`
      SELECT routing_route
      FROM form_submissions
      WHERE team_id = ${tenantId}
        AND form_id = ${formId}
      ORDER BY created_at DESC
      LIMIT ${recentRouteWindow}
    `
    return [...new Set(rows.flatMap(({ routing_route }) => routing_route ?? []))]
      .sort()
      .slice(0, maximumSubmissionRouteOptions)
  }

  private async reconcileAbandoned(limit: number) {
    await this.database.begin(async (transaction) => {
      const rows = await transaction<DeliveryRow[]>`
        SELECT
          team_id,
          form_id,
          submission_id,
          publication_version,
          event_id,
          event_type,
          event_occurred_at,
          event_payload,
          delivery_kind,
          registration_name,
          delivery_key,
          sequence,
          stream_sequence,
          status,
          attempt_count,
          next_attempt_at,
          lease_expires_at
        FROM form_event_deliveries
        WHERE status = 'running'
          AND attempt_count >= ${maximumAttempts}
          AND lease_expires_at <= statement_timestamp()
        ORDER BY lease_expires_at
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      `
      if (rows.length === 0) return
      const [{ now }] = await transaction<{ readonly now: Date }[]>`
        SELECT clock_timestamp() AS now
      `
      for (const row of rows) {
        const chain = await transaction<DeliveryRow[]>`
          SELECT
            team_id,
            form_id,
            submission_id,
            publication_version,
            event_id,
            event_type,
            event_occurred_at,
            event_payload,
            delivery_kind,
            registration_name,
            delivery_key,
            sequence,
            stream_sequence,
            status,
            attempt_count,
            next_attempt_at,
            lease_expires_at
          FROM form_event_deliveries
          WHERE team_id = ${row.team_id}
            AND form_id = ${row.form_id}
            AND submission_id = ${row.submission_id}
          ORDER BY stream_sequence
          FOR UPDATE
        `
        const current = chain.find(({ delivery_key }) => delivery_key === row.delivery_key)
        if (current && isAbandonedFinalAttempt(current, now)) {
          await failChain(transaction, chain, current, now, "delivery_abandoned")
        }
      }
    })
  }

  private async quarantineInvalidDelivery(row: PendingRow) {
    await this.database.begin(async (transaction) => {
      const chain = await transaction<DeliveryRow[]>`
        SELECT
          team_id,
          form_id,
          submission_id,
          publication_version,
          event_id,
          event_type,
          event_occurred_at,
          event_payload,
          delivery_kind,
          registration_name,
          delivery_key,
          sequence,
          stream_sequence,
          status,
          attempt_count,
          next_attempt_at,
          lease_expires_at
        FROM form_event_deliveries
        WHERE team_id = ${row.team_id}
          AND form_id = ${row.form_id}
          AND submission_id = ${row.submission_id}
        ORDER BY stream_sequence
        FOR UPDATE
      `
      const current = chain.find(({ delivery_key }) => delivery_key === row.delivery_key)
      if (!current || current.status === "succeeded" || current.status === "failed") return
      const [{ now }] = await transaction<{ readonly now: Date }[]>`
        SELECT clock_timestamp() AS now
      `
      await failChain(transaction, chain, current, now, "invalid_event_contract")
    })
  }
}

interface PendingRow {
  readonly team_id: string
  readonly form_id: string
  readonly submission_id: string
  readonly publication_version: number | string | null
  readonly event_id: string
  readonly event_type: string
  readonly event_occurred_at: Date
  readonly event_payload: unknown
  readonly delivery_kind: FormEventDeliveryKind
  readonly registration_name: string
  readonly delivery_key: string
  readonly sequence: number
  readonly stream_sequence: number
}

export class FormEventDeliveryClaimLostError extends Error {
  constructor() {
    super("Form event delivery claim was lost")
    this.name = "FormEventDeliveryClaimLostError"
  }
}

function publicationMatches(form: FormStateRow, version: number | null) {
  if (version === null) {
    return form.legacy_unstructured && form.published_version === null
  }
  if (form.published_version === null) return false
  return (
    form.definition_availability === "active" &&
    numberValue(form.published_version) === version
  )
}

function assertPlannedDeliveries(input: PublicSubmissionSaveInput) {
  if (input.publicationVersion === null && input.routing.status !== "not_configured") {
    throw new Error("Invalid legacy routing result")
  }
  if (input.deliveries.length > maximumFormEventDeliveries) {
    throw new Error("Invalid form event deliveries")
  }
  const keys = new Set<string>()
  const nextSequence = new Map<string, number>()
  for (const [streamSequence, delivery] of input.deliveries.entries()) {
    const event = snapshotFormEvent(delivery.event)
    const expectedSequence = nextSequence.get(event.eventId) ?? 0
    if (
      delivery.tenantId !== input.tenantId ||
      delivery.formId !== input.formId ||
      delivery.submissionId !== input.submissionId ||
      delivery.publicationVersion !== input.publicationVersion ||
      event.tenantId !== input.tenantId ||
      event.formId !== input.formId ||
      !eventMatchesSubmission(event, input) ||
      (delivery.kind === "routing_action" && event.type !== "routing.matched") ||
      delivery.registrationName === "" ||
      delivery.registrationName.length > 128 ||
      delivery.deliveryKey !== `${event.eventId}:${expectedSequence}` ||
      delivery.sequence !== expectedSequence ||
      delivery.streamSequence !== streamSequence ||
      keys.has(delivery.deliveryKey) ||
      delivery.sequence > 99
    ) {
      throw new Error("Invalid form event deliveries")
    }
    keys.add(delivery.deliveryKey)
    nextSequence.set(event.eventId, expectedSequence + 1)
  }
}

function eventMatchesSubmission(
  event: import("./form-actions").FormEvent,
  input: PublicSubmissionSaveInput,
) {
  if (
    event.type === "submission.before_save" ||
    event.type === "submission.accepted"
  ) {
    return (
      event.payload.submissionId === input.submissionId &&
      event.payload.publicationVersion === input.publicationVersion &&
      event.payload.routing.status === input.routing.status &&
      event.payload.routing.route === input.routing.route &&
      event.payload.routing.matchedRule === input.routing.matchedRule &&
      event.payload.routing.error === input.routing.error &&
      jsonEqual(event.payload.submission, input.payload)
    )
  }
  if (event.type === "routing.matched") {
    return (
      input.publicationVersion !== null &&
      event.payload.submissionId === input.submissionId &&
      event.payload.publicationVersion === input.publicationVersion &&
      event.payload.ruleId === input.routing.matchedRule &&
      event.payload.route === input.routing.route &&
      jsonEqual(event.payload.submission, input.payload)
    )
  }
  if (event.type === "routing.evaluation.after") {
    return (
      event.payload.publicationVersion === input.publicationVersion &&
      event.payload.submissionId === input.submissionId &&
      event.payload.outcome === input.routing.status &&
      event.payload.route === input.routing.route &&
      event.payload.matchedRule === input.routing.matchedRule
    )
  }
  return (
    event.payload.publicationVersion === input.publicationVersion &&
    event.payload.submissionId === input.submissionId
  )
}

function jsonEqual(left: unknown, right: unknown): boolean {
  const pending: [unknown, unknown][] = [[left, right]]
  while (pending.length > 0) {
    const [a, b] = pending.pop()!
    if (Object.is(a, b)) continue
    if (typeof a !== "object" || a === null || typeof b !== "object" || b === null) {
      return false
    }
    if (Array.isArray(a) || Array.isArray(b)) {
      if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
      for (let index = 0; index < a.length; index += 1) pending.push([a[index], b[index]])
      continue
    }
    const aKeys = Object.keys(a).sort()
    const bKeys = Object.keys(b).sort()
    if (aKeys.length !== bKeys.length || aKeys.some((key, index) => key !== bKeys[index])) {
      return false
    }
    for (const key of aKeys) {
      pending.push([
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key],
      ])
    }
  }
  return true
}

function deliveryMatches(
  row: DeliveryRow,
  delivery: PendingFormEventDelivery | StoredFormEventDelivery,
) {
  return (
    row.team_id === delivery.tenantId &&
    row.form_id === delivery.formId &&
    row.submission_id === delivery.submissionId &&
    nullableNumberValue(row.publication_version) === delivery.publicationVersion &&
    row.event_id === delivery.event.eventId &&
    row.event_occurred_at.toISOString() === delivery.event.occurredAt &&
    delivery.event.tenantId === delivery.tenantId &&
    delivery.event.formId === delivery.formId &&
    jsonEqual(row.event_payload, delivery.event.payload) &&
    row.registration_name === delivery.registrationName &&
    row.delivery_kind === delivery.kind &&
    row.sequence === delivery.sequence &&
    row.stream_sequence === delivery.streamSequence &&
    row.event_type === delivery.event.type
  )
}

function isDue(row: DeliveryRow, now: Date) {
  return (
    (row.status === "pending" && row.next_attempt_at <= now) ||
    (row.status === "running" && row.lease_expires_at !== null && row.lease_expires_at <= now)
  )
}

function isAbandonedFinalAttempt(row: DeliveryRow, now: Date) {
  return (
    row.status === "running" &&
    row.attempt_count >= maximumAttempts &&
    row.lease_expires_at !== null &&
    row.lease_expires_at <= now
  )
}

async function failChain(
  transaction: postgres.TransactionSql,
  chain: readonly DeliveryRow[],
  failed: DeliveryRow,
  now: Date,
  errorCode: string,
) {
  await transaction`
    UPDATE form_event_deliveries
    SET
      status = 'failed',
      last_error = ${errorCode},
      lease_expires_at = NULL,
      completed_at = ${now},
      updated_at = ${now}
    WHERE team_id = ${failed.team_id}
      AND event_id = ${failed.event_id}
      AND delivery_key = ${failed.delivery_key}
  `
  const laterKeys = chain
    .filter(
      ({ event_id, delivery_kind, sequence, status }) =>
        failed.delivery_kind === "routing_action" &&
        event_id === failed.event_id &&
        delivery_kind === "routing_action" &&
        sequence > failed.sequence &&
        status === "pending",
    )
    .map(({ delivery_key }) => delivery_key)
  for (const key of laterKeys) {
    await transaction`
      UPDATE form_event_deliveries
      SET
        status = 'failed',
        last_error = 'earlier_delivery_failed',
        completed_at = ${now},
        updated_at = ${now}
      WHERE team_id = ${failed.team_id}
        AND event_id = ${failed.event_id}
        AND delivery_key = ${key}
        AND status = 'pending'
    `
  }
}

function mapPendingRow(row: PendingRow): PendingFormEventDelivery {
  const event = snapshotFormEvent({
    eventId: row.event_id,
    type: row.event_type,
    occurredAt: row.event_occurred_at.toISOString(),
    tenantId: row.team_id,
    formId: row.form_id,
    payload: row.event_payload,
  })
  const publicationVersion = nullableNumberValue(row.publication_version)
  if (
    row.submission_id !== event.payload.submissionId ||
    publicationVersion !== event.payload.publicationVersion
  ) {
    throw new Error("Invalid pending form event delivery")
  }
  return {
    tenantId: row.team_id,
    formId: row.form_id,
    submissionId: row.submission_id,
    publicationVersion,
    event,
    kind: row.delivery_kind,
    registrationName: row.registration_name,
    deliveryKey: row.delivery_key,
    sequence: row.sequence,
    streamSequence: row.stream_sequence,
  }
}

function nullableNumberValue(value: number | string | null) {
  return value === null ? null : numberValue(value)
}

function numberValue(value: number | string | null) {
  const number = typeof value === "number" ? value : Number(value)
  if (!Number.isSafeInteger(number) || number < 1) throw new Error("Invalid database number")
  return number
}
