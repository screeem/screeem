import "server-only"

import { randomUUID } from "node:crypto"

import { snapshotIntegrationIdentifier } from "../contract"
import { getDatabase } from "../../db/database"

/**
 * Provider-generic social dispatch queue core.
 *
 * The drain loop, retry/backoff, conflict healing, deadlines, and stats are
 * identical for every provider. Each provider supplies a binding (see
 * instagram-dispatcher.ts): a pgmq queue name, a target gate, an event writer,
 * a publisher, and a target validator for provider-specific terminal rules.
 *
 * Adding a provider means: a pgmq queue + the generic SQL wrappers pointed at
 * it (see 0027), a binding module, and a widening of the provider CHECK
 * constraints on social_post_targets / social_delivery_events (today
 * instagram-only). The core below does not change.
 */

export interface DispatchMessage {
  readonly teamId: string
  readonly targetId: string
  readonly calendarPostId: string | null
  readonly publishAt: string | null
}

export interface QueuedDispatchMessage {
  readonly msgId: number
  readonly readCt: number
  readonly message: unknown
}

export interface DispatchTargetState {
  readonly status: string
  readonly publishAt: string
  /** Provider-specific contract version (Instagram: template_version). */
  readonly contractVersion: number
  readonly connectionOk: boolean
}

export type DispatchPublishOutcome =
  | "succeeded"
  | "stale"
  | "retryable"
  | "terminal"

export interface DispatchQueueStore {
  read(limit: number, visibilityTimeoutSeconds: number): Promise<readonly QueuedDispatchMessage[]>
  /** Returns false when the message is already gone (handled elsewhere). */
  archive(msgId: number): Promise<boolean>
  /** Returns false when the message is already gone (handled elsewhere). */
  reschedule(msgId: number, delaySeconds: number): Promise<boolean>
}

export interface DispatchTargetGate {
  loadTarget(teamId: string, targetId: string): Promise<DispatchTargetState | null>
}

export interface DueTargetPublisher {
  /**
   * Publishes one due target. Contract: return "succeeded" ONLY after appending
   * the success-chain delivery events (progressed/succeeded with sealed
   * receipts) for this attempt. The drain loop archives the queue message but
   * writes no success event itself, and enqueue's terminal exclusion depends on
   * those events existing — a bare "succeeded" would re-enqueue and
   * double-publish.
   */
  publish(
    message: DispatchMessage,
    target: DispatchTargetState,
  ): Promise<DispatchPublishOutcome>
}

export type DispatchTargetValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly errorCode: string }

export type DispatchTargetValidator = (
  message: DispatchMessage,
  target: DispatchTargetState,
) => DispatchTargetValidation

const allowAnyDispatchTarget: DispatchTargetValidator = () => ({ ok: true })

export type DispatchEventResult = "recorded" | "conflict" | "target-missing"

export interface DispatchEventWriter {
  recordAttemptStarted(input: {
    readonly teamId: string
    readonly targetId: string
    readonly attemptId: string
    readonly eventId: string
  }): Promise<DispatchEventResult>
  recordAttemptFailedRetryable(input: {
    readonly teamId: string
    readonly targetId: string
    readonly attemptId: string
    readonly eventId: string
    readonly errorCode: string
    readonly retryAt: string
  }): Promise<DispatchEventResult>
  recordAttemptFailedTerminal(input: {
    readonly teamId: string
    readonly targetId: string
    readonly attemptId: string
    readonly eventId: string
    readonly errorCode: string
  }): Promise<DispatchEventResult>
  loadLatestPublishAttempt(input: {
    readonly teamId: string
    readonly targetId: string
  }): Promise<{ readonly attemptId: string; readonly terminal: boolean } | null>
}

