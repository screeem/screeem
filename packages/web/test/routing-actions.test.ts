import {
  compileFormRoutingDefinition,
  matchedSubmissionRouting,
  type FormDefinition,
  type FormRoutingDefinition,
} from "@screeem/forms"
import { type } from "@screeem/routing"
import { Effect } from "effect"
import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
import {
  executeFormRoutingActions,
  drainPendingFormRoutingActions,
  planFormRoutingActions,
  type FormRoutingActionExecutionStore,
  type PlannedFormRoutingAction,
} from "../src/lib/forms/routing-actions"
import {
  createFormRoutingRegistry,
  type FormRoutingActionContext,
  type FormRoutingIdentifiers,
} from "../src/lib/forms/routing-registry"
import type { FormRoutingActionExecutionStatus } from "../src/lib/forms/submission-contract"

describe("form routing actions", () => {
  it("executes a persisted action once across duplicate delivery", async () => {
    const run = vi.fn(
      (options: { readonly input: { readonly name: string }; readonly context: FormRoutingActionContext }) =>
        Effect.succeed({ delivered: options.input.name === "Ada" }),
    )
    const registry = createFormRoutingRegistry().registerAction({
      name: "notify",
      input: type.object({ name: type.string() }),
      run,
    })
    const store = new MemoryActionExecutionStore()

    await execute(store, registry)
    await execute(store, registry)

    expect(run).toHaveBeenCalledOnce()
    expect(store.status).toBe("succeeded")
    expect(store.output).toEqual({ delivered: true })
    expect(run.mock.calls[0]?.[0].context.idempotencyKey).toBe(
      "submission-one:qualified:0",
    )
  })

  it("retries failures and records success on the third attempt", async () => {
    let calls = 0
    const registry = createFormRoutingRegistry().registerAction({
      name: "notify",
      input: type.object({ name: type.string() }),
      run: () => {
        calls += 1
        return calls < 3 ? Effect.fail(new Error("temporary")) : Effect.succeed(undefined)
      },
    })
    const store = new MemoryActionExecutionStore()

    await execute(store, registry)
    await execute(store, registry)
    await execute(store, registry)

    expect(calls).toBe(3)
    expect(store.attempts).toBe(3)
    expect(store.status).toBe("succeeded")
  })

  it("preserves optional-field narrowing when it executes a matched action", async () => {
    const narrowedDefinition: FormDefinition = {
      ...definition,
      fields: [
        {
          id: "email-field",
          name: "email",
          label: "Email",
          required: false,
          type: "string",
          control: "email",
        },
      ],
    }
    const narrowedRouting: FormRoutingDefinition = {
      version: 1,
      rules: [
        {
          id: "has-email",
          when: "exists(submission.email)",
          route: "sales",
          actions: [{ use: "notify", with: "({ email: submission.email })" }],
        },
      ],
      fallback: "review",
    }
    const run = vi.fn(() => Effect.succeed(undefined))
    const registry = createFormRoutingRegistry().registerAction({
      name: "notify",
      input: type.object({ email: type.string() }),
      run,
    })
    const store = new MemoryActionExecutionStore()
    const result = matchedSubmissionRouting("sales", "has-email")

    await executeFormRoutingActions({
      identifiers,
      definition: narrowedDefinition,
      routing: narrowedRouting,
      result,
      submission: { email: "ada@example.com" },
      actions: planFormRoutingActions(narrowedRouting, result),
      store,
      registry,
    })

    expect(run).toHaveBeenCalledOnce()
    expect(store.status).toBe("succeeded")
  })

  it("does not run a later action after an earlier action fails", async () => {
    const inputs: string[] = []
    const orderedRouting: FormRoutingDefinition = {
      version: 1,
      rules: [
        {
          id: "qualified",
          when: "true",
          route: "sales",
          actions: [
            { use: "record", with: '"first"' },
            { use: "record", with: '"second"' },
          ],
        },
      ],
      fallback: "review",
    }
    const registry = createFormRoutingRegistry().registerAction({
      name: "record",
      input: type.string(),
      run: ({ input }) => {
        inputs.push(input)
        return input === "first" ? Effect.fail(new Error("stop")) : Effect.succeed(undefined)
      },
    })
    const store = new MemoryActionExecutionStore()
    const result = matchedSubmissionRouting("sales", "qualified")

    await executeFormRoutingActions({
      identifiers,
      definition,
      routing: orderedRouting,
      result,
      submission: { name: "Ada" },
      actions: planFormRoutingActions(orderedRouting, result),
      store,
      registry,
    })

    expect(inputs).toEqual(["first"])
  })

  it("fails instead of succeeding when the persisted match no longer reproduces", async () => {
    const store = new MemoryActionExecutionStore()

    await executeFormRoutingActions({
      identifiers,
      definition,
      routing: {
        ...routing,
        rules: [{ ...routing.rules[0]!, when: "false" }],
      },
      result: matchedSubmissionRouting("sales", "qualified"),
      submission: { name: "Ada" },
      actions: planFormRoutingActions(routing, matchedSubmissionRouting("sales", "qualified")),
      store,
      registry: createFormRoutingRegistry().registerAction({
        name: "notify",
        input: type.object({ name: type.string() }),
        run: () => Effect.succeed(undefined),
      }),
    })

    expect(store.status).toBe("pending")
    expect(store.error).toBe("action_execution_failed")
  })

  it("records a terminal failure after bounded action timeouts", async () => {
    const registry = createFormRoutingRegistry().registerAction({
      name: "notify",
      input: type.object({ name: type.string() }),
      timeoutMs: 5,
      run: () => Effect.never,
    })
    const store = new MemoryActionExecutionStore()

    await expect(execute(store, registry)).resolves.toBeUndefined()
    await execute(store, registry)
    await execute(store, registry)

    expect(store.attempts).toBe(3)
    expect(store.status).toBe("failed")
    expect(store.error).toBe("action_execution_failed")
  })

  it("rejects unknown functions and actions during publication", async () => {
    await expect(
      compileFormRoutingDefinition(definition, routing, createFormRoutingRegistry().compilationRouter()),
    ).rejects.toMatchObject({
      code: "invalid_form_routing",
      issues: [expect.objectContaining({ code: "UnknownAction" })],
    })

    await expect(
      compileFormRoutingDefinition(
        definition,
        {
          version: 1,
          rules: [{ id: "custom", when: "isQualified(submission.name)", route: "sales" }],
          fallback: "review",
        },
        createFormRoutingRegistry().compilationRouter(),
      ),
    ).rejects.toMatchObject({
      code: "invalid_form_routing",
      issues: [expect.objectContaining({ code: "UnknownFunction" })],
    })
  })

  it("resumes a durable pending action with its original tenant context", async () => {
    const run = vi.fn(() => Effect.succeed(undefined))
    const registry = createFormRoutingRegistry().registerAction({
      name: "notify",
      input: type.object({ name: type.string() }),
      run,
    })
    const store = recoveryStore([pendingRow])

    await expect(
      drainPendingFormRoutingActions(store, 25, registry),
    ).resolves.toBe(1)

    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({
          tenantId: "team-one",
          formId: "form-one",
          submissionId: "submission-one",
        }),
      }),
    )
    expect(store.succeed).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "team-one" }),
      pendingRow.action,
      1,
      undefined,
    )
  })

  it("runs independent recovery rows concurrently with a fixed bound", async () => {
    let active = 0
    let maximumActive = 0
    let slowFinished = false
    let fastStartedBeforeSlowFinished = false
    const registry = createFormRoutingRegistry().registerAction({
      name: "notify",
      input: type.object({ name: type.string() }),
      run: ({ input }) =>
        Effect.promise(async () => {
          active += 1
          maximumActive = Math.max(maximumActive, active)
          if (input.name === "Slow") {
            await new Promise((resolve) => setTimeout(resolve, 30))
            slowFinished = true
          } else {
            fastStartedBeforeSlowFinished ||= !slowFinished
            await new Promise((resolve) => setTimeout(resolve, 5))
          }
          active -= 1
          return undefined
        }),
    })
    const rows = Array.from({ length: 8 }, (_, index) => ({
      ...pendingRow,
      submissionId: `submission-${index}`,
      submission: { name: index === 0 ? "Slow" : `Fast ${index}` },
    }))
    const store = recoveryStore(rows)

    await expect(
      drainPendingFormRoutingActions(store, 25, registry),
    ).resolves.toBe(8)

    expect(fastStartedBeforeSlowFinished).toBe(true)
    expect(maximumActive).toBe(4)
  })

  it("does not start recovery work after its start deadline", async () => {
    const store = recoveryStore([pendingRow])

    await expect(
      drainPendingFormRoutingActions(store, 25, createFormRoutingRegistry(), Date.now() - 1),
    ).resolves.toBe(0)

    expect(store.loadPublication).not.toHaveBeenCalled()
    expect(store.listPending).toHaveBeenCalledOnce()
  })

  it("reports malformed recovery rows instead of returning false success", async () => {
    const store = recoveryStore([])
    store.listPending.mockRejectedValueOnce(new Error("Invalid pending routing action"))

    await expect(
      drainPendingFormRoutingActions(store, 25, createFormRoutingRegistry()),
    ).rejects.toThrow("Invalid pending routing action")
  })

  it("reports a claim persistence failure instead of counting the action as processed", async () => {
    const store = recoveryStore([pendingRow])
    store.claim.mockRejectedValueOnce(new Error("database unavailable"))

    await expect(
      drainPendingFormRoutingActions(store, 25, createFormRoutingRegistry()),
    ).rejects.toThrow("Could not process every pending routing action")
  })

  it.each(["succeed", "fail"] as const)(
    "reports a %s persistence failure after action execution",
    async (transition) => {
      const store = recoveryStore([pendingRow])
      store[transition].mockRejectedValueOnce(new Error("database unavailable"))
      const registry = createFormRoutingRegistry().registerAction({
        name: "notify",
        input: type.object({ name: type.string() }),
        run: () =>
          transition === "succeed"
            ? Effect.succeed(undefined)
            : Effect.fail(new Error("action failed")),
      })

      await expect(
        drainPendingFormRoutingActions(store, 25, registry),
      ).rejects.toThrow("Could not process every pending routing action")
    },
  )

  it("reports a durable action that does not match its publication", async () => {
    const store = recoveryStore([
      { ...pendingRow, action: { ...pendingRow.action, name: "different" } },
    ])

    await expect(
      drainPendingFormRoutingActions(store, 25, createFormRoutingRegistry()),
    ).rejects.toThrow("Could not process every pending routing action")
  })

  it("waits for valid recovery work before reporting an independent mismatch", async () => {
    let release!: () => void
    const deferred = new Promise<void>((resolve) => {
      release = resolve
    })
    const run = vi.fn(() => Effect.promise(() => deferred.then(() => undefined)))
    const registry = createFormRoutingRegistry().registerAction({
      name: "notify",
      input: type.object({ name: type.string() }),
      run,
    })
    const store = recoveryStore([
      { ...pendingRow, action: { ...pendingRow.action, name: "different" } },
      { ...pendingRow, submissionId: "submission-two" },
      { ...pendingRow, submissionId: "submission-three" },
    ])
    let settled = false
    const drained = drainPendingFormRoutingActions(store, 25, registry).finally(() => {
      settled = true
    })

    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2))
    expect(settled).toBe(false)
    release()

    await expect(drained).rejects.toThrow("Could not process every pending routing action")
    expect(run).toHaveBeenCalledTimes(2)
  })
})

