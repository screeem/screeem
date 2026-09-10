import "server-only"

import { randomUUID } from "node:crypto"

import { Effect, Either } from "effect"

import { snapshotIntegrationIdentifier } from "../contract"
import { getDatabase } from "../../db/database"
import { PostgresSocialDeliveryEventStore } from "./delivery-events"

export const instagramDispatchQueueName = "instagram_publish" as const

/** Only template version 1 exists; anything else is terminal, never published. */
const supportedTemplateVersion = 1

export interface InstagramDispatchMessage {
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
  readonly templateVersion: number
  readonly connectionOk: boolean
}

export type DispatchPublishOutcome =
  | "succeeded"
  | "stale"
  | "retryable"
  | "terminal"

export interface InstagramDispatchQueueStore {
  read(limit: number, visibilityTimeoutSeconds: number): Promise<readonly QueuedDispatchMessage[]>
  /** Returns false when the message is already gone (handled elsewhere). */
  archive(msgId: number): Promise<boolean>
  /** Returns false when the message is already gone (handled elsewhere). */
  reschedule(msgId: number, delaySeconds: number): Promise<boolean>
}

export interface InstagramDispatchTargetGate {
  loadTarget(teamId: string, targetId: string): Promise<DispatchTargetState | null>
}

export interface InstagramDueTargetPublisher {
  /**
   * Publishes one due target. Contract: return "succeeded" ONLY after appending
   * the success-chain delivery events (progressed/succeeded with sealed
   * receipts) for this attempt. The drain loop archives the queue message but
   * writes no success event itself, and enqueue's terminal exclusion depends on
   * those events existing — a bare "succeeded" would re-enqueue and
   * double-publish.
   */
  publish(
    message: InstagramDispatchMessage,
    target: DispatchTargetState,
  ): Promise<DispatchPublishOutcome>
}

export type DispatchEventResult = "recorded" | "conflict" | "target-missing"