export interface DrainDispatchQueueOptions {
  readonly batchSize?: number
  readonly visibilityTimeoutSeconds?: number
  readonly maximumAttempts?: number
  readonly retryBaseDelaySeconds?: number
  readonly retryMaximumDelaySeconds?: number
  readonly deadlineTimestampMs?: number
  readonly validateTarget?: DispatchTargetValidator
  readonly now?: () => Date
}

export interface DispatchDrainStats {
  readonly read: number
  readonly published: number
  readonly staleArchived: number
  readonly invalidArchived: number
  readonly notDueRescheduled: number
  readonly retried: number
  readonly terminalArchived: number
  readonly duplicateSkipped: number
  readonly deferred: number
  readonly alreadySettled: number
  readonly processingErrors: number
}

const defaultBatchSize = 25
const defaultVisibilityTimeoutSeconds = 60
const defaultMaximumAttempts = 5
const defaultRetryBaseDelaySeconds = 60
const defaultRetryMaximumDelaySeconds = 3_600
const maximumDispatchDelaySeconds = 86_400

const queueNamePattern = /^[a-z][a-z0-9_]{0,46}$/
const providerNamePattern = /^[a-z][a-z0-9_-]{0,63}$/

export function validatedQueueName(input: unknown): string {
  if (typeof input !== "string" || !queueNamePattern.test(input)) {
    throw new TypeError("Invalid dispatch queue name")
  }
  return input
}

export function validatedProviderName(input: unknown): string {
  if (typeof input !== "string" || !providerNamePattern.test(input)) {
    throw new TypeError("Invalid dispatch provider name")
  }
  return input
}

export async function drainDispatchQueue(
  queue: DispatchQueueStore,
  gate: DispatchTargetGate,
  publisher: DueTargetPublisher,
  events: DispatchEventWriter,
  inputOptions: DrainDispatchQueueOptions = {},
): Promise<DispatchDrainStats> {
  const options = drainOptions(inputOptions)
  const stats: Record<keyof DispatchDrainStats, number> = {
    read: 0,
    published: 0,
    staleArchived: 0,
    invalidArchived: 0,
    notDueRescheduled: 0,
    retried: 0,
    terminalArchived: 0,
    duplicateSkipped: 0,
    deferred: 0,
    alreadySettled: 0,
    processingErrors: 0,
  }

  const messages = await queue.read(options.batchSize, options.visibilityTimeoutSeconds)
  stats.read = messages.length

  for (const queued of messages) {
    try {
      if (options.now().getTime() >= options.deadlineTimestampMs) {
        if (await queue.reschedule(queued.msgId, options.retryBaseDelaySeconds)) {
          stats.deferred += 1
        } else {
          stats.alreadySettled += 1
        }
        continue
      }
      await drainOneMessage(queue, gate, publisher, events, options, stats, queued)
    } catch {
      stats.processingErrors += 1
      try {
        await queue.reschedule(queued.msgId, options.retryBaseDelaySeconds)
      } catch {
        // Lease expiry will redeliver; nothing else safe to do here.
      }
    }
  }

  return Object.freeze({ ...stats })
}