async function execute(
  store: FormRoutingActionExecutionStore,
  registry: ReturnType<typeof createFormRoutingRegistry>,
) {
  const result = matchedSubmissionRouting("sales", "qualified")
  return executeFormRoutingActions({
    identifiers,
    definition,
    routing,
    result,
    submission: { name: "Ada" },
    actions: planFormRoutingActions(routing, result),
    store,
    registry,
  })
}

class MemoryActionExecutionStore implements FormRoutingActionExecutionStore {
  status: FormRoutingActionExecutionStatus = "pending"
  attempts = 0
  output: unknown
  error: string | null = null

  async claim() {
    if (this.status === "succeeded" || this.status === "failed" || this.attempts >= 3) return null
    this.status = "running"
    this.attempts += 1
    return { attempt: this.attempts }
  }

  async succeed(
    _identifiers: FormRoutingIdentifiers,
    _action: PlannedFormRoutingAction,
    _attempt: number,
    output: unknown,
  ) {
    this.status = "succeeded"
    this.output = output
  }

  async fail(
    _identifiers: FormRoutingIdentifiers,
    _action: PlannedFormRoutingAction,
    _attempt: number,
    errorCode: string,
  ) {
    this.error = errorCode
    this.status = this.attempts >= 3 ? "failed" : "pending"
  }
}

