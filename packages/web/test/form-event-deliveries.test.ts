import {
  matchedSubmissionRouting,
  type FormDefinition,
  type FormRoutingDefinition,
} from "@screeem/forms"
import { type, type ActionOutput } from "@screeem/routing"
import { Effect } from "effect"
import { describe, expect, it, vi } from "vitest"
import {
  drainPendingFormEventDeliveries,
  executeFormEventDeliveries,
  orderFormEventDeliveries,
  planFormRoutingDeliveries,
  type FormEventDeliveryStore,
} from "../src/lib/forms/form-event-deliveries"
import {
  snapshotFormEvent,
  type FormActionContext,
  type PendingFormEventDelivery,
} from "../src/lib/forms/form-actions"
import { createFormAutomationRegistry } from "../src/lib/forms/form-automation-registry"
import type { FormEventDeliveryStatus } from "../src/lib/forms/form-delivery-contract"

vi.mock("server-only", () => ({}))

describe("form event deliveries", () => {
  it("executes a routing action once and preserves its delivery key", async () => {
    const run = vi.fn((options: { readonly context: FormActionContext<"routing.matched"> }) =>
      Effect.succeed({ delivered: options.context.idempotencyKey.length > 0 }),
    )
    const registry = actionRegistry(run)
    const store = new MemoryDeliveryStore()

    await execute(store, registry)
    await execute(store, registry)

    expect(run).toHaveBeenCalledOnce()
    expect(run.mock.calls[0]?.[0].context.idempotencyKey).toBe(
      "submission-one:routing.matched:0",
    )
    expect(store.output).toEqual({ delivered: true })
  })

  it("preserves optional-field narrowing", async () => {
    const optionalDefinition: FormDefinition = {
      ...definition,
      fields: [{
        id: "email-field",
        name: "email",
        label: "Email",
        required: false,
        type: "string",
        control: "email",
      }],
    }
    const optionalRouting: FormRoutingDefinition = {
      version: 1,
      rules: [{
        id: "has-email",
        when: "exists(submission.email)",
        route: "sales",
        actions: [{ use: "notifyEmail", with: "({ email: submission.email })" }],
      }],
      fallback: "review",
    }
    const run = vi.fn(() => Effect.succeed(undefined))
    const registry = createFormAutomationRegistry().registerAction({
      name: "notifyEmail",
      events: ["routing.matched"],
      input: type.object({ email: type.string() }),
      run,
    })
    const result = matchedSubmissionRouting("sales", "has-email")
    const event = routingEvent({ email: "ada@example.com" }, "has-email")
    const store = new MemoryDeliveryStore()

    await executeFormEventDeliveries({
      definition: optionalDefinition,
      routing: optionalRouting,
      deliveries: stored(planFormRoutingDeliveries(optionalRouting, result, event, registry)),
      store,
      registry,
    })

    expect(run).toHaveBeenCalledOnce()
    expect(store.status).toBe("succeeded")
  })

  it("runs routing actions before durable event handlers", async () => {
    const calls: string[] = []
    const registry = createFormAutomationRegistry()
      .registerAction({
        name: "notify",
        events: ["routing.matched"],
        input: type.object({ name: type.string() }),
        run: () => Effect.sync(() => void calls.push("action")),
      })
      .onEvent({
        name: "audit",
        event: "routing.matched",
        delivery: "durable",
        run: () => Effect.sync(() => void calls.push("handler")),
      })
    const store = new MemoryDeliveryStore()

    await execute(store, registry)

    expect(calls).toEqual(["action", "handler"])
  })

  it("does not run later deliveries when an earlier delivery fails", async () => {
    const calls: string[] = []
    const registry = createFormAutomationRegistry()
      .registerAction({
        name: "notify",
        events: ["routing.matched"],
        input: type.object({ name: type.string() }),
        run: () => Effect.fail(new Error("stop")),
      })
      .onEvent({
        name: "later",
        event: "routing.matched",
        delivery: "durable",
        run: () => Effect.sync(() => void calls.push("later")),
      })

    await execute(new MemoryDeliveryStore(), registry)

    expect(calls).toEqual([])
  })

  it("fails when a persisted routing match no longer reproduces", async () => {
    const result = matchedSubmissionRouting("sales", "qualified")
    const registry = actionRegistry()
    const store = new MemoryDeliveryStore()

    await expect(executeFormEventDeliveries({
        definition,
        routing: {
          ...routing,
          rules: [{ ...routing.rules[0]!, when: "false" }],
        },
        deliveries: stored(planFormRoutingDeliveries(routing, result, event, registry)),
        store,
        registry,
      })).rejects.toThrow("Persisted routing event no longer matches")

    expect(store.status).toBe("pending")
    expect(store.error).toBe("delivery_execution_failed")
  })

  it("reaches terminal failure after three bounded timeouts", async () => {
    const registry = createFormAutomationRegistry().registerAction({
      name: "notify",
      events: ["routing.matched"],
      input: type.object({ name: type.string() }),
      timeoutMs: 5,
      run: () => Effect.never,
    })
    const store = new MemoryDeliveryStore()

    await execute(store, registry)
    await execute(store, registry)
    await execute(store, registry)

    expect(store.attempts).toBe(3)
    expect(store.status).toBe("failed")
  })

  it("rejects a recovery row that differs from its publication", async () => {
    const store = recoveryStore([
      { ...pendingDelivery, registrationName: "different" },
    ])

    await expect(
      drainPendingFormEventDeliveries(store, 25, actionRegistry()),
    ).rejects.toThrow("Could not process every pending form event delivery")
  })

  it("rejects a persisted route that differs from its publication", async () => {
    const wrongEvent = snapshotFormEvent({
      ...event,
      payload: { ...event.payload, route: "different" },
    }) as import("../src/lib/forms/form-actions").FormEvent<"routing.matched">
    const delivery = { ...pendingDelivery, event: wrongEvent }
    const store = recoveryStore([delivery])

    await expect(
      drainPendingFormEventDeliveries(store, 25, actionRegistry()),
    ).rejects.toThrow("Could not process every pending form event delivery")
    expect(store.fail).toHaveBeenCalledWith(delivery, 1, "delivery_execution_failed")
  })

  it("resumes a valid pending delivery", async () => {
    const run = vi.fn(() => Effect.succeed(undefined))
    const store = recoveryStore([pendingDelivery])

    await expect(
      drainPendingFormEventDeliveries(store, 25, actionRegistry(run)),
    ).resolves.toBe(1)

    expect(run).toHaveBeenCalledOnce()
    expect(store.succeed).toHaveBeenCalledWith(pendingDelivery, 1, undefined)
  })

  it("processes one submission stream in lifecycle order", async () => {
    const first = {
      ...pendingDelivery,
      kind: "event_handler" as const,
      event: submissionEvent("submission.before_save"),
      registrationName: "before-save",
      deliveryKey: "submission-one:submission.before_save:0",
      streamSequence: 0,
    }
    const second = {
      ...pendingDelivery,
      kind: "event_handler" as const,
      event: submissionEvent("submission.accepted"),
      registrationName: "accepted",
      deliveryKey: "submission-one:submission.accepted:0",
      streamSequence: 1,
    }
    const calls: string[] = []
    let registry = createFormAutomationRegistry()
    for (const [name, event] of [
      ["before-save", "submission.before_save"],
      ["accepted", "submission.accepted"],
    ] as const) {
      registry = registry.onEvent({
        name,
        event,
        delivery: "durable",
        run: () => Effect.sync(() => void calls.push(name)),
      })
    }

    await drainPendingFormEventDeliveries(recoveryStore([second, first]), 25, registry)

    expect(calls).toEqual(["before-save", "accepted"])
  })

  it("claims an unavailable durable handler so it can reach terminal failure", async () => {
    const delivery = {
      ...pendingDelivery,
      kind: "event_handler" as const,
      event: submissionEvent("submission.accepted"),
      registrationName: "removed-handler",
      deliveryKey: "submission-one:submission.accepted:0",
    }
    const store = recoveryStore([delivery])

    await expect(
      drainPendingFormEventDeliveries(store, 25, createFormAutomationRegistry()),
    ).resolves.toBe(1)
    expect(store.fail).toHaveBeenCalledWith(delivery, 1, "delivery_execution_failed")
  })

  it("does not start recovery after its deadline", async () => {
    const store = recoveryStore([pendingDelivery])

    await expect(
      drainPendingFormEventDeliveries(store, 25, actionRegistry(), Date.now() - 1),
    ).resolves.toBe(0)
    expect(store.loadPublication).not.toHaveBeenCalled()
  })

  it("does not load a publication after another worker wins the claim", async () => {
    const store = recoveryStore([pendingDelivery])
    store.claim.mockResolvedValueOnce(null)

    await expect(
      drainPendingFormEventDeliveries(store, 25, actionRegistry()),
    ).resolves.toBe(0)
    expect(store.loadPublication).not.toHaveBeenCalled()
  })

  it.each(["claim", "succeed", "fail"] as const)(
    "reports a %s persistence failure",
    async (transition) => {
      const store = recoveryStore([pendingDelivery])
      store[transition].mockRejectedValueOnce(new Error("database unavailable"))
      const registry = actionRegistry(
        transition === "fail"
          ? () => Effect.fail(new Error("action failed"))
          : () => Effect.succeed(undefined),
      )

      await expect(
        drainPendingFormEventDeliveries(store, 25, registry),
      ).rejects.toThrow("Could not process every pending form event delivery")
    },
  )

  it("waits for started independent streams before reporting another failure", async () => {
    let release!: () => void
    const deferred = new Promise<void>((resolve) => {
      release = resolve
    })
    const run = vi.fn(() => Effect.promise(() => deferred.then(() => undefined)))
    const registry = actionRegistry(run)
    const valid = pendingFor("submission-two")
    const store = recoveryStore([
      { ...pendingDelivery, registrationName: "different" },
      valid,
    ])
    let settled = false
    const drained = drainPendingFormEventDeliveries(store, 25, registry).finally(() => {
      settled = true
    })

    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce())
    expect(settled).toBe(false)
    release()

    await expect(drained).rejects.toThrow("Could not process every pending form event delivery")
    expect(store.succeed).toHaveBeenCalledWith(valid, 1, undefined)
  })
})