async function drainOneMessage(
  queue: DispatchQueueStore,
  gate: DispatchTargetGate,
  publisher: DueTargetPublisher,
  events: DispatchEventWriter,
  options: ResolvedDrainOptions,
  stats: Record<keyof DispatchDrainStats, number>,
  queued: QueuedDispatchMessage,
): Promise<void> {
  const message = decodeDispatchMessage(queued.message)
  if (!message) {
    if (await queue.archive(queued.msgId)) stats.invalidArchived += 1
    else stats.alreadySettled += 1
    return
  }
  const target = await gate.loadTarget(message.teamId, message.targetId)
  if (!target || target.status !== "scheduled") {
    // Cancelled, superseded, or deleted after enqueue: never publish.
    if (await queue.archive(queued.msgId)) stats.staleArchived += 1
    else stats.alreadySettled += 1
    return
  }
  const validation = options.validateTarget(message, target)
  if (!validation.ok) {
    // Provider-specific terminal rule. Only sticks if recorded: a
    // publish.failed with no preceding publish.started is rejected as
    // invalid_transition, so open the attempt first exactly like the normal
    // terminal path.
    const attemptId = randomUUID()
    const opened = await events.recordAttemptStarted({
      teamId: message.teamId,
      targetId: message.targetId,
      attemptId,
      eventId: randomUUID(),
    })
    if (opened === "target-missing") {
      if (await queue.archive(queued.msgId)) stats.staleArchived += 1
      else stats.alreadySettled += 1
      return
    }
    if (opened === "conflict") {
      if (await queue.archive(queued.msgId)) stats.duplicateSkipped += 1
      else stats.alreadySettled += 1
      return
    }
    const validationSettled = await recordTerminal(
      queue,
      events,
      options,
      stats,
      queued.msgId,
      message,
      attemptId,
      validation.errorCode,
    )
    if (!validationSettled) await archiveDuplicate(queue, stats, queued.msgId)
    return
  }
  if (!target.connectionOk) {
    // Transient: the connection may recover. Requeue with backoff, no event.
    if (await queue.reschedule(queued.msgId, retryDelaySeconds(queued.readCt, options))) {
      stats.retried += 1
    } else {
      stats.alreadySettled += 1
    }
    return
  }
  const publishAt = Date.parse(target.publishAt)
  const now = options.now().getTime()
  if (Number.isFinite(publishAt) && publishAt > now) {
    if (
      await queue.reschedule(
        queued.msgId,
        Math.min(
          options.retryMaximumDelaySeconds,
          Math.max(60, Math.ceil((publishAt - now) / 1_000)),
        ),
      )
    ) {
      stats.notDueRescheduled += 1
    } else {
      stats.alreadySettled += 1
    }
    return
  }

  // pgmq increments read_ct on every read starting from 1, so the first
  // delivery of a message has readCt === 1 and that is attempt 1.
  // INVARIANT: no return-after-started without a same-attempt follow-up event.
  // Every path past recordAttemptStarted must append a failed/succeeded-class
  // event for that attemptId (or heal via loadLatestPublishAttempt) — otherwise
  // the orphaned started poisons all future attempts (started conflicts) and
  // retries silently die.
  const attempt = queued.readCt
  const attemptId = randomUUID()
  const started = await events.recordAttemptStarted({
    teamId: message.teamId,
    targetId: message.targetId,
    attemptId,
    eventId: randomUUID(),
  })
  if (started === "target-missing") {
    // Target deleted between gate-load and event-write: stale, never publish.
    if (await queue.archive(queued.msgId)) stats.staleArchived += 1
    else stats.alreadySettled += 1
    return
  }
  if (started === "conflict") {
    await healConflictingAttempt(queue, events, options, stats, queued, message)
    return
  }

  const outcome = await settleOutcome(() => publisher.publish(message, target))
  if (outcome === "succeeded") {
    // TODO(N3): enforce the publisher contract — verify a succeeded event for
    // this attempt exists before archiving, instead of trusting the return
    // value. Success-chain events (progressed/succeeded with sealed receipts)
    // belong to the real provider.publish drive, which lands with it (see the
    // publisher contract above).
    if (await queue.archive(queued.msgId)) stats.published += 1
    else stats.alreadySettled += 1
    return
  }
  if (outcome === "stale") {
    const staleSettled = await recordTerminal(
      queue,
      events,
      options,
      stats,
      queued.msgId,
      message,
      attemptId,
      "dispatcher_delivery_stale",
    )
    if (!staleSettled) await archiveDuplicate(queue, stats, queued.msgId)
    return
  }
  const backoffSeconds = retryDelaySeconds(attempt, options)
  if (outcome === "terminal" || attempt >= options.maximumAttempts) {
    const terminalSettled = await recordTerminal(
      queue,
      events,
      options,
      stats,
      queued.msgId,
      message,
      attemptId,
      outcome === "terminal" ? "dispatcher_delivery_terminal" : "dispatcher_attempts_exhausted",
    )
    if (!terminalSettled) await archiveDuplicate(queue, stats, queued.msgId)
    return
  }
  // Record the retryable failure BEFORE rescheduling so the next delivery's
  // started (fresh attemptId) finds a valid retryable-restart predecessor
  // instead of conflicting with this attempt's orphaned started.
  // retryAt carries a 30s margin under the VT delay: the store and pgmq run on
  // the database clock while this process may run ahead, and an early
  // redelivery would conflict instead of starting cleanly.
  const retryAt = new Date(options.now().getTime() + backoffSeconds * 1_000 - 30_000).toISOString()
  let heal = false
  try {
    const recorded = await events.recordAttemptFailedRetryable({
      teamId: message.teamId,
      targetId: message.targetId,
      attemptId,
      eventId: randomUUID(),
      errorCode: "dispatcher_publish_retryable",
      retryAt,
    })
    if (recorded === "target-missing") {
      if (await queue.archive(queued.msgId)) stats.staleArchived += 1
      else stats.alreadySettled += 1
      return
    }
    if (recorded === "conflict") {
      // Stream moved on without us (cancelled, superseded, or another worker
      // closed the attempt): heal instead of blindly rescheduling.
      heal = true
    }
  } catch {
    stats.processingErrors += 1
  }
  if (heal) {
    // Throws bubble to the per-message catch (processingErrors + reschedule),
    // consistent with the started-conflict call site below.
    await healConflictingAttempt(queue, events, options, stats, queued, message)
    return
  }
  if (await queue.reschedule(queued.msgId, backoffSeconds)) {
    stats.retried += 1
  } else {
    stats.alreadySettled += 1
  }
}