const identifiers = {
  tenantId: "team-one",
  formId: "form-one",
  publicationVersion: 1,
  submissionId: "submission-one",
}

const definition: FormDefinition = {
  formatVersion: 1,
  title: "Qualification",
  submitLabel: "Submit",
  successMessage: "Thanks",
  fields: [
    {
      id: "name-field",
      name: "name",
      label: "Name",
      required: true,
      type: "string",
      control: "text",
    },
  ],
}

const routing: FormRoutingDefinition = {
  version: 1,
  rules: [
    {
      id: "qualified",
      when: "true",
      route: "sales",
      actions: [{ use: "notify", with: "({ name: submission.name })" }],
    },
  ],
  fallback: "review",
}

const pendingRow = {
  tenantId: "team-one",
  formId: "form-one",
  submissionId: "submission-one",
  publicationVersion: 1,
  action: { key: "qualified:0", name: "notify", index: 0, ruleId: "qualified" },
  submission: { name: "Ada" },
  routing: {
    status: "matched" as const,
    route: "sales",
    matchedRule: "qualified",
    error: null,
  },
}

function recoveryStore(rows: readonly (typeof pendingRow)[]) {
  return {
    listPending: vi.fn().mockResolvedValue(rows),
    loadPublication: vi.fn().mockResolvedValue({ definition, routing }),
    claim: vi.fn().mockResolvedValue({ attempt: 1 }),
    succeed: vi.fn().mockResolvedValue(undefined),
    fail: vi.fn().mockResolvedValue(undefined),
  }
}