function actionRegistry(
  run: (options: {
    readonly input: { readonly name: string }
    readonly context: FormActionContext<"routing.matched">
  }) => Effect.Effect<ActionOutput, unknown, never> = () => Effect.succeed(undefined),
) {
  return createFormAutomationRegistry().registerAction({
    name: "notify",
    events: ["routing.matched"],
    input: type.object({ name: type.string() }),
    run,
  })
}

async function execute(store: FormEventDeliveryStore, registry: ReturnType<typeof actionRegistry>) {
  const result = matchedSubmissionRouting("sales", "qualified")
  return executeFormEventDeliveries({
    definition,
    routing,
    deliveries: stored(planFormRoutingDeliveries(routing, result, event, registry)),
    store,
    registry,
  })
}

class MemoryDeliveryStore implements FormEventDeliveryStore {
  status: FormEventDeliveryStatus = "pending"
  attempts = 0
  output: unknown
  error: string | null = null
  private readonly completed = new Set<string>()

  async claim(delivery: { readonly deliveryKey: string }) {
    if (this.completed.has(delivery.deliveryKey) || this.status === "failed" || this.attempts >= 3) {
      return null
    }
    this.status = "running"
    this.attempts += 1
    return { attempt: this.attempts }
  }

  async succeed(delivery: { readonly deliveryKey: string }, _attempt: number, output: unknown) {
    this.completed.add(delivery.deliveryKey)
    this.status = "succeeded"
    this.output = output
  }

