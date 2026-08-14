import { Effect } from "effect"
import { describe, expect, it, vi } from "vitest"
import { defineSchema, field, type } from "@screeem/routing"
import { createFormRoutingRegistry } from "../src/lib/forms/routing-registry"

vi.mock("server-only", () => ({}))

describe("form routing registry", () => {
  it("builds one router with registered pure functions and actions", async () => {
    const action = vi.fn(() => Effect.succeed({ delivered: true }))
    const registry = createFormRoutingRegistry()
      .registerPureFunction({
        name: "isAdult",
        input: [type.number()] as const,
        output: type.boolean(),
        run: ([age]) => age >= 18,
      })
      .registerAction({
        name: "notify",
        input: type.object({ name: type.string() }),
        run: action,
      })
    const compiled = await registry
      .actionRouter(identifiers, "adult:0")
      .compile({
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

    await expect(compiled.run({ name: "Ada", age: 21 })).resolves.toMatchObject({
      route: "allow",
      matchedRule: "adult",
    })
    expect(action).toHaveBeenCalledWith(
      expect.objectContaining({
        input: { name: "Ada" },
        context: expect.objectContaining({
          tenantId: "team-one",
          submissionId: "submission-one",
          actionKey: "adult:0",
          idempotencyKey: "submission-one:adult:0",
        }),
      }),
    )
  })

  it("isolates failed and timed-out lifecycle handlers", async () => {
    const after = vi.fn(() => Effect.void)
    const registry = createFormRoutingRegistry({ eventTimeoutMs: 5 })
      .onBeforeEvaluation(() => Effect.fail(new Error("handler failed")))
      .onBeforeEvaluation(() => Effect.uninterruptible(Effect.never))
      .onAfterEvaluation(after)

    await expect(
      registry.emitBefore({
        tenantId: identifiers.tenantId,
        formId: identifiers.formId,
        publicationVersion: identifiers.publicationVersion,
        evaluationId: "evaluation-one",
        type: "before_evaluation",
        occurredAt: "2026-08-13T12:00:00.000Z",
      }),
    ).resolves.toBeUndefined()
    await registry.emitAfter({
      tenantId: identifiers.tenantId,
      formId: identifiers.formId,
      publicationVersion: identifiers.publicationVersion,
      evaluationId: "evaluation-one",
      type: "after_evaluation",
      occurredAt: "2026-08-13T12:00:00.010Z",
      route: "allow",
      matchedRule: "adult",
      outcome: "matched",
      durationMs: 10,
    })

    expect(after).toHaveBeenCalledOnce()
  })

  it("keeps action timeouts shorter than the execution lease", () => {
    expect(() =>
      createFormRoutingRegistry().registerAction({
        name: "slow",
        input: type.string(),
        timeoutMs: 15_001,
        run: () => Effect.succeed(undefined),
      }),
    ).toThrow(/between 1 and 15000 milliseconds/)
  })

  it("snapshots registrations and lifecycle events", async () => {
    const input = type.object({ name: type.string() })
    const definition = {
      name: "notify",
      input,
      run: () => Effect.succeed(undefined),
    }
    const observed: string[] = []
    const registry = createFormRoutingRegistry()
      .registerAction(definition)
      .onBeforeEvaluation((event) =>
        Effect.sync(() => {
          observed.push(event.evaluationId)
          try {
            ;(event as { evaluationId: string }).evaluationId = "changed"
          } catch {}
        }),
      )
      .onBeforeEvaluation((event) =>
        Effect.sync(() => {
          observed.push(event.evaluationId)
        }),
      )

    definition.name = "changed"
    definition.run = () => Effect.die("changed")

    await expect(
      registry.actionRouter(identifiers, "adult:0").compile({
        version: 1,
        schema: defineSchema({ name: field.string({ required: true }) }),
        rules: [
          {
            id: "adult",
            when: "true",
            route: "allow",
            actions: [{ use: "notify", with: "({ name: submission.name })" }],
          },
        ],
        fallback: "deny",
      }),
    ).resolves.toBeDefined()
    await registry.emitBefore({
      tenantId: identifiers.tenantId,
      formId: identifiers.formId,
      publicationVersion: identifiers.publicationVersion,
      evaluationId: "evaluation-one",
      type: "before_evaluation",
      occurredAt: "2026-08-13T12:00:00.000Z",
    })

    expect(observed).toEqual(["evaluation-one", "evaluation-one"])
  })
})

const identifiers = {
  tenantId: "team-one",
  formId: "form-one",
  publicationVersion: 2,
  submissionId: "submission-one",
}
