import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import {
  decodeDispatchMessage,
  drainInstagramDispatchQueue,
  retryDelaySeconds,
  type InstagramDispatchQueueStore,
  type InstagramDispatchTargetGate,
  type InstagramDueTargetPublisher,
  type QueuedDispatchMessage,
} from "../src/lib/integrations/social/instagram-dispatcher"

const teamId = "11111111-1111-4111-8111-111111111111"
const targetId = "22222222-2222-4222-8222-222222222222"
const message = Object.freeze({
  teamId,
  targetId,
  calendarPostId: "33333333-3333-4333-8333-333333333333",
  publishAt: "2026-09-02T08:30:00.000Z",
})

function queueWith(messages: readonly QueuedDispatchMessage[]): InstagramDispatchQueueStore & {
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
    },
    reschedule: async (msgId: number, delaySeconds: number) => {
      rescheduled.push({ msgId, delaySeconds })
    },
  }
}

function gateWith(
  state: { readonly status: string; readonly publishAt: string } | null,
): InstagramDispatchTargetGate {
  return { loadTarget: async () => state }
}

function publisherWith(
  outcome: "succeeded" | "stale" | "retryable" | "terminal" | Error,
): InstagramDueTargetPublisher & { readonly calls: number } {
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

const queued = (overrides: Partial<QueuedDispatchMessage> = {}): QueuedDispatchMessage => ({
  msgId: 1,
  readCt: 1,
  message,
  ...overrides,
})

const scheduledDue = { status: "scheduled", publishAt: "2026-09-02T08:30:00.000Z" }
const now = () => new Date("2026-09-09T00:00:00.000Z")

describe("instagram dispatcher drain", () => {
  it("archives invalid messages without publishing", async () => {
    const queue = queueWith([queued({ message: { nope: true } })])
    const publisher = publisherWith("succeeded")

    const stats = await drainInstagramDispatchQueue(queue, gateWith(scheduledDue), publisher, { now })

    expect(stats).toMatchObject({ read: 1, invalidArchived: 1, published: 0 })
    expect(queue.archived).toEqual([1])
    expect(publisher.calls).toBe(0)
  })

  it("archives messages whose target is no longer scheduled", async () => {
    for (const status of ["cancelled", "superseded"]) {
      const queue = queueWith([queued()])
      const publisher = publisherWith("succeeded")

      const stats = await drainInstagramDispatchQueue(
        queue,
        gateWith({ status, publishAt: scheduledDue.publishAt }),
        publisher,
        { now },
      )

      expect(stats).toMatchObject({ staleArchived: 1, published: 0 })
      expect(queue.archived).toEqual([1])
      expect(publisher.calls).toBe(0)
    }
  })

  it("archives messages whose target is gone", async () => {
    const queue = queueWith([queued()])
    const publisher = publisherWith("succeeded")

    const stats = await drainInstagramDispatchQueue(queue, gateWith(null), publisher, { now })

    expect(stats).toMatchObject({ staleArchived: 1 })
    expect(queue.archived).toEqual([1])
    expect(publisher.calls).toBe(0)
  })

  it("reschedules messages that are not due yet", async () => {
    const queue = queueWith([queued()])
    const publisher = publisherWith("succeeded")
    const future = new Date(now().getTime() + 10 * 60 * 1_000).toISOString()

    const stats = await drainInstagramDispatchQueue(
      queue,
      gateWith({ status: "scheduled", publishAt: future }),
      publisher,
      { now },
    )

    expect(stats).toMatchObject({ notDueRescheduled: 1, published: 0 })
    expect(queue.archived).toEqual([])
    expect(queue.rescheduled).toHaveLength(1)
    expect(queue.rescheduled[0]?.delaySeconds).toBeGreaterThanOrEqual(600)
    expect(publisher.calls).toBe(0)
  })

  it("archives on publish success", async () => {
    const queue = queueWith([queued()])
    const publisher = publisherWith("succeeded")

    const stats = await drainInstagramDispatchQueue(queue, gateWith(scheduledDue), publisher, { now })

    expect(stats).toMatchObject({ published: 1 })
    expect(queue.archived).toEqual([1])
  })

  it("requeues retryable outcomes with backoff and archives at the attempt cap", async () => {
    const first = queueWith([queued({ readCt: 1 })])
    const stats = await drainInstagramDispatchQueue(first, gateWith(scheduledDue), publisherWith("retryable"), {
      now,
      maximumAttempts: 3,
      retryBaseDelaySeconds: 60,
    })
    expect(stats).toMatchObject({ retried: 1 })
    expect(first.rescheduled).toEqual([{ msgId: 1, delaySeconds: 120 }])

    const capped = queueWith([queued({ readCt: 2 })])
    const cappedStats = await drainInstagramDispatchQueue(
      capped,
      gateWith(scheduledDue),
      publisherWith("retryable"),
      { now, maximumAttempts: 3 },
    )
    expect(cappedStats).toMatchObject({ terminalArchived: 1, retried: 0 })
    expect(capped.archived).toEqual([1])
  })

  it("converts publisher exceptions into backoff requeues", async () => {
    const queue = queueWith([queued({ readCt: 1 })])

    const stats = await drainInstagramDispatchQueue(
      queue,
      gateWith(scheduledDue),
      publisherWith(new Error("boom")),
      { now },
    )

    expect(stats).toMatchObject({ retried: 1 })
    expect(queue.archived).toEqual([])
  })

  it("decodes dispatch messages strictly", () => {
    expect(decodeDispatchMessage(message)).toEqual(message)
    expect(decodeDispatchMessage(null)).toBeNull()
    expect(decodeDispatchMessage({ teamId, targetId: "not-a-uuid" })).toBeNull()
    expect(decodeDispatchMessage({ teamId, targetId })).toEqual({
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
  })

  it("rejects invalid drain options", async () => {
    const queue = queueWith([])
    await expect(
      drainInstagramDispatchQueue(queue, gateWith(scheduledDue), publisherWith("succeeded"), {
        batchSize: 0,
        now,
      }),
    ).rejects.toThrow(/batch size/)
  })
})