  async fail(_delivery?: unknown, _attempt?: number, error?: string) {
    this.error = error ?? null
    this.status = this.attempts >= 3 ? "failed" : "pending"
  }
}

const definition: FormDefinition = {
  formatVersion: 1,
  title: "Qualification",
  submitLabel: "Submit",
  successMessage: "Thanks",
  fields: [{
    id: "name-field",
    name: "name",
    label: "Name",
    required: true,
    type: "string",
    control: "text",
  }],
}

const routing: FormRoutingDefinition = {
  version: 1,
  rules: [{
    id: "qualified",
    when: "true",
    route: "sales",
    actions: [{ use: "notify", with: "({ name: submission.name })" }],
  }],
  fallback: "review",
}

function routingEvent(
  submission: Readonly<Record<string, string | number | boolean>> = { name: "Ada" },
  ruleId = "qualified",
) {
  return snapshotFormEvent({
    eventId: "submission-one:routing.matched",
    type: "routing.matched",
    occurredAt: "2026-08-14T09:00:00.000Z",
    tenantId: "team-one",
    formId: "form-one",
    payload: {
      publicationVersion: 1,
      submissionId: "submission-one",
      submission,
      ruleId,
      route: "sales",
    },
  }) as import("../src/lib/forms/form-actions").FormEvent<"routing.matched">
}

function submissionEvent(type: "submission.before_save" | "submission.accepted") {
  return snapshotFormEvent({
    eventId: `submission-one:${type}`,
    type,
    occurredAt: "2026-08-14T09:00:00.000Z",
    tenantId: "team-one",
    formId: "form-one",
    payload: {
      publicationVersion: 1,
      submissionId: "submission-one",
      submission: { name: "Ada" },
      routing: matchedSubmissionRouting("sales", "qualified"),
    },
  })
}

const event = routingEvent()
const pendingDelivery: PendingFormEventDelivery = {
  tenantId: "team-one",
  formId: "form-one",
  submissionId: "submission-one",
  publicationVersion: 1,
  event,
  kind: "routing_action",
  registrationName: "notify",
  deliveryKey: "submission-one:routing.matched:0",
  sequence: 0,
  streamSequence: 0,
}

function stored(deliveries: Parameters<typeof orderFormEventDeliveries>[0]) {
  return orderFormEventDeliveries(deliveries, {
    tenantId: "team-one",
    formId: "form-one",
    submissionId: "submission-one",
    publicationVersion: 1,
  })
}

function pendingFor(submissionId: string): PendingFormEventDelivery {
  const nextEvent = snapshotFormEvent({
    ...event,
    eventId: `${submissionId}:routing.matched`,
    payload: { ...event.payload, submissionId },
  }) as import("../src/lib/forms/form-actions").FormEvent<"routing.matched">
  return {
    ...pendingDelivery,
    submissionId,
    event: nextEvent,
    deliveryKey: `${nextEvent.eventId}:0`,
  }
}

function recoveryStore(rows: readonly PendingFormEventDelivery[]) {
  return {
    listPending: vi.fn().mockResolvedValue({ deliveries: rows, invalidCount: 0 }),
    loadPublication: vi.fn().mockResolvedValue({ definition, routing }),
    claim: vi.fn().mockResolvedValue({ attempt: 1 }),
    succeed: vi.fn().mockResolvedValue(undefined),
    fail: vi.fn().mockResolvedValue(undefined),
  }
}