export interface InstagramDispatchEventWriter {
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

export interface DrainInstagramDispatchQueueOptions {
  readonly batchSize?: number
  readonly visibilityTimeoutSeconds?: number
  readonly maximumAttempts?: number
  readonly retryBaseDelaySeconds?: number
  readonly retryMaximumDelaySeconds?: number
  readonly deadlineTimestampMs?: number
  readonly now?: () => Date
}

export interface InstagramDispatchDrainStats {
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

export async function drainInstagramDispatchQueue(
  queue: InstagramDispatchQueueStore,
  gate: InstagramDispatchTargetGate,
  publisher: InstagramDueTargetPublisher,
  events: InstagramDispatchEventWriter,
  inputOptions: DrainInstagramDispatchQueueOptions = {},
): Promise<InstagramDispatchDrainStats> {
  const options = drainOptions(inputOptions)
  const stats: Record<keyof InstagramDispatchDrainStats, number> = {
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
  queue: InstagramDispatchQueueStore,
  gate: InstagramDispatchTargetGate,
  publisher: InstagramDueTargetPublisher,
  events: InstagramDispatchEventWriter,
  options: ResolvedDrainOptions,
  stats: Record<keyof InstagramDispatchDrainStats, number>,
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
  if (target.templateVersion !== supportedTemplateVersion) {
    // Terminal, but only sticks if recorded: a publish.failed with no preceding
    // publish.started is rejected as invalid_transition, so open the attempt
    // first exactly like the normal terminal path.
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
    await recordTerminal(
      queue,
      events,
      options,
      stats,
      queued.msgId,
      message,
      attemptId,
      "dispatcher_template_unsupported",
    )
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
    // Success-chain events (progressed/succeeded with sealed receipts) belong
    // to the real provider.publish drive, which lands with it (see the
    // publisher contract above).
    if (await queue.archive(queued.msgId)) stats.published += 1
    else stats.alreadySettled += 1
    return
  }
  if (outcome === "stale") {
    await recordTerminal(
      queue,
      events,
      options,
      stats,
      queued.msgId,
      message,
      attemptId,
      "dispatcher_delivery_stale",
    )
    return
  }
  const backoffSeconds = retryDelaySeconds(attempt, options)
  if (outcome === "terminal" || attempt >= options.maximumAttempts) {
    await recordTerminal(
      queue,
      events,
      options,
      stats,
      queued.msgId,
      message,
      attemptId,
      outcome === "terminal" ? "dispatcher_delivery_terminal" : "dispatcher_attempts_exhausted",
    )
    return
  }
  // Record the retryable failure BEFORE rescheduling so the next delivery's
  // started (fresh attemptId) finds a valid retryable-restart predecessor
  // instead of conflicting with this attempt's orphaned started.
  const retryAt = new Date(options.now().getTime() + backoffSeconds * 1_000).toISOString()
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
  } catch {
    stats.processingErrors += 1
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
 * at the attempt cap, abandon the stuck attempt with a terminal event so the
 * target converges instead of churning forever.
 */
async function healConflictingAttempt(
  queue: InstagramDispatchQueueStore,
  events: InstagramDispatchEventWriter,
  options: ResolvedDrainOptions,
  stats: Record<keyof InstagramDispatchDrainStats, number>,
  queued: QueuedDispatchMessage,
  message: InstagramDispatchMessage,
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
    await recordTerminal(
      queue,
      events,
      options,
      stats,
      queued.msgId,
      message,
      latest.attemptId,
      "dispatcher_prior_attempt_abandoned",
    )
    return
  }
  if (await queue.reschedule(queued.msgId, retryDelaySeconds(queued.readCt, options))) {
    stats.retried += 1
  } else {
    stats.alreadySettled += 1
  }
}

async function recordTerminal(
  queue: InstagramDispatchQueueStore,
  events: InstagramDispatchEventWriter,
  options: ResolvedDrainOptions,
  stats: Record<keyof InstagramDispatchDrainStats, number>,
  msgId: number,
  message: InstagramDispatchMessage,
  attemptId: string,
  errorCode: string,
): Promise<void> {
  // Terminal sticks: the enqueue query excludes targets carrying a
  // non-retryable publish.failed event, so this never re-enqueues. If the
  // write itself fails, do NOT archive — reschedule so the terminal write is
  // retried instead of the message being dropped into a re-enqueue loop.
  try {
    const result = await events.recordAttemptFailedTerminal({
      teamId: message.teamId,
      targetId: message.targetId,
      attemptId,
      eventId: randomUUID(),
      errorCode,
    })
    if (result === "target-missing") {
      if (await queue.archive(msgId)) stats.staleArchived += 1
      else stats.alreadySettled += 1
      return
    }
    // A conflict means the stream moved on without us (another worker recorded
    // the outcome); our message is a duplicate, not a terminal.
    if (await queue.archive(msgId)) {
      stats[result === "conflict" ? "duplicateSkipped" : "terminalArchived"] += 1
    } else {
      stats.alreadySettled += 1
    }
  } catch {
    stats.processingErrors += 1
    try {
      await queue.reschedule(msgId, options.retryBaseDelaySeconds)
    } catch {
      // Lease expiry will redeliver; nothing else safe to do here.
    }
  }
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

export function decodeDispatchMessage(input: unknown): InstagramDispatchMessage | null {
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

interface ResolvedDrainOptions {
  readonly batchSize: number
  readonly visibilityTimeoutSeconds: number
  readonly maximumAttempts: number
  readonly retryBaseDelaySeconds: number
  readonly retryMaximumDelaySeconds: number
  readonly deadlineTimestampMs: number
  readonly now: () => Date
}

function drainOptions(input: DrainInstagramDispatchQueueOptions): ResolvedDrainOptions {
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
    now: input.now ?? (() => new Date()),
  }
}

type Database = ReturnType<typeof getDatabase>

export async function enqueueDueInstagramTargets(
  database: Database = getDatabase(),
  batchSize = 50,
): Promise<number> {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 500) {
    throw new TypeError("Invalid dispatch enqueue batch size")
  }
  const rows = await database<{ readonly enqueue_due_instagram_targets: number | string }[]>`
    SELECT public.enqueue_due_instagram_targets(${batchSize})
  `
  const value = rows[0]?.enqueue_due_instagram_targets ?? 0
  const parsed = typeof value === "number" ? value : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new TypeError("Invalid dispatch enqueue result")
  }
  return parsed
}

export class PostgresInstagramDispatchQueueStore implements InstagramDispatchQueueStore {
  constructor(private readonly database: Database = getDatabase()) {}

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
      FROM public.read_instagram_dispatch_messages(${visibilityTimeoutSeconds}, ${limit})
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
    const rows = await this.database<{ readonly archive_instagram_dispatch_message: boolean }[]>`
      SELECT public.archive_instagram_dispatch_message(${msgId})
    `
    return rows[0]?.archive_instagram_dispatch_message ?? false
  }

  async reschedule(msgId: number, delaySeconds: number): Promise<boolean> {
    const rows = await this.database<{ readonly reschedule_instagram_dispatch_message: boolean }[]>`
      SELECT public.reschedule_instagram_dispatch_message(${msgId}, ${delaySeconds})
    `
    return rows[0]?.reschedule_instagram_dispatch_message ?? false
  }
}

export class PostgresInstagramDispatchTargetGate implements InstagramDispatchTargetGate {
  constructor(private readonly database: Database = getDatabase()) {}