/**
 * Heals a started-conflict: another attempt already owns the target's publish
 * stream. If that attempt already reached a terminal outcome this message is a
 * pointless duplicate (archive). Otherwise back off and let the owner finish;
 * at the attempt cap, abandon the stuck attempt so the target converges
 * instead of churning: first try a terminal for the owner's own attemptId
 * (valid when latest is a receipt-less started/progressed), falling back to a
 * FRESH attempt's started+terminal pair (valid when latest is a due
 * retryable-restart). Throws bubble to the per-message catch
 * (processingErrors + reschedule).
 */
async function healConflictingAttempt(
  queue: DispatchQueueStore,
  events: DispatchEventWriter,
  options: ResolvedDrainOptions,
  stats: Record<keyof DispatchDrainStats, number>,
  queued: QueuedDispatchMessage,
  message: DispatchMessage,
): Promise<void> {
  const latest = await events.loadLatestPublishAttempt({
    teamId: message.teamId,
    targetId: message.targetId,
  })
  if (!latest || latest.terminal) {
    if (await queue.archive(queued.msgId)) stats.duplicateSkipped += 1
    else stats.alreadySettled += 1
    return
  }
  if (queued.readCt >= options.maximumAttempts) {
    // Abandon the stuck owner: its own attemptId first (covers a dead owner
    // between started and its follow-up), then a fresh pair (covers a due
    // retryable-restart latest, against which the owner's id is invalid).
    const abandoned = await recordTerminal(
      queue,
      events,
      options,
      stats,
      queued.msgId,
      message,
      latest.attemptId,
      "dispatcher_prior_attempt_abandoned",
    )
    if (abandoned) return
    const freshAttemptId = randomUUID()
    const opened = await events.recordAttemptStarted({
      teamId: message.teamId,
      targetId: message.targetId,
      attemptId: freshAttemptId,
      eventId: randomUUID(),
    })
    if (opened === "target-missing") {
      if (await queue.archive(queued.msgId)) stats.staleArchived += 1
      else stats.alreadySettled += 1
      return
    }
    if (opened !== "recorded") {
      if (await queue.archive(queued.msgId)) stats.duplicateSkipped += 1
      else stats.alreadySettled += 1
      return
    }
    const freshSettled = await recordTerminal(
      queue,
      events,
      options,
      stats,
      queued.msgId,
      message,
      freshAttemptId,
      "dispatcher_prior_attempt_abandoned",
    )
    if (!freshSettled) await archiveDuplicate(queue, stats, queued.msgId)
    return
  }
  if (await queue.reschedule(queued.msgId, retryDelaySeconds(queued.readCt, options))) {
    stats.retried += 1
  } else {
    stats.alreadySettled += 1
  }
}

