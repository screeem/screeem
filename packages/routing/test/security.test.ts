import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { CompilationError, createRouter, defineSchema, field, type } from "../src/index.js"

const schema = defineSchema({ email: field.string({ required: true }) })

describe("untrusted expression security", () => {
  it.each([
    `submission.constructor`,
    `submission.__proto__`,
    `submission["constructor"]`,
    `globalThis`,
    `process`,
    `Function`,
    `new Function("return process")`,
    `submission.email = "stolen"`,
    `(() => true)()`,
    `this`,
    `await fetch("https://example.com")`,
    `submission.email; process.exit()`,
    `for (;;) {}`,
    `class Escape {}`,
    `import("node:fs")`,
  ])("rejects escape attempt: %s", async (when) => {
    await expect(
      createRouter().compile({
        version: 1,
        schema,
        rules: [{ id: "unsafe", when, route: "x" }],
        fallback: "fallback",
      }),
    ).rejects.toBeInstanceOf(CompilationError)
  })

  it("enforces the expression source-length limit", async () => {
    const router = createRouter({ limits: { maximumSourceLength: 10 } })
    await expect(
      router.compile({
        version: 1,
        schema,
        rules: [{ id: "long", when: `submission.email === "x"`, route: "x" }],
        fallback: "fallback",
      }),
    ).rejects.toMatchObject({ code: "ExecutionLimitExceeded" })
  })

  it("does not expose the unsafe native-regex built-in", async () => {
    await expect(
      createRouter().compile({
        version: 1,
        schema,
        rules: [{ id: "regex", when: `matches(submission.email, "(a+)+$")`, route: "x" }],
        fallback: "fallback",
      }),
    ).rejects.toMatchObject({ code: "UnknownFunction" })
  })

  it.each(["exists", "isEmpty"])("does not allow the %s predicate to be shadowed", (name) => {
    expect(() =>
      createRouter().registerPureFunction({
        name,
        input: [],
        output: type.boolean(),
        run: () => true,
      }),
    ).toThrow(/already exists/)
  })

  it.each([
    ["non-finite AST-node limit", { maximumAstNodes: Number.NaN }],
    ["infinite string-length limit", { maximumStringLength: Number.POSITIVE_INFINITY }],
    ["zero action timeout", { defaultActionTimeoutMs: 0 }],
    ["timer-overflow action timeout", { defaultActionTimeoutMs: 2_147_483_648 }],
    ["negative rule limit", { maximumRules: -1 }],
  ])("rejects an invalid router limit: %s", (_name, limits) => {
    expect(() => createRouter({ limits })).toThrow(/Routing limit/)
  })

  it("accepts namespaced actions and rejects unsafe namespace segments", () => {
    expect(() =>
      createRouter().registerAction({
        name: "crm.upsertLead",
        input: type.object({}),
        run: () => Effect.succeed(undefined),
      }),
    ).not.toThrow()

    expect(() =>
      createRouter().registerPureFunction({
        name: "crm.lookup",
        input: [],
        output: type.boolean(),
        run: () => true,
      }),
    ).toThrow(/Invalid registration name/)

    for (const name of ["crm..upsertLead", "crm.__proto__", "submission.notify"]) {
      expect(() =>
        createRouter().registerAction({
          name,
          input: type.object({}),
          run: () => Effect.succeed(undefined),
        }),
      ).toThrow(/Invalid registration name/)
    }
  })

  it.each([
    ["zero", 0],
    ["fractional", 0.5],
    ["non-finite", Number.POSITIVE_INFINITY],
    ["timer overflow", 2_147_483_648],
  ])("rejects an invalid per-action timeout: %s", (_name, timeoutMs) => {
    expect(() =>
      createRouter().registerAction({
        name: "noop",
        input: type.object({}),
        timeoutMs,
        run: () => Effect.succeed(undefined),
      }),
    ).toThrow(/invalid timeout/)
  })

  it("enforces the AST-node limit", async () => {
    await expect(
      createRouter({ limits: { maximumAstNodes: 2 } }).compile({
        version: 1,
        schema,
        rules: [{ id: "ast", when: `submission.email === "x"`, route: "x" }],
        fallback: "fallback",
      }),
    ).rejects.toMatchObject({ code: "ExecutionLimitExceeded" })
  })

  it("enforces the rule-count limit", async () => {
    await expect(
      createRouter({ limits: { maximumRules: 0 } }).compile({
        version: 1,
        schema,
        rules: [{ id: "rule", when: `true`, route: "x" }],
        fallback: "fallback",
      }),
    ).rejects.toMatchObject({ code: "ExecutionLimitExceeded" })
  })

  it("enforces the AST-depth limit", async () => {
    await expect(
      createRouter({ limits: { maximumAstDepth: 2 } }).compile({
        version: 1,
        schema,
        rules: [{ id: "depth", when: `!!!true`, route: "x" }],
        fallback: "fallback",
      }),
    ).rejects.toMatchObject({ code: "ExecutionLimitExceeded" })
  })

  it("enforces the per-rule action-count limit", async () => {
    const limitedActions = createRouter({ limits: { maximumActionsPerRule: 1 } }).registerAction({
      name: "noop",
      input: type.object({}),
      run: () => Effect.succeed(undefined),
    })
    await expect(
      limitedActions.compile({
        version: 1,
        schema,
        rules: [
          { id: "actions", when: `true`, actions: [{ use: "noop" }, { use: "noop" }], route: "x" },
        ],
        fallback: "fallback",
      }),
    ).rejects.toMatchObject({ code: "ExecutionLimitExceeded" })
  })

  it("enforces the runtime string-length limit before evaluation", async () => {
    const stringRouter = await createRouter({ limits: { maximumStringLength: 3 } }).compile({
      version: 1,
      schema,
      rules: [],
      fallback: "fallback",
    })
    await expect(stringRouter.run({ email: "long" })).rejects.toMatchObject({
      code: "InvalidInput",
    })
  })

  it("enforces the runtime collection limit on action arguments", async () => {
    const collectionRouter = createRouter({ limits: { maximumCollectionSize: 1 } }).registerAction({
      name: "object",
      input: type.object({ a: type.string(), b: type.string() }),
      run: () => Effect.succeed(undefined),
    })
    const compiledCollection = await collectionRouter.compile({
      version: 1,
      schema,
      rules: [
        {
          id: "collection",
          when: `true`,
          actions: [{ use: "object", with: `({ a: "a", b: "b" })` }],
          route: "x",
        },
      ],
      fallback: "fallback",
    })
    await expect(compiledCollection.run({ email: "x" })).rejects.toMatchObject({
      code: "ExecutionLimitExceeded",
    })
  })
})
