import "server-only"

import { Effect, Either } from "effect"

import { getDatabase } from "../../db/database"
import { PostgresSocialDeliveryEventStore } from "./delivery-events"
import {
  drainDispatchQueue,
  enqueueDueTargets,
  isDispatchStateConflict,
  isDispatchTargetMissing,
  PostgresDispatchQueueStore,
  PostgresDispatchTargetGate,
  validatedProviderName,
  validatedQueueName,
  type DispatchDatabase,
  type DispatchDrainStats,
  type DispatchEventResult,
  type DispatchEventWriter,
  type DispatchMessage,
  type DispatchProviderBinding,
  type DispatchQueueStore,
  type DispatchTargetGate,
  type DispatchTargetState,
  type DrainDispatchQueueOptions,
  type DueTargetPublisher,
} from "./dispatch-queue"

/**
 * Instagram binding for the provider-generic dispatch core
 * (dispatch-queue.ts). Adding a provider (e.g. X/Twitter) means: a sibling
 * binding module, a pgmq queue + the generic SQL wrappers pointed at it, a
 * provider publish drive, and a widening of the provider CHECK constraints on
 * social_post_targets / social_delivery_events (today instagram-only). The
 * drain loop, retry/backoff, healing, and stats do not change.
 */

export const instagramDispatchQueueName = "instagram_publish" as const
export const instagramDispatchProviderName = "instagram" as const

/** Only template version 1 exists; anything else is terminal, never published. */
const supportedInstagramTemplateVersion = 1

export const instagramDispatchBinding: DispatchProviderBinding = Object.freeze({
  provider: instagramDispatchProviderName,
  queueName: instagramDispatchQueueName,
})

export function validateInstagramDispatchTarget(
  _message: DispatchMessage,
  target: DispatchTargetState,
): { readonly ok: true } | { readonly ok: false; readonly errorCode: string } {
  if (target.contractVersion !== supportedInstagramTemplateVersion) {
    return Object.freeze({ ok: false as const, errorCode: "dispatcher_template_unsupported" })
  }
  return Object.freeze({ ok: true as const })
}

export class PostgresInstagramDispatchQueueStore extends PostgresDispatchQueueStore {
  constructor(database: DispatchDatabase = getDatabase()) {
    super(database, validatedQueueName(instagramDispatchQueueName))
  }
}

export class PostgresInstagramDispatchTargetGate extends PostgresDispatchTargetGate {
  constructor(database: DispatchDatabase = getDatabase()) {
    super(database, validatedProviderName(instagramDispatchProviderName))
  }
}

export class PostgresInstagramDispatchEventWriter implements DispatchEventWriter {
  // NOTE: the underlying delivery store hardcodes provider 'instagram'
  // (PostgresSocialDeliveryEventStore + the social_delivery_events provider
  // CHECK). A second provider needs that store parameterized by provider;
  // the writer seam above already is.
  constructor(private readonly database: DispatchDatabase = getDatabase()) {}

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
      FROM public.load_latest_social_publish_attempt(
        ${input.teamId},
        ${input.targetId},
        ${validatedProviderName(instagramDispatchProviderName)}
      )
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

export async function enqueueDueInstagramTargets(
  database: DispatchDatabase = getDatabase(),
  batchSize = 50,
): Promise<number> {
  return enqueueDueTargets(database, instagramDispatchBinding, batchSize)
}

export async function drainInstagramDispatchQueue(
  queue: DispatchQueueStore,
  gate: DispatchTargetGate,
  publisher: DueTargetPublisher,
  events: DispatchEventWriter,
  inputOptions: DrainDispatchQueueOptions = {},
): Promise<DispatchDrainStats> {
  if (inputOptions.validateTarget !== undefined) {
    throw new TypeError("Instagram dispatch validation is fixed by the binding")
  }
  return drainDispatchQueue(queue, gate, publisher, events, {
    ...inputOptions,
    validateTarget: validateInstagramDispatchTarget,
  })
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
export const unimplementedInstagramPublisher: DueTargetPublisher = {
  publish: async () => {
    throw new InstagramPublishNotImplementedError()
  },
}