  async loadTarget(teamId: string, targetId: string): Promise<DispatchTargetState | null> {
    const rows = await this.database<{
      readonly status: string
      readonly publish_at: Date | string
      readonly template_version: number | string
      readonly connection_ok: boolean | null
    }[]>`
      SELECT status, publish_at, template_version, connection_ok
      FROM public.load_instagram_dispatch_target(${teamId}, ${targetId})
    `
    const row = rows[0]
    if (!row) return null
    const publishAt = row.publish_at instanceof Date
      ? row.publish_at.toISOString()
      : new Date(row.publish_at).toISOString()
    const templateVersion = typeof row.template_version === "number"
      ? row.template_version
      : Number(row.template_version)
    if (!Number.isSafeInteger(templateVersion)) return null
    return Object.freeze({
      status: row.status,
      publishAt,
      templateVersion,
      connectionOk: row.connection_ok === true,
    })
  }
}

export class PostgresInstagramDispatchEventWriter implements InstagramDispatchEventWriter {
  constructor(private readonly database: Database = getDatabase()) {}

  async recordAttemptStarted(input: {
    readonly teamId: string
    readonly targetId: string
    readonly attemptId: string
    readonly eventId: string
  }): Promise<DispatchEventResult> {
    return this.append(input.teamId, input.targetId, input.eventId, {
      eventType: "publish.started",
      data: { attemptId: input.attemptId },
    })
  }

  async recordAttemptFailedRetryable(input: {
    readonly teamId: string
    readonly targetId: string
    readonly attemptId: string
    readonly eventId: string
    readonly errorCode: string
    readonly retryAt: string
  }): Promise<DispatchEventResult> {
    return this.append(input.teamId, input.targetId, input.eventId, {
      eventType: "publish.failed",
      data: {
        attemptId: input.attemptId,
        errorCode: input.errorCode,
        receipt: { kind: "unchanged", revision: null },
        retryable: true,
        retryAt: input.retryAt,
        retryMode: "restart",
      },
    })
  }

  async loadLatestPublishAttempt(input: {
    readonly teamId: string
    readonly targetId: string
  }): Promise<{ readonly attemptId: string; readonly terminal: boolean } | null> {
    const rows = await this.database<{
      readonly attempt_id: string | null
      readonly terminal: boolean
    }[]>`
      SELECT attempt_id, terminal
      FROM public.load_latest_instagram_publish_attempt(${input.teamId}, ${input.targetId})
    `
    const row = rows[0]
    if (!row || !row.attempt_id) return null
    return Object.freeze({ attemptId: row.attempt_id, terminal: row.terminal })
  }

  async recordAttemptFailedTerminal(input: {
    readonly teamId: string
    readonly targetId: string
    readonly attemptId: string
    readonly eventId: string
    readonly errorCode: string
  }): Promise<DispatchEventResult> {
    return this.append(input.teamId, input.targetId, input.eventId, {
      eventType: "publish.failed",
      data: {
        attemptId: input.attemptId,
        errorCode: input.errorCode,
        receipt: { kind: "unchanged", revision: null },
        retryable: false,
        retryAt: null,
        retryMode: null,
      },
    })
  }

  private async append(
    teamId: string,
    targetId: string,
    eventId: string,
    action: unknown,
  ): Promise<DispatchEventResult> {
    const store = new PostgresSocialDeliveryEventStore(this.database)
    const result = await Effect.runPromise(Effect.either(
      store.appendSystemEvent({ teamId, targetId, eventId, action }),
    ))
    if (Either.isRight(result)) return "recorded"
    if (isDispatchTargetMissing(result.left)) return "target-missing"
    if (isDispatchStateConflict(result.left)) return "conflict"
    throw result.left
  }
}

function isDispatchStateConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  const tag = (error as { _tag?: unknown })._tag
  const reason = (error as { reason?: unknown }).reason
  return tag === "SocialDeliveryEventStateError"
    && (reason === "invalid_transition"
      || reason === "target_inactive"
      || reason === "request_conflict")
}

function isDispatchTargetMissing(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  return (error as { _tag?: unknown })._tag === "SocialDeliveryEventStateError"
    && (error as { reason?: unknown }).reason === "target_missing"
}

export class InstagramPublishNotImplementedError extends Error {
  constructor() {
    super("Instagram dispatch publish is not implemented yet")
    this.name = "InstagramPublishNotImplementedError"
  }
}

/**
 * Placeholder publisher until the provider.publish drive lands. It throws, which
 * the drain loop converts to a backoff requeue — due targets wait safely instead
 * of being published incorrectly or dropped.
 */
export const unimplementedInstagramPublisher: InstagramDueTargetPublisher = {
  publish: async () => {
    throw new InstagramPublishNotImplementedError()
  },
}
