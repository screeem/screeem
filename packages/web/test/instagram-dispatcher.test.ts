import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import {
  drainDispatchQueue,
  type DispatchEventWriter,
  type DispatchQueueStore,
  type DispatchTargetGate,
} from "../src/lib/integrations/social/dispatch-queue"
import {
  drainInstagramDispatchQueue,
  enqueueDueInstagramTargets,
  instagramDispatchBinding,
  instagramDispatchProviderName,
  instagramDispatchQueueName,
  unimplementedInstagramPublisher,
  validateInstagramDispatchTarget,
} from "../src/lib/integrations/social/instagram-dispatcher"

const teamId = "11111111-1111-4111-8111-111111111111"
const targetId = "22222222-2222-4222-8222-222222222222"
const message = Object.freeze({ teamId, targetId, calendarPostId: null, publishAt: null })
const now = () => new Date("2026-09-09T00:00:00.000Z")

function fakes(result: "recorded" | "conflict" | "target-missing" = "recorded") {
  const archived: number[] = []
  const queue: DispatchQueueStore = {
    read: async () => [{ msgId: 1, readCt: 1, message }],
    archive: async (msgId: number) => {
      archived.push(msgId)
      return true
    },
    reschedule: async () => true,
  }
  const gate: DispatchTargetGate = {
    loadTarget: async () => ({
      status: "scheduled",
      publishAt: "2026-09-02T08:30:00.000Z",
      contractVersion: 2,
      connectionOk: true,
    }),
  }
  const events: DispatchEventWriter = {
    recordAttemptStarted: async () => result,
    recordAttemptFailedRetryable: async () => result,
    recordAttemptFailedTerminal: async () => result,
    loadLatestPublishAttempt: async () => null,
  }
  return { queue, gate, events, archived }
}

describe("instagram dispatch binding", () => {
  it("exposes the instagram provider binding", () => {
    expect(instagramDispatchBinding).toEqual({
      provider: "instagram",
      queueName: "instagram_publish",
    })
    expect(instagramDispatchProviderName).toBe("instagram")
    expect(instagramDispatchQueueName).toBe("instagram_publish")
  })

  it("accepts template version 1 and rejects anything else", () => {
    const target = (contractVersion: number) => ({
      status: "scheduled",
      publishAt: "2026-09-02T08:30:00.000Z",
      contractVersion,
      connectionOk: true,
    })
    expect(validateInstagramDispatchTarget(message, target(1))).toEqual({ ok: true })
    expect(validateInstagramDispatchTarget(message, target(2))).toEqual({
      ok: false,
      errorCode: "dispatcher_template_unsupported",
    })
  })

  it("drains unsupported templates to a terminal event through the binding", async () => {
    const { queue, gate, events, archived } = fakes()
    let started = 0
    let failedTerminal = 0
    const counting: DispatchEventWriter = {
      ...events,
      recordAttemptStarted: async (input) => {
        started += 1
        return events.recordAttemptStarted(input)
      },
      recordAttemptFailedTerminal: async (input) => {
        failedTerminal += 1
        return events.recordAttemptFailedTerminal(input)
      },
    }

    const stats = await drainInstagramDispatchQueue(
      queue,
      gate,
      { publish: async () => { throw new Error("must not publish") } },
      counting,
      { now },
    )

    expect(stats).toMatchObject({ read: 1, terminalArchived: 1 })
    expect(started).toBe(1)
    expect(failedTerminal).toBe(1)
    expect(archived).toEqual([1])
  })

  it("refuses a caller-supplied validator instead of silently overriding it", async () => {
    const { queue, gate, events } = fakes()
    await expect(
      drainInstagramDispatchQueue(queue, gate, { publish: async () => "succeeded" }, events, {
        now,
        validateTarget: () => ({ ok: true as const }),
      }),
    ).rejects.toThrow(/fixed by the binding/)
  })

  it("validates enqueue bindings without a database", async () => {
    await expect(enqueueDueInstagramTargets("db" as never, 0)).rejects.toThrow(/enqueue batch/)
  })

  it("leaves due targets waiting when publishing is unimplemented", async () => {
    const { queue, events } = fakes()
    const readyGate: DispatchTargetGate = {
      loadTarget: async () => ({
        status: "scheduled",
        publishAt: "2026-09-02T08:30:00.000Z",
        contractVersion: 1,
        connectionOk: true,
      }),
    }
    const stats = await drainDispatchQueue(queue, readyGate, unimplementedInstagramPublisher, events, {
      now,
      validateTarget: validateInstagramDispatchTarget,
    })
    expect(stats).toMatchObject({ read: 1, retried: 1 })
  })
})