async function recordTerminal(
  queue: DispatchQueueStore,
  events: DispatchEventWriter,
  options: ResolvedDrainOptions,
  stats: Record<keyof DispatchDrainStats, number>,
  msgId: number,
  message: DispatchMessage,
  attemptId: string,
  errorCode: string,
): Promise<boolean> {
  // Returns true when the terminal outcome is settled (event recorded or
  // target gone). Returns false on writer conflict — the stream moved on
  // without us, so the caller decides the fallback (duplicate archive vs a
  // fresh abandon attempt). Terminal sticks: the enqueue query excludes
  // targets carrying a non-retryable publish.failed event, so a recorded
  // terminal never re-enqueues. If the write itself fails, do NOT archive —
  // reschedule so the terminal write is retried instead of the message being
  // dropped into a re-enqueue loop.
  let result: DispatchEventResult
  try {
    result = await events.recordAttemptFailedTerminal({
      teamId: message.teamId,
      targetId: message.targetId,
      attemptId,
      eventId: randomUUID(),
      errorCode,
    })
  } catch {
    stats.processingErrors += 1
    try {
      await queue.reschedule(msgId, options.retryBaseDelaySeconds)
    } catch {
      // Lease expiry will redeliver; nothing else safe to do here.
    }
    return true
  }
  if (result === "target-missing") {
    if (await queue.archive(msgId)) stats.staleArchived += 1
    else stats.alreadySettled += 1
    return true
  }
  if (result === "conflict") return false
  if (await queue.archive(msgId)) stats.terminalArchived += 1
  else stats.alreadySettled += 1
  return true
}

async function archiveDuplicate(
  queue: DispatchQueueStore,
  stats: Record<keyof DispatchDrainStats, number>,
  msgId: number,
): Promise<void> {
  if (await queue.archive(msgId)) stats.duplicateSkipped += 1
  else stats.alreadySettled += 1
}

async function settleOutcome(
  publish: () => Promise<DispatchPublishOutcome>,
): Promise<DispatchPublishOutcome> {
  try {
    return await publish()
  } catch {
    // Unexpected publisher failure: requeue with backoff, never lose the message.
    return "retryable"
  }
}

export function retryDelaySeconds(
  attempt: number,
  options: {
    readonly retryBaseDelaySeconds?: number
    readonly retryMaximumDelaySeconds?: number
  } = {},
): number {
  const base = options.retryBaseDelaySeconds ?? defaultRetryBaseDelaySeconds
  const maximum = options.retryMaximumDelaySeconds ?? defaultRetryMaximumDelaySeconds
  if (!Number.isSafeInteger(attempt) || attempt < 1) return validatedDelay(base, "base")
  return Math.min(
    validatedDelay(maximum, "maximum"),
    validatedDelay(base, "base") * 2 ** Math.min(attempt - 1, 10),
  )
}

function validatedDelay(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximumDispatchDelaySeconds) {
    throw new TypeError(`Invalid dispatch retry ${name} delay`)
  }
  return value
}

