import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import {
  decodeDispatchMessage,
  drainDispatchQueue,
  enqueueDueTargets,
  retryDelaySeconds,
  type DispatchEventWriter,
  type DispatchQueueStore,
  type DispatchTargetGate,
  type DispatchDrainStats,
  type DueTargetPublisher,
  type QueuedDispatchMessage,
} from "../src/lib/integrations/social/dispatch-queue"

const teamId = "11111111-1111-4111-8111-111111111111"
const targetId = "22222222-2222-4222-8222-222222222222"
const message = Object.freeze({
  teamId,
  targetId,
  calendarPostId: "33333333-3333-4333-8333-333333333333",
  publishAt: "2026-09-02T08:30:00.000Z",
})

const emptyStats: DispatchDrainStats = Object.freeze({
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
})

function queueWith(messages: readonly QueuedDispatchMessage[]): DispatchQueueStore & {
  readonly archived: number[]
  readonly rescheduled: Array<{ readonly msgId: number; readonly delaySeconds: number }>
} {
  const archived: number[] = []
  const rescheduled: Array<{ readonly msgId: number; readonly delaySeconds: number }> = []
  return {
    archived,
    rescheduled,
    read: async () => messages,
    archive: async (msgId: number) => {
      archived.push(msgId)
      return true
    },
    reschedule: async (msgId: number, delaySeconds: number) => {
      rescheduled.push({ msgId, delaySeconds })
      return true
    },
  }
}

export interface GateState {
  readonly status: string
  readonly publishAt: string
  readonly contractVersion?: number
  readonly connectionOk?: boolean
}

function gateWith(state: GateState | null): DispatchTargetGate {
  return {
    loadTarget: async () => state === null ? null : {
      status: state.status,
      publishAt: state.publishAt,
      contractVersion: state.contractVersion ?? 1,
      connectionOk: state.connectionOk ?? true,
    },
  }
}

function publisherWith(
  outcome: "succeeded" | "stale" | "retryable" | "terminal" | Error,
): DueTargetPublisher & { readonly calls: number } {
  let calls = 0
  return {
    get calls() {
      return calls
    },
    publish: async () => {
      calls += 1
      if (outcome instanceof Error) throw outcome
      return outcome
    },
  }
}

function eventsWith(
  result: "recorded" | "conflict" | "target-missing" = "recorded",
  latest: { readonly attemptId: string; readonly terminal: boolean } | null = null,
  terminalResult: "recorded" | "conflict" | "target-missing" | null = null,
  startedSequence: Array<"recorded" | "conflict" | "target-missing"> | null = null,
  terminalSequence: Array<"recorded" | "conflict" | "target-missing"> | null = null,
): DispatchEventWriter & {
  readonly started: number
  readonly failedRetryable: number
  readonly failedTerminal: number
  readonly retryCalls: Array<{ readonly attemptId: string; readonly retryAt: string }>
  readonly startedAttempts: string[]
  readonly terminalAttempts: string[]
} {
  let started = 0
  let failedRetryable = 0
  let failedTerminal = 0
  const retryCalls: Array<{ readonly attemptId: string; readonly retryAt: string }> = []
  const startedAttempts: string[] = []
  const terminalAttempts: string[] = []
  return {
    get started() {
      return started
    },
    get failedRetryable() {
      return failedRetryable
    },
    get failedTerminal() {
      return failedTerminal
    },
    get retryCalls() {
      return retryCalls
    },
    get startedAttempts() {
      return startedAttempts
    },
    get terminalAttempts() {
      return terminalAttempts
    },
    recordAttemptStarted: async (input) => {
      started += 1
      startedAttempts.push(input.attemptId)
      return startedSequence?.[started - 1] ?? result
    },
    recordAttemptFailedRetryable: async (input) => {
      failedRetryable += 1
      retryCalls.push({ attemptId: input.attemptId, retryAt: input.retryAt })
      return result
    },
    recordAttemptFailedTerminal: async (input) => {
      failedTerminal += 1
      terminalAttempts.push(input.attemptId)
      return terminalSequence?.[failedTerminal - 1] ?? terminalResult ?? result
    },
    loadLatestPublishAttempt: async () => latest,
  }
}

