import { Effect, Either, Fiber } from "effect"
import { describe, expect, it, vi } from "vitest"
import { ActionExecutionError, createRouter, defineSchema, field, type } from "../src/index.js"

const schema = defineSchema({
  email: field.string({ required: true }),
  employees: field.number({ required: true }),
  country: field.enum(["UK", "US"] as const, { required: true }),
})

describe("routing engine", () => {
  it("routes plain submissions against a form schema and condition", async () => {
    const formSchema = defineSchema({
      name: field.string({ required: true }),
      age: field.number({ required: true }),
    })
    const compiled = await createRouter().compile({
      version: 1,
      schema: formSchema,
      rules: [{ id: "adult", when: `submission.age >= 18`, route: "allowed" }],
      fallback: "denied",
    })

    await expect(compiled.run({ name: "Ada", age: 18 })).resolves.toEqual({
      route: "allowed",
      matchedRule: "adult",
      actions: [],
    })
    await expect(compiled.run({ name: "Lin", age: 17 })).resolves.toEqual({
      route: "denied",
      matchedRule: null,
      actions: [],
    })
  })

  it("runs a business-authored rule and host Effect action as one program", async () => {
    const qualified: string[] = []
    const formSchema = defineSchema({
      name: field.string({ required: true }),
      employees: field.number({ required: true }),
      country: field.enum(["UK", "US"] as const, { required: true }),
    })
    const router = createRouter().registerAction({
      name: "qualifyLead",
      input: type.object({ name: type.string() }),
      run: ({ input }) =>
        Effect.sync(() => {
          qualified.push(input.name)
          return { accepted: true }
        }),
    })
    const compiled = await router.compile({
      version: 1,
      schema: formSchema,
      rules: [
        {
          id: "uk-enterprise",
          when: `submission.employees >= 500 && submission.country === "UK"`,
          actions: [{ use: "qualifyLead", with: `({ name: submission.name })` }],
          route: "sales",
        },
      ],
      fallback: "self-serve",
    })

    const program = compiled.runEffect({ name: "Ada", employees: 750, country: "UK" })

    expect(qualified).toEqual([])

    const result = await Effect.runPromise(program)

    expect(result).toEqual({
      route: "sales",
      matchedRule: "uk-enterprise",
      actions: [{ action: "qualifyLead", status: "success", output: { accepted: true } }],
    })
    expect(qualified).toEqual(["Ada"])
  })

  it("exposes sanitized action failures through the typed Effect error channel", async () => {
    const router = createRouter().registerAction({
      name: "qualifyLead",
      input: type.object({}),
      run: () => Effect.fail(new Error("CRM_API_KEY=secret")),
    })
    const compiled = await router.compile({
      version: 1,
      schema,
      rules: [
        {
          id: "qualify",
          when: `true`,
          actions: [{ use: "qualifyLead" }],
          route: "sales",
        },
      ],
      fallback: "self-serve",
    })

    const outcome = await Effect.runPromise(
      Effect.either(compiled.runEffect({ email: "a@b.test", employees: 500, country: "UK" })),
    )

    expect(Either.isLeft(outcome)).toBe(true)

    if (Either.isLeft(outcome)) {
      expect(outcome.left).toBeInstanceOf(ActionExecutionError)
      expect(outcome.left._tag).toBe("ActionExecutionError")
      expect(String(outcome.left)).not.toContain("CRM_API_KEY")
    }
  })

  it("turns a forged non-Effect action result into a typed action failure", async () => {
    const router = createRouter().registerAction({
      name: "brokenHostAction",
      input: type.object({}),
      run: (() => undefined) as never,
    })
    const compiled = await router.compile({
      version: 1,
      schema,
      rules: [
        {
          id: "broken",
          when: `true`,
          actions: [{ use: "brokenHostAction" }],
          route: "sales",
        },
      ],
      fallback: "fallback",
    })
    const outcome = await Effect.runPromise(
      Effect.either(compiled.runEffect({ email: "a@b.test", employees: 500, country: "UK" })),
    )

    expect(Either.isLeft(outcome)).toBe(true)

    if (Either.isLeft(outcome)) {
      expect(outcome.left).toBeInstanceOf(ActionExecutionError)
    }
  })

  it("returns the route from the first matching rule", async () => {
    const compiled = await createRouter().compile({
      version: 1,
      schema,
      rules: [
        { id: "first", when: `submission.employees >= 100`, route: "enterprise" },
        { id: "later", when: `submission.employees >= 1`, route: "other" },
      ],
      fallback: "fallback",
    })
    await expect(
      compiled.run({ email: "a@b.test", employees: 500, country: "UK" }),
    ).resolves.toMatchObject({
      route: "enterprise",
      matchedRule: "first",
    })
  })

  it("returns fallback when nothing matches", async () => {
    const compiled = await createRouter().compile({
      version: 1,
      schema,
      rules: [{ id: "large", when: `submission.employees > 100`, route: "large" }],
      fallback: "fallback",
    })
    await expect(compiled.run({ email: "a@b.test", employees: 2, country: "US" })).resolves.toEqual(
      {
        route: "fallback",
        matchedRule: null,
        actions: [],
      },
    )
  })

  it("distinguishes absent, empty, and present optional field values", async () => {
    const optionalSchema = defineSchema({ note: field.string({ required: false }) })
    const compiled = await createRouter().compile({
      version: 1,
      schema: optionalSchema,
      rules: [
        {
          id: "priority",
          when: `exists(submission.note) && submission.note === "priority"`,
          route: "priority",
        },
        { id: "empty", when: `isEmpty(submission.note)`, route: "empty" },
      ],
      fallback: "other",
    })

    await expect(compiled.run({})).resolves.toMatchObject({ route: "empty" })
    await expect(compiled.run({ note: "" })).resolves.toMatchObject({ route: "empty" })
    await expect(compiled.run({ note: "priority" })).resolves.toMatchObject({ route: "priority" })
    await expect(compiled.run({ note: "ordinary" })).resolves.toMatchObject({ route: "other" })
  })

  it("carries optional-field proofs from a matched condition into its actions", async () => {
    const capture = vi.fn(() => Effect.succeed(undefined))
    const optionalSchema = defineSchema({ phone: field.string({ required: false }) })
    const router = createRouter().registerAction({
      name: "capturePhone",
      input: type.object({ phone: type.string() }),
      run: capture,
    })
    const compiled = await router.compile({
      version: 1,
      schema: optionalSchema,
      rules: [
        {
          id: "has-phone",
          when: `exists(submission.phone)`,
          actions: [{ use: "capturePhone", with: `({ phone: submission.phone })` }],
          route: "contactable",
        },
      ],
      fallback: "missing-phone",
    })

    await expect(compiled.run({ phone: "+44 20 0000 0000" })).resolves.toMatchObject({
      route: "contactable",
    })
    await expect(compiled.run({})).resolves.toMatchObject({ route: "missing-phone" })
    expect(capture).toHaveBeenCalledTimes(1)
    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({ input: { phone: "+44 20 0000 0000" } }),
    )
  })

  it("evaluates finite negative numeric literals", async () => {
    const compiled = await createRouter().compile({
      version: 1,
      schema,
      rules: [{ id: "above-floor", when: `submission.employees >= -10`, route: "accepted" }],
      fallback: "below-floor",
    })

    await expect(
      compiled.run({ email: "a@b.test", employees: -5, country: "UK" }),
    ).resolves.toMatchObject({ route: "accepted" })
    await expect(
      compiled.run({ email: "a@b.test", employees: -11, country: "UK" }),
    ).resolves.toMatchObject({ route: "below-floor" })
  })

  it("executes matched actions in declared order with typed arguments", async () => {
    const calls: string[] = []
    const action = (name: string) => ({
      name,
      input: type.object({ to: type.string(), priority: type.string() }),
      run: ({ input }: { input: { readonly to: string; readonly priority: string } }) =>
        Effect.sync(() => {
          calls.push(name)
          return { accepted: input }
        }),
    })
    const router = createRouter().registerAction(action("email")).registerAction(action("audit"))
    const compiled = await router.compile({
      version: 1,
      schema,
      rules: [
        {
          id: "enterprise",
          when: `submission.employees >= 500`,
          route: "demo",
          actions: [
            {
              use: "email",
              with: `({ to: submission.email, priority: submission.employees >= 1000 ? "high" : "normal" })`,
            },
            { use: "audit", with: `({ to: submission.email, priority: "normal" })` },
          ],
        },
      ],
      fallback: "fallback",
    })
    const result = await compiled.run({ email: "jim@example.com", employees: 750, country: "UK" })

    expect(calls).toEqual(["email", "audit"])
    expect(result.actions).toEqual([
      {
        action: "email",
        status: "success",
        output: { accepted: { to: "jim@example.com", priority: "normal" } },
      },
      {
        action: "audit",
        status: "success",
        output: { accepted: { to: "jim@example.com", priority: "normal" } },
      },
    ])
  })

  it("does not execute actions for unmatched rules", async () => {
    const run = vi.fn(() => Effect.succeed(undefined))
    const router = createRouter().registerAction({
      name: "email",
      input: type.object({ to: type.string() }),
      run,
    })
    const compiled = await router.compile({
      version: 1,
      schema,
      rules: [
        {
          id: "no",
          when: `submission.employees > 500`,
          actions: [{ use: "email", with: `({ to: submission.email })` }],
          route: "x",
        },
      ],
      fallback: "fallback",
    })
    await compiled.run({ email: "a@b.test", employees: 1, country: "UK" })
    expect(run).not.toHaveBeenCalled()
  })

  it("fails closed and stops later actions", async () => {
    const later = vi.fn(() => Effect.succeed(undefined))
    const router = createRouter()
      .registerAction({
        name: "fail",
        input: type.object({}),
        run: () => Effect.fail(new Error("secret provider failure")),
      })
      .registerAction({ name: "later", input: type.object({}), run: later })
    const compiled = await router.compile({
      version: 1,
      schema,
      rules: [
        { id: "rule", when: `true`, actions: [{ use: "fail" }, { use: "later" }], route: "x" },
      ],
      fallback: "fallback",
    })
    await expect(
      compiled.run({ email: "a@b.test", employees: 1, country: "UK" }),
    ).rejects.toMatchObject({
      code: "ActionExecutionError",
      ruleId: "rule",
      actionName: "fail",
    })
    expect(later).not.toHaveBeenCalled()
  })

  it("reuses one compiled definition safely", async () => {
    const compiled = await createRouter().compile({
      version: 1,
      schema,
      rules: [{ id: "uk", when: `submission.country === "UK"`, route: "uk" }],
      fallback: "other",
    })
    const [uk, us] = await Promise.all([
      compiled.run({ email: "a@b.test", employees: 1, country: "UK" }),
      compiled.run({ email: "c@d.test", employees: 2, country: "US" }),
    ])
    expect([uk.route, us.route]).toEqual(["uk", "other"])
  })

  it("snapshots fallback routing independently of definition mutation", async () => {
    const definition = { version: 1 as const, schema, rules: [], fallback: "original" }
    const compiled = await createRouter().compile(definition)
    definition.fallback = "mutated"
    await expect(compiled.run({ email: "a", employees: 1, country: "UK" })).resolves.toMatchObject({
      route: "original",
    })
  })

  it("rejects unknown actions at compile time", async () => {
    await expect(
      createRouter().compile({
        version: 1,
        schema,
        rules: [{ id: "x", when: `true`, actions: [{ use: "missing" }], route: "x" }],
        fallback: "fallback",
      }),
    ).rejects.toMatchObject({ code: "UnknownAction" })
  })

  it("rejects action arguments that do not match the registered input", async () => {
    const router = createRouter().registerAction({
      name: "email",
      input: type.object({ to: type.string() }),
      run: () => Effect.succeed(undefined),
    })
    await expect(
      router.compile({
        version: 1,
        schema,
        rules: [
          {
            id: "x",
            when: `true`,
            actions: [{ use: "email", with: `({ wrong: submission.email })` }],
            route: "x",
          },
        ],
        fallback: "fallback",
      }),
    ).rejects.toMatchObject({ code: "InvalidActionArguments" })
  })

  it("surfaces action failures without leaking their message", async () => {
    const router = createRouter().registerAction({
      name: "email",
      input: type.object({}),
      run: () => Effect.fail(new Error("API_KEY=secret")),
    })
    const compiled = await router.compile({
      version: 1,
      schema,
      rules: [{ id: "x", when: `true`, actions: [{ use: "email" }], route: "x" }],
      fallback: "fallback",
    })
    let capturedError: unknown
    try {
      await compiled.run({ email: "a@b.test", employees: 1, country: "UK" })
    } catch (error) {
      capturedError = error
    }

    expect(capturedError).toBeInstanceOf(ActionExecutionError)
    expect(String(capturedError)).not.toContain("API_KEY")
    expect((capturedError as ActionExecutionError).safeCause).toEqual({ name: "ActionFailure" })
  })

  it("enforces declared pure-function output at runtime", async () => {
    const lyingDefinition = {
      name: "lies",
      input: [],
      output: type.boolean(),
      run: () => "yes",
    }
    const router = createRouter().registerPureFunction(lyingDefinition as never)
    const compiled = await router.compile({
      version: 1,
      schema,
      rules: [{ id: "lie", when: `lies()`, route: "wrong" }],
      fallback: "safe",
    })
    await expect(
      compiled.run({ email: "a@b.test", employees: 1, country: "UK" }),
    ).rejects.toMatchObject({ code: "EvaluationError" })
  })

  it("enforces runtime limits on literal pure-function arguments", async () => {
    const run = vi.fn(() => true)
    const router = createRouter({ limits: { maximumStringLength: 3 } }).registerPureFunction({
      name: "accept",
      input: [type.string()] as const,
      output: type.boolean(),
      run,
    })
    const compiled = await router.compile({
      version: 1,
      schema,
      rules: [{ id: "long", when: `accept("much-too-long")`, route: "wrong" }],
      fallback: "safe",
    })
    await expect(compiled.run({ email: "a", employees: 1, country: "UK" })).rejects.toMatchObject({
      code: "ExecutionLimitExceeded",
    })
    expect(run).not.toHaveBeenCalled()
  })

  it("snapshots schemas against later mutation", () => {
    const mutableFields = { employees: field.number({ required: true }) }
    const frozenSchema = defineSchema(mutableFields)
    Reflect.deleteProperty(mutableFields, "employees")

    expect(Object.isFrozen(frozenSchema.fields)).toBe(true)
    expect(Object.isFrozen(frozenSchema.fields.employees)).toBe(true)
    expect(frozenSchema.fields.employees.runtimeType.kind).toBe("number")
  })

  it("snapshots pure-function registrations against later mutation", async () => {
    const frozenSchema = defineSchema({ employees: field.number({ required: true }) })
    const registration = {
      name: "positive",
      input: [type.number()] as const,
      output: type.boolean(),
      run: ([value]: readonly [number]) => value > 0,
    }
    const router = createRouter().registerPureFunction(registration)
    const compiled = await router.compile({
      version: 1,
      schema: frozenSchema,
      rules: [{ id: "yes", when: `positive(submission.employees)`, route: "yes" }],
      fallback: "no",
    })
    registration.run = () => false
    await expect(compiled.run({ employees: 1 })).resolves.toMatchObject({ route: "yes" })
  })

  it("rejects non-serialisable action output", async () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    const router = createRouter().registerAction({
      name: "badOutput",
      input: type.object({}),
      run: () => Effect.succeed(cyclic as never),
    })
    const compiled = await router.compile({
      version: 1,
      schema,
      rules: [{ id: "x", when: `true`, actions: [{ use: "badOutput" }], route: "x" }],
      fallback: "fallback",
    })
    await expect(
      compiled.run({ email: "a@b.test", employees: 1, country: "UK" }),
    ).rejects.toMatchObject({ code: "ActionExecutionError" })
  })

  it("accepts serialisable shared references and copies them to plain JSON data", async () => {
    const shared = { value: "ok" }
    const router = createRouter().registerAction({
      name: "shared",
      input: type.object({}),
      run: () => Effect.succeed({ first: shared, second: shared }),
    })
    const compiled = await router.compile({
      version: 1,
      schema,
      rules: [{ id: "x", when: `true`, actions: [{ use: "shared" }], route: "x" }],
      fallback: "fallback",
    })
    const result = await compiled.run({ email: "a@b.test", employees: 1, country: "UK" })

    const output = result.actions[0]?.output as {
      readonly first: { readonly value: string }
      readonly second: { readonly value: string }
    }

    expect(output).toEqual({ first: { value: "ok" }, second: { value: "ok" } })
    expect(output.first).not.toBe(shared)
    expect(output.first).not.toBe(output.second)
    expect(Object.getPrototypeOf(output)).toBe(Object.prototype)
    expect(() => JSON.stringify(result)).not.toThrow()
  })

  it("rejects action-output keys that exceed the string limit", async () => {
    const keyRouter = createRouter({ limits: { maximumStringLength: 3 } }).registerAction({
      name: "key",
      input: type.object({}),
      run: () => Effect.succeed({ toolong: null }),
    })
    const definition = {
      version: 1 as const,
      schema,
      rules: [{ id: "x", when: `true`, actions: [{ use: "key" }], route: "x" }],
      fallback: "fallback",
    }
    const keyCompiled = await keyRouter.compile(definition)
    await expect(
      keyCompiled.run({ email: "a", employees: 1, country: "UK" }),
    ).rejects.toMatchObject({ code: "ActionExecutionError" })
  })

  it("rejects action outputs that exceed the aggregate node limit", async () => {
    const nodeRouter = createRouter({ limits: { maximumOutputNodes: 2 } }).registerAction({
      name: "nodes",
      input: type.object({}),
      run: () => Effect.succeed({ a: { b: true } }),
    })
    const nodeCompiled = await nodeRouter.compile({
      version: 1,
      schema,
      rules: [{ id: "x", when: `true`, actions: [{ use: "nodes" }], route: "x" }],
      fallback: "fallback",
    })
    await expect(
      nodeCompiled.run({ email: "a", employees: 1, country: "UK" }),
    ).rejects.toMatchObject({ code: "ActionExecutionError" })
  })

  it("enforces output depth limits for primitive leaves", async () => {
    const router = createRouter({ limits: { maximumValueDepth: 0 } }).registerAction({
      name: "nested",
      input: type.object({}),
      run: () => Effect.succeed({ value: true }),
    })
    const compiled = await router.compile({
      version: 1,
      schema,
      rules: [{ id: "x", when: `true`, actions: [{ use: "nested" }], route: "x" }],
      fallback: "fallback",
    })

    await expect(compiled.run({ email: "a", employees: 1, country: "UK" })).rejects.toMatchObject({
      code: "ActionExecutionError",
    })
  })

  it("rejects accessor action outputs without invoking them", async () => {
    let getterCalls = 0
    const output = {}
    Object.defineProperty(output, "value", {
      enumerable: true,
      get: () => {
        getterCalls += 1
        return "secret"
      },
    })
    const router = createRouter().registerAction({
      name: "accessor",
      input: type.object({}),
      run: () => Effect.succeed(output as never),
    })
    const compiled = await router.compile({
      version: 1,
      schema,
      rules: [{ id: "x", when: `true`, actions: [{ use: "accessor" }], route: "x" }],
      fallback: "fallback",
    })

    await expect(compiled.run({ email: "a", employees: 1, country: "UK" })).rejects.toMatchObject({
      code: "ActionExecutionError",
    })
    expect(getterCalls).toBe(0)
  })

  it("supports successful array action arguments with different string literals", async () => {
    const run = vi.fn(() => Effect.succeed(undefined))
    const router = createRouter().registerAction({
      name: "tags",
      input: type.array(type.string()),
      run,
    })
    const compiled = await router.compile({
      version: 1,
      schema,
      rules: [
        {
          id: "x",
          when: `true`,
          actions: [{ use: "tags", with: `["enterprise", "uk"]` }],
          route: "x",
        },
      ],
      fallback: "fallback",
    })
    await compiled.run({ email: "a@b.test", employees: 1, country: "UK" })
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ input: ["enterprise", "uk"] }))
  })

  it("returns promptly for uninterruptible Effect actions and aborts their signal", async () => {
    let signal: AbortSignal | undefined
    const router = createRouter().registerAction({
      name: "slow",
      input: type.object({}),
      timeoutMs: 10,
      run: ({ context }) => {
        signal = context.signal
        return Effect.uninterruptible(Effect.sleep(200).pipe(Effect.as(undefined)))
      },
    })
    const compiled = await router.compile({
      version: 1,
      schema,
      rules: [{ id: "x", when: `true`, actions: [{ use: "slow" }], route: "x" }],
      fallback: "fallback",
    })
    const started = performance.now()
    const outcome = await Effect.runPromise(
      Effect.either(compiled.runEffect({ email: "a@b.test", employees: 1, country: "UK" })),
    )

    expect(Either.isLeft(outcome)).toBe(true)

    if (Either.isLeft(outcome)) {
      expect(outcome.left).toMatchObject({ code: "ActionExecutionError" })
    }

    expect(performance.now() - started).toBeLessThan(100)
    expect(signal?.aborted).toBe(true)
  })

  it("aborts the action signal when an Effect-native routing run is interrupted", async () => {
    let signal: AbortSignal | undefined
    let markStarted: (() => void) | undefined
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    const router = createRouter().registerAction({
      name: "abortAware",
      input: type.object({}),
      run: ({ context }) => {
        signal = context.signal
        markStarted?.()

        return Effect.async<undefined>((resume) => {
          const onAbort = () => resume(Effect.interrupt)

          context.signal.addEventListener("abort", onAbort, { once: true })

          return Effect.sync(() => context.signal.removeEventListener("abort", onAbort))
        })
      },
    })
    const compiled = await router.compile({
      version: 1,
      schema,
      rules: [
        {
          id: "interruptible",
          when: `true`,
          actions: [{ use: "abortAware" }],
          route: "sales",
        },
      ],
      fallback: "fallback",
    })
    const fiber = Effect.runFork(
      compiled.runEffect({ email: "a@b.test", employees: 500, country: "UK" }),
    )

    await started
    await Effect.runPromise(Fiber.interrupt(fiber))

    expect(signal?.aborted).toBe(true)
  })

  it("does not evaluate later conditions after a match", async () => {
    const later = vi.fn(() => true)
    const router = createRouter().registerPureFunction({
      name: "later",
      input: [],
      output: type.boolean(),
      run: later,
    })
    const compiled = await router.compile({
      version: 1,
      schema,
      rules: [
        { id: "first", when: `true`, route: "first" },
        { id: "later", when: `later()`, route: "later" },
      ],
      fallback: "fallback",
    })
    await compiled.run({ email: "a@b.test", employees: 1, country: "UK" })
    expect(later).not.toHaveBeenCalled()
  })
})
