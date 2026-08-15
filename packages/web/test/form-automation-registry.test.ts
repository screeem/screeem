import { defineSchema, field, type } from "@screeem/routing"
import { Effect } from "effect"
import { describe, expect, it, vi } from "vitest"
import { snapshotFormEvent } from "../src/lib/forms/form-actions"
import { createFormAutomationRegistry } from "../src/lib/forms/form-automation-registry"
import type { IntegrationAutomationRuntime } from "../src/lib/integrations/automation-runtime"
import { snapshotIntegrationType } from "@screeem/forms"
import { snapshotIntegrationProviderName } from "../src/lib/integrations/contract"
import {
  createIntegrationProviderRegistry,
  defineIntegrationProvider,
} from "../src/lib/integrations/provider-registry"

vi.mock("server-only", () => ({}))

describe("form automation registry", () => {
  it("adapts registered actions and pure functions to routing", async () => {
    const action = vi.fn(() => Effect.succeed({ delivered: true }))
    const registry = createFormAutomationRegistry()
      .registerPureFunction({
        name: "isAdult",
        input: [type.number()] as const,
        output: type.boolean(),
        run: ([age]) => age >= 18,
      })
      .registerAction({
        name: "notify",
        events: ["routing.matched"],
        input: type.object({ name: type.string() }),
        run: action,
      })
    const compiled = await registry.actionRouter(matchedEvent, "event-one:0").compile({
      version: 1,
      schema: defineSchema({
        name: field.string({ required: true }),
        age: field.number({ required: true }),
      }),
      rules: [
        {
          id: "adult",
          when: "isAdult(submission.age)",
          route: "allow",
          actions: [{ use: "notify", with: "({ name: submission.name })" }],
        },
      ],
      fallback: "deny",
    })

    await compiled.run({ name: "Ada", age: 21 })

    expect(action).toHaveBeenCalledWith(
      expect.objectContaining({
        input: { name: "Ada" },
        context: expect.objectContaining({
          event: matchedEvent,
          deliveryKey: "event-one:0",
          idempotencyKey: "event-one:0",
        }),
      }),
    )
  })

  it("supports inline, isolated, and durable event delivery", async () => {
    const calls: string[] = []
    const registry = createFormAutomationRegistry()
      .onEvent({
        name: "validate",
        event: "routing.evaluation.before",
        delivery: "inline",
        run: () => Effect.sync(() => void calls.push("inline")),
      })
      .onEvent({
        name: "observe",
        event: "routing.evaluation.before",
        delivery: "isolated",
        run: () => Effect.sync(() => void calls.push("isolated")),
      })
      .onEvent({
        name: "archive",
        event: "routing.matched",
        delivery: "durable",
        run: () => Effect.sync(() => void calls.push("durable")),
      })

    await registry.runInline(beforeEvent)
    await registry.runIsolated(beforeEvent)
    const [planned] = registry.planDurable(matchedEvent)
    await registry.runDurableHandler(planned!)

    expect(calls).toEqual(["inline", "isolated", "durable"])
    expect(planned).toMatchObject({
      registrationName: "archive",
      deliveryKey: "event-one:0",
      sequence: 0,
    })
  })

  it("binds event handlers to the event tenant integration runtime", async () => {
    const definition = defineIntegrationProvider({
      name: snapshotIntegrationProviderName("example"),
      type: snapshotIntegrationType("example"),
      displayName: "Example",
      enabled: true,
      open: async () => "client",
    })
    const providerRegistry = createIntegrationProviderRegistry().register(definition)
    const provider = providerRegistry.reference(definition)
    const open = vi.fn(async () => "client")
    const runtime = {
      forTenant: vi.fn(() => ({ open })),
    } as unknown as IntegrationAutomationRuntime
    const registry = createFormAutomationRegistry(runtime).onEvent({
      name: "integrated-audit",
      event: "routing.matched",
      delivery: "durable",
      run: ({ context }) => Effect.promise(async () => {
        await context.integrations.open(provider)
      }),
    })
    const [planned] = registry.planDurable(matchedEvent)

    await registry.runDurableHandler(planned!)

    expect(runtime.forTenant).toHaveBeenCalledWith(matchedEvent.tenantId)
    expect(open).toHaveBeenCalledWith(provider, expect.any(AbortSignal))
  })

  it("propagates inline failure and isolates failed handlers", async () => {
    const registry = createFormAutomationRegistry()
      .onEvent({
        name: "reject",
        event: "routing.evaluation.before",
        delivery: "inline",
        run: () => Effect.fail(new Error("rejected")),
      })
      .onEvent({
        name: "timeout",
        event: "routing.evaluation.after",
        delivery: "isolated",
        timeoutMs: 5,
        run: () => Effect.uninterruptible(Effect.never),
      })

    await expect(registry.runInline(beforeEvent)).rejects.toThrow()
    await expect(registry.runIsolated(afterEvent)).resolves.toBeUndefined()
  })

  it("isolates synchronous handler failures", async () => {
    const registry = createFormAutomationRegistry().onEvent({
      name: "broken-observer",
      event: "routing.evaluation.before",
      delivery: "isolated",
      run: () => {
        throw new Error("broken")
      },
    })

    await expect(registry.runIsolated(beforeEvent)).resolves.toBeUndefined()
  })

  it("aborts the handler signal when its timeout expires", async () => {
    let signal: AbortSignal | undefined
    const registry = createFormAutomationRegistry().onEvent({
      name: "slow-observer",
      event: "routing.evaluation.before",
      delivery: "isolated",
      timeoutMs: 5,
      run: ({ context }) => {
        signal = context.signal
        return Effect.uninterruptible(Effect.never)
      },
    })

    await registry.runIsolated(beforeEvent)

    expect(signal?.aborted).toBe(true)
  })

  it("rejects excessive durable handlers during registration", () => {
    let registry = createFormAutomationRegistry()
    for (let index = 0; index < 20; index += 1) {
      registry = registry.onEvent({
        name: `archive-${index}`,
        event: "submission.accepted",
        delivery: "durable",
        run: () => Effect.void,
      })
    }

    expect(() => registry.onEvent({
      name: "archive-overflow",
      event: "submission.accepted",
      delivery: "durable",
      run: () => Effect.void,
    })).toThrow(/Too many durable handlers/)
  })

  it("rejects deeply nested submission event payloads without overflowing", () => {
    const submission: Record<string, unknown> = {}
    let current = submission
    for (let depth = 0; depth < 101; depth += 1) {
      const child: Record<string, unknown> = {}
      current.child = child
      current = child
    }

    expect(() => snapshotFormEvent({
      eventId: "submission-one:accepted",
      type: "submission.accepted",
      occurredAt: "2026-08-13T12:00:00.000Z",
      tenantId: "team-one",
      formId: "form-one",
      payload: {
        publicationVersion: 2,
        submissionId: "submission-one",
        submission,
        routing: { status: "not_configured", route: null, matchedRule: null, error: null },
      },
    })).toThrow(TypeError)
  })

  it("uses one globally unique registration namespace", () => {
    const registry = createFormAutomationRegistry().registerAction({
      name: "notify",
      events: ["routing.matched"],
      input: type.string(),
      run: () => Effect.succeed(undefined),
    })
    expect(() =>
      registry.onEvent({
        name: "notify",
        event: "routing.matched",
        delivery: "durable",
        run: () => Effect.void,
      }),
    ).toThrow(/already exists/)

    const functionFirst = createFormAutomationRegistry().registerPureFunction({
      name: "shared",
      input: [] as const,
      output: type.boolean(),
      run: () => true,
    })
    expect(() => functionFirst.onEvent({
      name: "shared",
      event: "submission.accepted",
      delivery: "durable",
      run: () => Effect.void,
    })).toThrow(/already exists/)

    const handlerFirst = createFormAutomationRegistry().onEvent({
      name: "shared",
      event: "submission.accepted",
      delivery: "durable",
      run: () => Effect.void,
    })
    expect(() => handlerFirst.registerPureFunction({
      name: "shared",
      input: [] as const,
      output: type.boolean(),
      run: () => true,
    })).toThrow(/already exists/)
  })

  it("does not allow an accepted event to veto an already stored submission", () => {
    expect(() =>
      createFormAutomationRegistry().onEvent({
        name: "late-veto",
        event: "submission.accepted",
        delivery: "inline",
        run: () => Effect.void,
      }),
    ).toThrow(/cannot use inline delivery/)
  })

})