const queued = (overrides: Partial<QueuedDispatchMessage> = {}): QueuedDispatchMessage => ({
  msgId: 1,
  // pgmq increments read_ct on every read, so the first live delivery of a
  // message always carries readCt === 1 (verified against pgmq 1.5.1, and
  // pinned by the pgmq-backed integration test).
  readCt: 1,
  message,
  ...overrides,
})

const scheduledDue = { status: "scheduled", publishAt: "2026-09-02T08:30:00.000Z" }
const now = () => new Date("2026-09-09T00:00:00.000Z")

describe("dispatch queue drain", () => {
  it("archives invalid messages without publishing", async () => {
    const queue = queueWith([queued({ message: { nope: true } })])
    const publisher = publisherWith("succeeded")
    const events = eventsWith()

    const stats = await drainDispatchQueue(queue, gateWith(scheduledDue), publisher, events, { now })

    expect(stats).toEqual({ ...emptyStats, read: 1, invalidArchived: 1 })
    expect(queue.archived).toEqual([1])
    expect(publisher.calls).toBe(0)
    expect(events.started).toBe(0)
  })

  it("archives messages whose target is no longer scheduled", async () => {
    for (const status of ["cancelled", "superseded"]) {
      const queue = queueWith([queued()])
      const publisher = publisherWith("succeeded")
      const events = eventsWith()

      const stats = await drainDispatchQueue(
        queue,
        gateWith({ status, publishAt: scheduledDue.publishAt }),
        publisher,
        events,
        { now },
      )

      expect(stats).toEqual({ ...emptyStats, read: 1, staleArchived: 1 })
      expect(queue.archived).toEqual([1])
      expect(publisher.calls).toBe(0)
      expect(events.started).toBe(0)
    }
  })

  it("archives messages whose target is gone", async () => {
    const queue = queueWith([queued()])
    const publisher = publisherWith("succeeded")
    const events = eventsWith()

    const stats = await drainDispatchQueue(queue, gateWith(null), publisher, events, { now })

    expect(stats).toEqual({ ...emptyStats, read: 1, staleArchived: 1 })
    expect(queue.archived).toEqual([1])
    expect(publisher.calls).toBe(0)
  })

  it("records a terminal failure when the provider validator rejects", async () => {
    const queue = queueWith([queued()])
    const publisher = publisherWith("succeeded")
    const events = eventsWith()
    const rejectV2 = () => ({ ok: false as const, errorCode: "dispatcher_contract_unsupported" })

    const stats = await drainDispatchQueue(
      queue,
      gateWith({ ...scheduledDue, contractVersion: 2 }),
      publisher,
      events,
      { now, validateTarget: rejectV2 },
    )

    expect(stats).toEqual({ ...emptyStats, read: 1, terminalArchived: 1 })
    expect(events.started).toBe(1)
    expect(events.failedTerminal).toBe(1)
    expect(publisher.calls).toBe(0)
  })

  it("passes validation through to the publisher by default", async () => {
    const queue = queueWith([queued()])
    const publisher = publisherWith("succeeded")
    const events = eventsWith()

    const stats = await drainDispatchQueue(
      queue,
      gateWith({ ...scheduledDue, contractVersion: 2 }),
      publisher,
      events,
      { now },
    )

    expect(stats).toEqual({ ...emptyStats, read: 1, published: 1 })
  })

  it("archives stale when the target vanishes mid-attempt", async () => {
    const queue = queueWith([queued()])
    const publisher = publisherWith("succeeded")

    const startedStats = await drainDispatchQueue(
      queue,
      gateWith(scheduledDue),
      publisher,
      eventsWith("target-missing"),
      { now },
    )

    expect(startedStats).toEqual({ ...emptyStats, read: 1, staleArchived: 1 })
    expect(queue.archived).toEqual([1])
    expect(publisher.calls).toBe(0)
  })

  it("retries the terminal write instead of dropping it on writer failure", async () => {
    const queue = queueWith([queued({ readCt: 5 })])
    const throwing: DispatchEventWriter = {
      recordAttemptStarted: async () => "recorded",
      recordAttemptFailedRetryable: async () => "recorded",
      recordAttemptFailedTerminal: async () => {
        throw new Error("db blip")
      },
      loadLatestPublishAttempt: async () => null,
    }

    const stats = await drainDispatchQueue(
      queue,
      gateWith(scheduledDue),
      publisherWith("retryable"),
      throwing,
      { now, maximumAttempts: 5 },
    )

    expect(stats).toEqual({ ...emptyStats, read: 1, processingErrors: 1 })
    expect(queue.archived).toEqual([])
    expect(queue.rescheduled).toEqual([{ msgId: 1, delaySeconds: 60 }])
  })

  it("requeues when the connection is unavailable without recording events", async () => {
    const queue = queueWith([queued()])
    const publisher = publisherWith("succeeded")
    const events = eventsWith()

    const stats = await drainDispatchQueue(
      queue,
      gateWith({ ...scheduledDue, connectionOk: false }),
      publisher,
      events,
      { now },
    )

    expect(stats).toEqual({ ...emptyStats, read: 1, retried: 1 })
    expect(queue.archived).toEqual([])
    expect(events.started).toBe(0)
    expect(publisher.calls).toBe(0)
  })

  it("reschedules messages that are not due yet", async () => {
    const queue = queueWith([queued()])
    const publisher = publisherWith("succeeded")
    const events = eventsWith()
    const future = new Date(now().getTime() + 10 * 60 * 1_000).toISOString()

    const stats = await drainDispatchQueue(
      queue,
      gateWith({ status: "scheduled", publishAt: future }),
      publisher,
      events,
      { now },
    )

    expect(stats).toEqual({ ...emptyStats, read: 1, notDueRescheduled: 1 })
    expect(queue.archived).toEqual([])
    expect(queue.rescheduled).toHaveLength(1)
    expect(queue.rescheduled[0]?.delaySeconds).toBeGreaterThanOrEqual(600)
    expect(publisher.calls).toBe(0)
  })

  it("caps the not-due reschedule at the maximum delay", async () => {
    const queue = queueWith([queued()])
    const farFuture = new Date(now().getTime() + 48 * 3_600 * 1_000).toISOString()

    const stats = await drainDispatchQueue(
      queue,
      gateWith({ status: "scheduled", publishAt: farFuture }),
      publisherWith("succeeded"),
      eventsWith(),
      { now, retryMaximumDelaySeconds: 3_600 },
    )

    expect(stats).toEqual({ ...emptyStats, read: 1, notDueRescheduled: 1 })
    expect(queue.rescheduled).toEqual([{ msgId: 1, delaySeconds: 3_600 }])
  })

  it("records started and archives on publish success", async () => {
    const queue = queueWith([queued()])
    const publisher = publisherWith("succeeded")
    const events = eventsWith()

    const stats = await drainDispatchQueue(queue, gateWith(scheduledDue), publisher, events, { now })

    expect(stats).toEqual({ ...emptyStats, read: 1, published: 1 })
    expect(events.started).toBe(1)
    expect(queue.archived).toEqual([1])
  })

  it("drops duplicates when another attempt is already active", async () => {
    const queue = queueWith([queued()])
    const publisher = publisherWith("succeeded")

    const stats = await drainDispatchQueue(
      queue,
      gateWith(scheduledDue),
      publisher,
      eventsWith("conflict"),
      { now },
    )

    expect(stats).toEqual({ ...emptyStats, read: 1, duplicateSkipped: 1 })
    expect(queue.archived).toEqual([1])
    expect(publisher.calls).toBe(0)
  })

  it("requeues retryable outcomes with backoff and terminates at the attempt cap", async () => {
    const first = queueWith([queued({ readCt: 1 })])
    const firstEvents = eventsWith()
    const stats = await drainDispatchQueue(
      first,
      gateWith(scheduledDue),
      publisherWith("retryable"),
      firstEvents,
      { now, maximumAttempts: 3, retryBaseDelaySeconds: 60 },
    )
    expect(stats).toEqual({ ...emptyStats, read: 1, retried: 1 })
    expect(firstEvents.started).toBe(1)
    expect(firstEvents.failedRetryable).toBe(1)
    expect(first.rescheduled).toEqual([{ msgId: 1, delaySeconds: 60 }])

    const capped = queueWith([queued({ readCt: 3 })])
    const cappedEvents = eventsWith()
    const cappedStats = await drainDispatchQueue(
      capped,
      gateWith(scheduledDue),
      publisherWith("retryable"),
      cappedEvents,
      { now, maximumAttempts: 3 },
    )
    expect(cappedStats).toEqual({ ...emptyStats, read: 1, terminalArchived: 1 })
    expect(capped.archived).toEqual([1])
    expect(cappedEvents.failedTerminal).toBe(1)
  })

  it("heals started-conflicts against the latest attempt", async () => {
    const attempt = "44444444-4444-4444-8444-444444444444"
    // Terminal latest: pointless duplicate, archive without publishing.
    const terminal = queueWith([queued()])
    const terminalStats = await drainDispatchQueue(
      terminal,
      gateWith(scheduledDue),
      publisherWith("succeeded"),
      eventsWith("conflict", { attemptId: attempt, terminal: true }),
      { now },
    )
    expect(terminalStats).toEqual({ ...emptyStats, read: 1, duplicateSkipped: 1 })

    // Live latest under the cap: back off and let the owner finish.
    const live = queueWith([queued({ readCt: 1 })])
    const liveStats = await drainDispatchQueue(
      live,
      gateWith(scheduledDue),
      publisherWith("succeeded"),
      eventsWith("conflict", { attemptId: attempt, terminal: false }),
      { now },
    )
    expect(liveStats).toEqual({ ...emptyStats, read: 1, retried: 1 })

    // Live latest at the cap, abandonable by owner id: terminal for latest.
    const stuck = queueWith([queued({ readCt: 5 })])
    const stuckEvents = eventsWith("conflict", { attemptId: attempt, terminal: false }, "recorded")
    const stuckStats = await drainDispatchQueue(
      stuck,
      gateWith(scheduledDue),
      publisherWith("succeeded"),
      stuckEvents,
      { now, maximumAttempts: 5 },
    )
    expect(stuckStats).toEqual({ ...emptyStats, read: 1, terminalArchived: 1 })
    expect(stuckEvents.started).toBe(1)
    expect(stuckEvents.failedTerminal).toBe(1)
    // Owner id first: the terminal targets the conflicting latest attempt.
    expect(stuckEvents.terminalAttempts).toEqual([attempt])
    expect(stuckEvents.startedAttempts).toHaveLength(1)

    // Live latest at the cap, owner id rejected: abandon via a fresh pair.
    const stuckFresh = queueWith([queued({ readCt: 5 })])
    const stuckFreshEvents = eventsWith(
      "conflict",
      { attemptId: attempt, terminal: false },
      null,
      ["conflict", "recorded"],
      ["conflict", "recorded"],
    )
    const stuckFreshStats = await drainDispatchQueue(
      stuckFresh,
      gateWith(scheduledDue),
      publisherWith("succeeded"),
      stuckFreshEvents,
      { now, maximumAttempts: 5 },
    )
    expect(stuckFreshStats).toEqual({ ...emptyStats, read: 1, terminalArchived: 1 })
    expect(stuckFreshEvents.started).toBe(2)
    expect(stuckFreshEvents.failedTerminal).toBe(2)
    // Fallback linkage: first terminal targets the owner, fresh started opens
    // a new attempt, second terminal closes it.
    expect(stuckFreshEvents.terminalAttempts[0]).toBe(attempt)
    expect(stuckFreshEvents.terminalAttempts[1]).toBe(stuckFreshEvents.startedAttempts[1])
    expect(stuckFreshEvents.startedAttempts[0]).not.toBe(stuckFreshEvents.startedAttempts[1])
  })

  it("archives duplicates when the terminal write itself conflicts", async () => {
    const queue = queueWith([queued({ readCt: 5 })])
    const events = eventsWith("recorded", null, "conflict")

    const stats = await drainDispatchQueue(
      queue,
      gateWith(scheduledDue),
      publisherWith("retryable"),
      events,
      { now, maximumAttempts: 5 },
    )

    expect(stats).toEqual({ ...emptyStats, read: 1, duplicateSkipped: 1 })
    expect(queue.archived).toEqual([1])
  })

  it("settles fresh-abandon edges without dropping the message", async () => {
    const attempt = "55555555-5555-4555-8555-555555555555"
    // Fresh terminal conflicts: duplicate, never dropped.
    const conflictFresh = queueWith([queued({ readCt: 5 })])
    const conflictFreshEvents = eventsWith(
      "conflict",
      { attemptId: attempt, terminal: false },
      null,
      ["conflict", "recorded"],
      ["conflict", "conflict"],
    )
    const conflictFreshStats = await drainDispatchQueue(
      conflictFresh,
      gateWith(scheduledDue),
      publisherWith("succeeded"),
      conflictFreshEvents,
      { now, maximumAttempts: 5 },
    )
    expect(conflictFreshStats).toEqual({ ...emptyStats, read: 1, duplicateSkipped: 1 })
    expect(conflictFresh.archived).toEqual([1])

    // Fresh started vanishes (target deleted): stale, never dropped.
    const missingFresh = queueWith([queued({ readCt: 5 })])
    const missingFreshEvents = eventsWith(
      "conflict",
      { attemptId: attempt, terminal: false },
      null,
      ["conflict", "target-missing"],
      ["conflict"],
    )
    const missingFreshStats = await drainDispatchQueue(
      missingFresh,
      gateWith(scheduledDue),
      publisherWith("succeeded"),
      missingFreshEvents,
      { now, maximumAttempts: 5 },
    )
    expect(missingFreshStats).toEqual({ ...emptyStats, read: 1, staleArchived: 1 })
    expect(missingFresh.archived).toEqual([1])

    // Validator terminal conflicts: duplicate, never dropped.
    const validatorConflict = queueWith([queued()])
    const validatorConflictStats = await drainDispatchQueue(
      validatorConflict,
      gateWith({ ...scheduledDue, contractVersion: 2 }),
      publisherWith("succeeded"),
      eventsWith("recorded", null, "conflict"),
      { now, validateTarget: () => ({ ok: false as const, errorCode: "dispatcher_contract_unsupported" }) },
    )
    expect(validatorConflictStats).toEqual({ ...emptyStats, read: 1, duplicateSkipped: 1 })
    expect(validatorConflict.archived).toEqual([1])
  })

  it("routes retryable-write conflicts through healing", async () => {
    const queue = queueWith([queued({ readCt: 1 })])
    const events: DispatchEventWriter = {
      recordAttemptStarted: async () => "recorded",
      recordAttemptFailedRetryable: async () => "conflict",
      recordAttemptFailedTerminal: async () => "recorded",
      loadLatestPublishAttempt: async () => null,
    }

    const stats = await drainDispatchQueue(
      queue,
      gateWith(scheduledDue),
      publisherWith("retryable"),
      events,
      { now },
    )

    expect(stats).toEqual({ ...emptyStats, read: 1, duplicateSkipped: 1 })
    expect(queue.archived).toEqual([1])
  })

  it("paces retryAt under the visibility delay for clock skew", async () => {
    const queue = queueWith([queued({ readCt: 1 })])
    const events = eventsWith()

    await drainDispatchQueue(
      queue,
      gateWith(scheduledDue),
      publisherWith("retryable"),
      events,
      { now, retryBaseDelaySeconds: 60 },
    )

    expect(events.retryCalls).toHaveLength(1)
    expect(events.retryCalls[0]?.retryAt).toBe(
      new Date(now().getTime() + 30_000).toISOString(),
    )
  })

  it("converts publisher exceptions into backoff requeues", async () => {
    const queue = queueWith([queued({ readCt: 1 })])

    const stats = await drainDispatchQueue(
      queue,
      gateWith(scheduledDue),
      publisherWith(new Error("boom")),
      eventsWith(),
      { now },
    )

    expect(stats).toEqual({ ...emptyStats, read: 1, retried: 1 })
    expect(queue.archived).toEqual([])
  })

  it("closes the attempt with a terminal event on publisher-reported stale", async () => {
    const queue = queueWith([queued()])
    const events = eventsWith()

    const stats = await drainDispatchQueue(
      queue,
      gateWith(scheduledDue),
      publisherWith("stale"),
      events,
      { now },
    )

    expect(stats).toEqual({ ...emptyStats, read: 1, terminalArchived: 1 })
    expect(events.started).toBe(1)
    expect(events.failedTerminal).toBe(1)
  })

  it("isolates mid-batch store failures and keeps draining", async () => {
    const archived: number[] = []
    const failing: DispatchQueueStore = {
      read: async () => [queued({ msgId: 1 }), queued({ msgId: 2 })],
      archive: async (msgId: number) => {
        if (msgId === 1) throw new Error("db blip")
        archived.push(msgId)
        return true
      },
      reschedule: async () => true,
    }

    const stats = await drainDispatchQueue(
      failing,
      gateWith(scheduledDue),
      publisherWith("succeeded"),
      eventsWith(),
      { now },
    )

    expect(stats).toEqual({ ...emptyStats, read: 2, published: 1, processingErrors: 1 })
    expect(archived).toEqual([2])
  })

  it("counts already-removed messages without lying in stats", async () => {
    const gone: DispatchQueueStore = {
      read: async () => [queued({ msgId: 7 })],
      archive: async () => false,
      reschedule: async () => false,
    }

    const stats = await drainDispatchQueue(
      gone,
      gateWith(scheduledDue),
      publisherWith("succeeded"),
      eventsWith(),
      { now },
    )

    expect(stats).toEqual({ ...emptyStats, read: 1, alreadySettled: 1 })
  })

  it("defers remaining messages past the deadline", async () => {
    const queue = queueWith([queued({ msgId: 1 }), queued({ msgId: 2 })])
    const publisher = publisherWith("succeeded")

    const stats = await drainDispatchQueue(
      queue,
      gateWith(scheduledDue),
      publisher,
      eventsWith(),
      { now, deadlineTimestampMs: now().getTime() },
    )

    expect(stats).toEqual({ ...emptyStats, read: 2, deferred: 2 })
    expect(publisher.calls).toBe(0)
  })

  it("decodes dispatch messages strictly", () => {
    expect(decodeDispatchMessage(message)).toEqual(message)
    expect(decodeDispatchMessage(null)).toBeNull()
    expect(decodeDispatchMessage({ teamId, targetId: "not-a-uuid" })).toBeNull()
    expect(decodeDispatchMessage({ teamId, targetId, publishAt: "not-a-date" })).toBeNull()
    expect(decodeDispatchMessage({ teamId, targetId, extra: "tolerated" })).toEqual({
      teamId,
      targetId,
      calendarPostId: null,
      publishAt: null,
    })
  })

  it("backs off exponentially up to the maximum", () => {
    expect(retryDelaySeconds(1, {})).toBe(60)
    expect(retryDelaySeconds(2, {})).toBe(120)
    expect(retryDelaySeconds(3, {})).toBe(240)
    expect(retryDelaySeconds(99, {})).toBe(3_600)
    expect(() => retryDelaySeconds(1, { retryBaseDelaySeconds: 1.5 })).toThrow(/retry base/)
    expect(() => retryDelaySeconds(1, { retryBaseDelaySeconds: 0 })).toThrow(/retry base/)
  })

  it("rejects invalid drain options", async () => {
    const queue = queueWith([])
    const base = {
      gate: gateWith(scheduledDue),
      publisher: publisherWith("succeeded"),
      events: eventsWith(),
    }
    const drain = (options: Parameters<typeof drainDispatchQueue>[4]) =>
      drainDispatchQueue(queue, base.gate, base.publisher, base.events, options)
    await expect(drain({ batchSize: 0, now })).rejects.toThrow(/batch size/)
    await expect(drain({
      retryBaseDelaySeconds: 7_200,
      retryMaximumDelaySeconds: 60,
      now,
    })).rejects.toThrow(/delay range/)
    await expect(drain({ deadlineTimestampMs: Number.NaN, now })).rejects.toThrow(/deadline/)
  })

  it("validates enqueue bindings, batches, and results without a database", async () => {
    const binding = Object.freeze({ provider: "instagram", queueName: "instagram_publish" })
    await expect(enqueueDueTargets("db" as never, binding, 0)).rejects.toThrow(/enqueue batch/)
    await expect(enqueueDueTargets("db" as never, binding, 501)).rejects.toThrow(/enqueue batch/)
    await expect(
      enqueueDueTargets("db" as never, { provider: "instagram", queueName: "evil;--" }, 50),
    ).rejects.toThrow(/queue name/)
    await expect(
      enqueueDueTargets("db" as never, { provider: "Insta", queueName: "instagram_publish" }, 50),
    ).rejects.toThrow(/provider name/)
    const fake = Object.assign(
      async () => [{ enqueue_due_social_targets: "3" }],
      { json: (value: unknown) => value },
    )
    await expect(enqueueDueTargets(fake as never, binding, 50)).resolves.toBe(3)
    const nan = Object.assign(
      async () => [{ enqueue_due_social_targets: "oops" }],
      { json: (value: unknown) => value },
    )
    await expect(enqueueDueTargets(nan as never, binding, 50)).rejects.toThrow(/enqueue result/)
  })
})
