import "server-only"

import {
  snapshotSubmissionRoutingResult,
  type FormAvailability,
  type SubmissionRoutingResult,
} from "@screeem/forms"
import type { ActionOutput } from "@screeem/routing"
import type postgres from "postgres"
import { getDatabase } from "../db/database"
import type {
  FormRoutingActionRecoveryStore,
  PendingRoutingActionExecution,
  PlannedFormRoutingAction,
} from "./routing-actions"
import type { FormRoutingIdentifiers } from "./routing-registry"
import {
  maximumSubmissionRouteOptions,
  type FormRoutingActionExecutionStatus,
} from "./submission-contract"

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
  readonly actions: readonly PlannedFormRoutingAction[]
  readonly origin: string | null
  readonly userAgent: string | null
}

export interface FormRoutingPersistence extends FormRoutingActionRecoveryStore {
  saveSubmission(input: PublicSubmissionSaveInput): Promise<PublicSubmissionSaveStatus>
  listRecentRoutes(tenantId: string, formId: string): Promise<readonly string[]>
}

export function createFormRoutingPersistence(): FormRoutingPersistence {
  return new PostgresFormRoutingPersistence(getDatabase())
}

type Database = ReturnType<typeof getDatabase>

interface FormStateRow {
  readonly team_id: string
  readonly is_active: boolean
  readonly legacy_unstructured: boolean
  readonly definition_availability: FormAvailability
  readonly published_version: number | string | null
}

interface ActionRow {
  readonly team_id: string
  readonly form_id: string
  readonly submission_id: string
  readonly publication_version: number | string
  readonly action_key: string
  readonly action_name: string
  readonly action_index: number
  readonly rule_id: string
  readonly status: FormRoutingActionExecutionStatus
  readonly attempt_count: number
  readonly next_attempt_at: Date
  readonly lease_expires_at: Date | null
}

export class PostgresFormRoutingPersistence implements FormRoutingPersistence {
  constructor(private readonly database: Database) {}