export function decodeDispatchMessage(input: unknown): DispatchMessage | null {
  try {
    if (!input || typeof input !== "object" || Array.isArray(input)) return null
    const record = input as Record<string, unknown>
    const teamId = snapshotIntegrationIdentifier(record.teamId)
    const targetId = snapshotIntegrationIdentifier(record.targetId)
    const calendarPostId = record.calendarPostId === undefined || record.calendarPostId === null
      ? null
      : snapshotIntegrationIdentifier(record.calendarPostId)
    const publishAt = record.publishAt === undefined || record.publishAt === null
      ? null
      : validatedTimestamp(record.publishAt)
    return Object.freeze({ teamId, targetId, calendarPostId, publishAt })
  } catch {
    return null
  }
}

function validatedTimestamp(input: unknown): string {
  if (typeof input !== "string" || !Number.isFinite(Date.parse(input))) {
    throw new TypeError("Invalid dispatch timestamp")
  }
  return input
}

export interface DispatchProviderBinding {
  /**
   * Identifies one provider's dispatch lane. A complete binding also supplies:
   * a target validator (DrainDispatchQueueOptions.validateTarget), a publisher
   * (DueTargetPublisher), and an event writer (DispatchEventWriter). Calling
   * the core drain without a validator accepts every contract — only correct
   * for providers with no contract versions.
   */
  readonly provider: string
  readonly queueName: string
}

interface ResolvedDrainOptions {
  readonly batchSize: number
  readonly visibilityTimeoutSeconds: number
  readonly maximumAttempts: number
  readonly retryBaseDelaySeconds: number
  readonly retryMaximumDelaySeconds: number
  readonly deadlineTimestampMs: number
  readonly validateTarget: DispatchTargetValidator
  readonly now: () => Date
}

function drainOptions(input: DrainDispatchQueueOptions): ResolvedDrainOptions {
  const batchSize = input.batchSize ?? defaultBatchSize
  const visibilityTimeoutSeconds = input.visibilityTimeoutSeconds ?? defaultVisibilityTimeoutSeconds
  const maximumAttempts = input.maximumAttempts ?? defaultMaximumAttempts
  const retryBaseDelaySeconds = validatedDelay(
    input.retryBaseDelaySeconds ?? defaultRetryBaseDelaySeconds,
    "base",
  )
  const retryMaximumDelaySeconds = validatedDelay(
    input.retryMaximumDelaySeconds ?? defaultRetryMaximumDelaySeconds,
    "maximum",
  )
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 100) {
    throw new TypeError("Invalid dispatch batch size")
  }
  if (
    !Number.isSafeInteger(visibilityTimeoutSeconds) ||
    visibilityTimeoutSeconds < 10 ||
    visibilityTimeoutSeconds > 3_600
  ) {
    throw new TypeError("Invalid dispatch visibility timeout")
  }
  if (!Number.isSafeInteger(maximumAttempts) || maximumAttempts < 1 || maximumAttempts > 25) {
    throw new TypeError("Invalid dispatch maximum attempts")
  }
  if (retryBaseDelaySeconds > retryMaximumDelaySeconds) {
    throw new TypeError("Invalid dispatch retry delay range")
  }
  const deadlineTimestampMs = input.deadlineTimestampMs ?? Number.POSITIVE_INFINITY
  if (typeof deadlineTimestampMs !== "number" || !(deadlineTimestampMs > 0)) {
    throw new TypeError("Invalid dispatch deadline")
  }
  return {
    batchSize,
    visibilityTimeoutSeconds,
    maximumAttempts,
    retryBaseDelaySeconds,
    retryMaximumDelaySeconds,
    deadlineTimestampMs,
    validateTarget: input.validateTarget ?? allowAnyDispatchTarget,
    now: input.now ?? (() => new Date()),
  }
}

export type DispatchDatabase = ReturnType<typeof getDatabase>

