import "server-only"

import { snapshotIntegrationIdentifier } from "../contract"
import { getDatabase } from "../../db/database"

export const instagramDispatchQueueName = "instagram_publish" as const

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
}

export type DispatchPublishOutcome =
  | "succeeded"
  | "stale"
  | "retryable"
  | "terminal"

export interface InstagramDispatchQueueStore {
  read(limit: number, visibilityTimeoutSeconds: number): Promise<readonly QueuedDispatchMessage[]>
  archive(msgId: number): Promise<void>
  reschedule(msgId: number, delaySeconds: number): Promise<void>
}

export interface InstagramDispatchTargetGate {
  loadTarget(teamId: string, targetId: string): Promise<DispatchTargetState | null>
}

export interface InstagramDueTargetPublisher {
  publish(
    message: InstagramDispatchMessage,
    target: DispatchTargetState,
  ): Promise<DispatchPublishOutcome>
}

export interface DrainInstagramDispatchQueueOptions {
  readonly batchSize?: number
  readonly visibilityTimeoutSeconds?: number
  readonly maximumAttempts?: number
  readonly retryBaseDelaySeconds?: number
  readonly retryMaximumDelaySeconds?: number
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
}

const defaultBatchSize = 25
const defaultVisibilityTimeoutSeconds = 60
const defaultMaximumAttempts = 5
const defaultRetryBaseDelaySeconds = 60
const defaultRetryMaximumDelaySeconds = 3_600

export async function drainInstagramDispatchQueue(
  queue: InstagramDispatchQueueStore,
  gate: InstagramDispatchTargetGate,
  publisher: InstagramDueTargetPublisher,
  inputOptions: DrainInstagramDispatchQueueOptions = {},
): Promise<InstagramDispatchDrainStats> {
  const options = drainOptions(inputOptions)
  const now = options.now()
  const stats: Record<keyof InstagramDispatchDrainStats, number> = {
    read: 0,
    published: 0,
    staleArchived: 0,
    invalidArchived: 0,
    notDueRescheduled: 0,
    retried: 0,
    terminalArchived: 0,
  }

  const messages = await queue.read(options.batchSize, options.visibilityTimeoutSeconds)
  stats.read = messages.length

  for (const queued of messages) {
    const message = decodeDispatchMessage(queued.message)
    if (!message) {
      await queue.archive(queued.msgId)
      stats.invalidArchived += 1
      continue
    }
    const target = await gate.loadTarget(message.teamId, message.targetId)
    if (!target || target.status !== "scheduled") {
      // Cancelled, superseded, or deleted after enqueue: never publish.
      await queue.archive(queued.msgId)
      stats.staleArchived += 1
      continue
    }
    const publishAt = Date.parse(target.publishAt)
    if (Number.isFinite(publishAt) && publishAt > now.getTime()) {
      await queue.reschedule(
        queued.msgId,
        Math.min(
          options.retryMaximumDelaySeconds,
          Math.max(60, Math.ceil((publishAt - now.getTime()) / 1_000)),
        ),
      )
      stats.notDueRescheduled += 1
      continue
    }
    const outcome = await settleOutcome(() => publisher.publish(message, target))
    if (outcome === "succeeded" || outcome === "stale" || outcome === "terminal") {
      await queue.archive(queued.msgId)
      if (outcome === "succeeded") stats.published += 1
      else stats.terminalArchived += 1
      continue
    }
    const attempts = queued.readCt + 1
    if (attempts >= options.maximumAttempts) {
      await queue.archive(queued.msgId)
      stats.terminalArchived += 1
      continue
    }
    await queue.reschedule(queued.msgId, retryDelaySeconds(attempts, options))
    stats.retried += 1
  }

  return Object.freeze({ ...stats })
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
  if (!Number.isSafeInteger(attempt) || attempt < 1) return base
  return Math.min(maximum, base * 2 ** Math.min(attempt - 1, 10))
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

function drainOptions(input: DrainInstagramDispatchQueueOptions) {
  const batchSize = input.batchSize ?? defaultBatchSize
  const visibilityTimeoutSeconds = input.visibilityTimeoutSeconds ?? defaultVisibilityTimeoutSeconds
  const maximumAttempts = input.maximumAttempts ?? defaultMaximumAttempts
  const retryBaseDelaySeconds = input.retryBaseDelaySeconds ?? defaultRetryBaseDelaySeconds
  const retryMaximumDelaySeconds = input.retryMaximumDelaySeconds ?? defaultRetryMaximumDelaySeconds
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
  return {
    batchSize,
    visibilityTimeoutSeconds,
    maximumAttempts,
    retryBaseDelaySeconds,
    retryMaximumDelaySeconds,
    now: input.now ?? (() => new Date()),
  }
}

type Database = ReturnType<typeof getDatabase>

export async function enqueueDueInstagramTargets(
  database: Database = getDatabase(),
  batchSize = 50,
): Promise<number> {
  const rows = await database<{ readonly enqueue_due_instagram_targets: number | string }[]>`
    SELECT public.enqueue_due_instagram_targets(${batchSize})
  `
  const value = rows[0]?.enqueue_due_instagram_targets ?? 0
  return typeof value === "number" ? value : Number(value)
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
      FROM pgmq.read(${instagramDispatchQueueName}, ${visibilityTimeoutSeconds}, ${limit})
    `
    return Object.freeze(rows.map((row) =>
      Object.freeze({
        msgId: Number(row.msg_id),
        readCt: Number(row.read_ct),
        message: row.message,
      })
    ))
  }

  async archive(msgId: number): Promise<void> {
    await this.database`
      SELECT public.archive_instagram_dispatch_message(${msgId})
    `
  }

  async reschedule(msgId: number, delaySeconds: number): Promise<void> {
    await this.database`
      SELECT public.reschedule_instagram_dispatch_message(${msgId}, ${delaySeconds})
    `
  }
}

export class PostgresInstagramDispatchTargetGate implements InstagramDispatchTargetGate {
  constructor(private readonly database: Database = getDatabase()) {}

  async loadTarget(teamId: string, targetId: string): Promise<DispatchTargetState | null> {
    const rows = await this.database<{
      readonly status: string
      readonly publish_at: Date | string
    }[]>`
      SELECT status, publish_at
      FROM social_post_targets
      WHERE team_id = ${teamId} AND id = ${targetId}
    `
    const row = rows[0]
    if (!row) return null
    const publishAt = row.publish_at instanceof Date
      ? row.publish_at.toISOString()
      : new Date(row.publish_at).toISOString()
    return Object.freeze({ status: row.status, publishAt })
  }
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