const beforeEvent = snapshotFormEvent({
  eventId: "evaluation-one:before",
  type: "routing.evaluation.before",
  occurredAt: "2026-08-13T12:00:00.000Z",
  tenantId: "team-one",
  formId: "form-one",
  payload: {
    publicationVersion: 2,
    evaluationId: "evaluation-one",
    submissionId: "submission-one",
  },
})

const afterEvent = snapshotFormEvent({
  eventId: "evaluation-one:after",
  type: "routing.evaluation.after",
  occurredAt: "2026-08-13T12:00:00.010Z",
  tenantId: "team-one",
  formId: "form-one",
  payload: {
    publicationVersion: 2,
    evaluationId: "evaluation-one",
    submissionId: "submission-one",
    route: "allow",
    matchedRule: "adult",
    outcome: "matched",
    durationMs: 10,
  },
})

const matchedEvent = snapshotFormEvent({
  eventId: "event-one",
  type: "routing.matched",
  occurredAt: "2026-08-13T12:00:00.010Z",
  tenantId: "team-one",
  formId: "form-one",
  payload: {
    publicationVersion: 2,
    submissionId: "submission-one",
    submission: { name: "Ada", age: 21 },
    ruleId: "adult",
    route: "allow",
  },
}) as import("../src/lib/forms/form-actions").FormEvent<"routing.matched">