export async function enqueueDueTargets(
  database: DispatchDatabase,
  binding: DispatchProviderBinding,
  batchSize = 50,
): Promise<number> {
  const queueName = validatedQueueName(binding.queueName)
  const provider = validatedProviderName(binding.provider)
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 500) {
    throw new TypeError("Invalid dispatch enqueue batch size")
  }
  const rows = await database<{ readonly enqueue_due_social_targets: number | string }[]>`
    SELECT public.enqueue_due_social_targets(${queueName}, ${provider}, ${batchSize})
  `
  const value = rows[0]?.enqueue_due_social_targets ?? 0
  const parsed = typeof value === "number" ? value : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new TypeError("Invalid dispatch enqueue result")
  }
  return parsed
}

export class PostgresDispatchQueueStore implements DispatchQueueStore {
  constructor(
    private readonly database: DispatchDatabase = getDatabase(),
    private readonly queueName: string,
  ) {
    validatedQueueName(queueName)
  }

  async read(
    limit: number,
    visibilityTimeoutSeconds: number,
  ): Promise<readonly QueuedDispatchMessage[]> {
    const rows = await this.database<{
      readonly msg_id: number | string
      readonly read_ct: number | string
      readonly message: unknown
    }[]>`
      SELECT msg_id, read_ct, message
      FROM public.read_social_dispatch_messages(${this.queueName}, ${visibilityTimeoutSeconds}, ${limit})
    `
    return Object.freeze(rows.map((row) =>
      Object.freeze({
        msgId: Number(row.msg_id),
        readCt: Number(row.read_ct),
        message: row.message,
      })
    ))
  }

  async archive(msgId: number): Promise<boolean> {
    const rows = await this.database<{ readonly archive_social_dispatch_message: boolean }[]>`
      SELECT public.archive_social_dispatch_message(${this.queueName}, ${msgId})
    `
    return rows[0]?.archive_social_dispatch_message ?? false
  }

  async reschedule(msgId: number, delaySeconds: number): Promise<boolean> {
    const rows = await this.database<{ readonly reschedule_social_dispatch_message: boolean }[]>`
      SELECT public.reschedule_social_dispatch_message(${this.queueName}, ${msgId}, ${delaySeconds})
    `
    return rows[0]?.reschedule_social_dispatch_message ?? false
  }
}

export class PostgresDispatchTargetGate implements DispatchTargetGate {
  private readonly provider: string

  constructor(
    private readonly database: DispatchDatabase = getDatabase(),
    provider: string,
  ) {
    this.provider = validatedProviderName(provider)
  }

  async loadTarget(teamId: string, targetId: string): Promise<DispatchTargetState | null> {
    const rows = await this.database<{
      readonly status: string
      readonly publish_at: Date | string
      readonly contract_version: number | string
      readonly connection_ok: boolean | null
    }[]>`
      SELECT status, publish_at, contract_version, connection_ok
      FROM public.load_social_dispatch_target(${teamId}, ${targetId}, ${this.provider})
    `
    const row = rows[0]
    if (!row) return null
    const publishAt = row.publish_at instanceof Date
      ? row.publish_at.toISOString()
      : new Date(row.publish_at).toISOString()
    const contractVersion = typeof row.contract_version === "number"
      ? row.contract_version
      : Number(row.contract_version)
    if (!Number.isSafeInteger(contractVersion)) return null
    return Object.freeze({
      status: row.status,
      publishAt,
      contractVersion,
      connectionOk: row.connection_ok === true,
    })
  }
}

export function isDispatchStateConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  const tag = (error as { _tag?: unknown })._tag
  const reason = (error as { reason?: unknown }).reason
  // NOTE: target_inactive is intentionally absent — isDispatchTargetMissing
  // claims it first (checked before this in append).
  return tag === "SocialDeliveryEventStateError"
    && (reason === "invalid_transition" || reason === "request_conflict")
}

export function isDispatchTargetMissing(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  if ((error as { _tag?: unknown })._tag !== "SocialDeliveryEventStateError") return false
  const reason = (error as { reason?: unknown }).reason
  // target_inactive means the target left scheduled status mid-flight
  // (cancelled/superseded): stale, same as target_missing.
  return reason === "target_missing" || reason === "target_inactive"
}