  async saveSubmission(input: PublicSubmissionSaveInput): Promise<PublicSubmissionSaveStatus> {
    assertPlannedActions(input)
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
      for (const action of input.actions) {
        await transaction`
          INSERT INTO form_submission_action_executions (
            team_id,
            form_id,
            submission_id,
            publication_version,
            action_key,
            action_name,
            action_index,
            rule_id,
            next_attempt_at,
            created_at,
            updated_at
          ) VALUES (
            ${form.team_id},
            ${input.formId},
            ${input.submissionId},
            ${input.publicationVersion},
            ${action.key},
            ${action.name},
            ${action.index},
            ${action.ruleId},
            ${now},
            ${now},
            ${now}
          )
        `
      }
      return "saved"
    })
  }

  async claim(identifiers: FormRoutingIdentifiers, action: PlannedFormRoutingAction) {
    return this.database.begin(async (transaction) => {
      const chain = await transaction<ActionRow[]>`
        SELECT
          team_id,
          form_id,
          submission_id,
          publication_version,
          action_key,
          action_name,
          action_index,
          rule_id,
          status,
          attempt_count,
          next_attempt_at,
          lease_expires_at
        FROM form_submission_action_executions
        WHERE team_id = ${identifiers.tenantId}
          AND form_id = ${identifiers.formId}
          AND submission_id = ${identifiers.submissionId}
          AND publication_version = ${identifiers.publicationVersion}
        ORDER BY action_index
        FOR UPDATE
      `
      const current = chain.find(({ action_key }) => action_key === action.key)
      if (!current || !actionMatches(current, action)) return null
      const [{ now }] = await transaction<{ readonly now: Date }[]>`
        SELECT clock_timestamp() AS now
      `

      if (isAbandonedFinalAttempt(current, now)) {
        await failChain(transaction, chain, current, now, "action_execution_abandoned")
        return null
      }
      if (
        current.attempt_count >= maximumAttempts ||
        !isDue(current, now) ||
        chain.some(
          (earlier) =>
            earlier.action_index < current.action_index && earlier.status !== "succeeded",
        )
      ) {
        return null
      }

      const attempt = current.attempt_count + 1
      const claimed = await transaction<{ readonly action_key: string }[]>`
        UPDATE form_submission_action_executions
        SET
          status = 'running',
          attempt_count = ${attempt},
          last_error = NULL,
          lease_expires_at = ${new Date(now.getTime() + leaseDurationMs)},
          started_at = ${now},
          completed_at = NULL,
          updated_at = ${now}
        WHERE team_id = ${identifiers.tenantId}
          AND form_id = ${identifiers.formId}
          AND submission_id = ${identifiers.submissionId}
          AND publication_version = ${identifiers.publicationVersion}
          AND action_key = ${action.key}
        RETURNING action_key
      `
      return claimed.length === 1 ? { attempt } : null
    })
  }

  async succeed(
    identifiers: FormRoutingIdentifiers,
    action: PlannedFormRoutingAction,
    attempt: number,
    output: ActionOutput,
  ) {
    const completed = await this.database<{ readonly action_key: string }[]>`
      UPDATE form_submission_action_executions
      SET
        status = 'succeeded',
        output = ${this.database.json((output ?? null) as never)},
        last_error = NULL,
        lease_expires_at = NULL,
        completed_at = clock_timestamp(),
        updated_at = clock_timestamp()
      WHERE team_id = ${identifiers.tenantId}
        AND form_id = ${identifiers.formId}
        AND submission_id = ${identifiers.submissionId}
        AND publication_version = ${identifiers.publicationVersion}
        AND action_key = ${action.key}
        AND status = 'running'
        AND attempt_count = ${attempt}
      RETURNING action_key
    `
    if (completed.length !== 1) throw new ActionExecutionClaimLostError()
  }

  async fail(
    identifiers: FormRoutingIdentifiers,
    action: PlannedFormRoutingAction,
    attempt: number,
    errorCode: string,
  ) {
    if (errorCode === "" || errorCode.length > 128) throw new Error("Invalid action error")
    await this.database.begin(async (transaction) => {
      const chain = await transaction<ActionRow[]>`
        SELECT
          team_id,
          form_id,
          submission_id,
          publication_version,
          action_key,
          action_name,
          action_index,
          rule_id,
          status,
          attempt_count,
          next_attempt_at,
          lease_expires_at
        FROM form_submission_action_executions
        WHERE team_id = ${identifiers.tenantId}
          AND form_id = ${identifiers.formId}
          AND submission_id = ${identifiers.submissionId}
          AND publication_version = ${identifiers.publicationVersion}
        ORDER BY action_index
        FOR UPDATE
      `
      const current = chain.find(({ action_key }) => action_key === action.key)
      if (
        !current ||
        current.status !== "running" ||
        current.attempt_count !== attempt ||
        !actionMatches(current, action)
      ) {
        throw new ActionExecutionClaimLostError()
      }
      const [{ now }] = await transaction<{ readonly now: Date }[]>`
        SELECT clock_timestamp() AS now
      `
      if (attempt >= maximumAttempts) {
        await failChain(transaction, chain, current, now, errorCode)
        return
      }
      const delayMs = attempt === 1 ? 60_000 : 300_000
      await transaction`
        UPDATE form_submission_action_executions
        SET
          status = 'pending',
          last_error = ${errorCode},
          next_attempt_at = ${new Date(now.getTime() + delayMs)},
          lease_expires_at = NULL,
          completed_at = NULL,
          updated_at = ${now}
        WHERE team_id = ${identifiers.tenantId}
          AND form_id = ${identifiers.formId}
          AND submission_id = ${identifiers.submissionId}
          AND publication_version = ${identifiers.publicationVersion}
          AND action_key = ${action.key}
      `
    })
  }

  async listPending(limit: number): Promise<readonly PendingRoutingActionExecution[]> {
    const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 100)
    await this.reconcileAbandoned(safeLimit)
    const rows = await this.database<PendingRow[]>`
      SELECT
        execution.team_id,
        execution.form_id,
        execution.submission_id,
        execution.publication_version,
        execution.action_key,
        execution.action_name,
        execution.action_index,
        execution.rule_id,
        submission.payload AS submission_values,
        submission.routing_status,
        submission.routing_route,
        submission.matched_rule_id,
        submission.routing_error
      FROM form_submission_action_executions AS execution
      JOIN form_submissions AS submission
        ON submission.team_id = execution.team_id
       AND submission.form_id = execution.form_id
       AND submission.id = execution.submission_id
      WHERE execution.attempt_count < ${maximumAttempts}
        AND (
          (execution.status = 'pending' AND execution.next_attempt_at <= statement_timestamp())
          OR (execution.status = 'running' AND execution.lease_expires_at <= statement_timestamp())
        )
        AND NOT EXISTS (
          SELECT 1
          FROM form_submission_action_executions AS earlier
          WHERE earlier.team_id = execution.team_id
            AND earlier.form_id = execution.form_id
            AND earlier.submission_id = execution.submission_id
            AND earlier.publication_version = execution.publication_version
            AND earlier.action_index < execution.action_index
            AND earlier.status <> 'succeeded'
        )
      ORDER BY execution.created_at, execution.action_index
      LIMIT ${safeLimit}
    `
    return rows.map(mapPendingRow)
  }

  async loadPublication(
    identifiers: Pick<FormRoutingIdentifiers, "tenantId" | "formId" | "publicationVersion">,
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
      const rows = await transaction<ActionRow[]>`
        SELECT
          team_id,
          form_id,
          submission_id,
          publication_version,
          action_key,
          action_name,
          action_index,
          rule_id,
          status,
          attempt_count,
          next_attempt_at,
          lease_expires_at
        FROM form_submission_action_executions
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
        const chain = await transaction<ActionRow[]>`
          SELECT
            team_id,
            form_id,
            submission_id,
            publication_version,
            action_key,
            action_name,
            action_index,
            rule_id,
            status,
            attempt_count,
            next_attempt_at,
            lease_expires_at
          FROM form_submission_action_executions
          WHERE team_id = ${row.team_id}
            AND form_id = ${row.form_id}
            AND submission_id = ${row.submission_id}
            AND publication_version = ${numberValue(row.publication_version)}
          ORDER BY action_index
          FOR UPDATE
        `
        const current = chain.find(({ action_key }) => action_key === row.action_key)
        if (current && isAbandonedFinalAttempt(current, now)) {
          await failChain(transaction, chain, current, now, "action_execution_abandoned")
        }
      }
    })
  }
}

interface PendingRow {
  readonly team_id: string
  readonly form_id: string
  readonly submission_id: string
  readonly publication_version: number | string
  readonly action_key: string
  readonly action_name: string
  readonly action_index: number
  readonly rule_id: string
  readonly submission_values: unknown
  readonly routing_status: unknown
  readonly routing_route: unknown
  readonly matched_rule_id: unknown
  readonly routing_error: unknown
}

export class ActionExecutionClaimLostError extends Error {
  constructor() {
    super("Action execution claim was lost")
    this.name = "ActionExecutionClaimLostError"
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

function assertPlannedActions(input: PublicSubmissionSaveInput) {
  if (input.publicationVersion === null && input.routing.status !== "not_configured") {
    throw new Error("Invalid legacy routing result")
  }
  if (input.actions.length > 10) throw new Error("Invalid submission actions")
  if (input.actions.length > 0 && input.routing.status !== "matched") {
    throw new Error("Invalid submission actions")
  }
  const keys = new Set<string>()
  for (const [expectedIndex, action] of input.actions.entries()) {
    if (
      action.key === "" ||
      action.key.length > 160 ||
      action.name === "" ||
      action.name.length > 128 ||
      action.ruleId === "" ||
      action.ruleId.length > 128 ||
      action.ruleId !== input.routing.matchedRule ||
      !Number.isSafeInteger(action.index) ||
      action.index !== expectedIndex ||
      action.key !== `${action.ruleId}:${action.index}` ||
      keys.has(action.key) ||
      input.publicationVersion === null
    ) {
      throw new Error("Invalid submission actions")
    }
    keys.add(action.key)
  }
}

function actionMatches(row: ActionRow, action: PlannedFormRoutingAction) {
  return (
    row.action_name === action.name &&
    row.action_index === action.index &&
    row.rule_id === action.ruleId
  )
}

function isDue(row: ActionRow, now: Date) {
  return (
    (row.status === "pending" && row.next_attempt_at <= now) ||
    (row.status === "running" && row.lease_expires_at !== null && row.lease_expires_at <= now)
  )
}

function isAbandonedFinalAttempt(row: ActionRow, now: Date) {
  return (
    row.status === "running" &&
    row.attempt_count >= maximumAttempts &&
    row.lease_expires_at !== null &&
    row.lease_expires_at <= now
  )
}

async function failChain(
  transaction: postgres.TransactionSql,
  chain: readonly ActionRow[],
  failed: ActionRow,
  now: Date,
  errorCode: string,
) {
  await transaction`
    UPDATE form_submission_action_executions
    SET
      status = 'failed',
      last_error = ${errorCode},
      lease_expires_at = NULL,
      completed_at = ${now},
      updated_at = ${now}
    WHERE team_id = ${failed.team_id}
      AND form_id = ${failed.form_id}
      AND submission_id = ${failed.submission_id}
      AND publication_version = ${numberValue(failed.publication_version)}
      AND action_key = ${failed.action_key}
  `
  const laterKeys = chain
    .filter(({ action_index, status }) => action_index > failed.action_index && status === "pending")
    .map(({ action_key }) => action_key)
  for (const key of laterKeys) {
    await transaction`
      UPDATE form_submission_action_executions
      SET
        status = 'failed',
        last_error = 'earlier_action_failed',
        completed_at = ${now},
        updated_at = ${now}
      WHERE team_id = ${failed.team_id}
        AND form_id = ${failed.form_id}
        AND submission_id = ${failed.submission_id}
        AND publication_version = ${numberValue(failed.publication_version)}
        AND action_key = ${key}
        AND status = 'pending'
    `
  }
}

function mapPendingRow(row: PendingRow): PendingRoutingActionExecution {
  const submission = recordValues(row.submission_values)
  return {
    tenantId: row.team_id,
    formId: row.form_id,
    submissionId: row.submission_id,
    publicationVersion: numberValue(row.publication_version),
    action: {
      key: row.action_key,
      name: row.action_name,
      index: row.action_index,
      ruleId: row.rule_id,
    },
    submission,
    routing: snapshotSubmissionRoutingResult({
      status: row.routing_status,
      route: row.routing_route,
      matchedRule: row.matched_rule_id,
      error: row.routing_error,
    }),
  }
}

function recordValues(value: unknown): Readonly<Record<string, string | number | boolean>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid pending submission")
  }
  for (const field of Object.values(value)) {
    if (typeof field !== "string" && typeof field !== "number" && typeof field !== "boolean") {
      throw new Error("Invalid pending submission")
    }
  }
  return value as Readonly<Record<string, string | number | boolean>>
}

function numberValue(value: number | string | null) {
  const number = typeof value === "number" ? value : Number(value)
  if (!Number.isSafeInteger(number) || number < 1) throw new Error("Invalid database number")
  return number
}
