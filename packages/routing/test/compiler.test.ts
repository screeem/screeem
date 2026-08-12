import { describe, expect, it } from "vitest"
import { Effect } from "effect"
import { CompilationError, createRouter, defineSchema, field, type } from "../src/index.js"

const schema = defineSchema({
  email: field.string({ required: true }),
  employees: field.number({ required: true }),
  country: field.enum(["UK", "US"] as const, { required: true }),
  note: field.string({ required: false }),
})

const definition = (when: string) => ({
  version: 1 as const,
  schema,
  rules: [{ id: "rule", when, route: "matched" }],
  fallback: "fallback",
})

describe("parser and static type validation", () => {
  it.each([
    `submission.employees >= 500`,
    `submission.employees >= -500`,
    `submission.employees >= 500 && submission.country === "UK"`,
    `submission.country === "UK" ? true : false`,
    `contains(submission.email, "@")`,
    `exists(submission.note) && submission.note === "priority"`,
    `!isEmpty(submission.note) && startsWith(submission.note, "priority")`,
    `isEmpty(submission.note) || submission.note === "priority"`,
    `!exists(submission.note) || submission.note === "priority"`,
    `exists(submission.note) ? submission.note === "priority" : false`,
    `isEmpty(submission.note) ? false : submission.note === "priority"`,
    "`lead:${submission.email}` === `lead:a@b.test`",
  ])("compiles supported expressions: %s", async (when) => {
    await expect(createRouter().compile(definition(when))).resolves.toBeDefined()
  })

  it.each([
    [`submission.employees === "large"`, "TypeMismatch"],
    [`submission.employees >= "500"`, "TypeMismatch"],
    [`submission.employees < 1e999`, "TypeMismatch"],
    [`submission.employees < -1e999`, "TypeMismatch"],
    [`-submission.employees < 0`, "TypeMismatch"],
    [`submission.country === "DE"`, "TypeMismatch"],
    [`submission.randomThing === "yes"`, "UnknownField"],
    [`submission.note === "hello"`, "TypeMismatch"],
    [`lower(submission.employees) === "10"`, "TypeMismatch"],
    [`submission.employees`, "TypeMismatch"],
    [`missing(submission.email)`, "UnknownFunction"],
    [`submission.email.includes("x")`, "UnsupportedSyntax"],
    [`exists("not a field")`, "TypeMismatch"],
    [`exists(submission.note, submission.email)`, "TypeMismatch"],
    [`exists(submission.note) || submission.note === "priority"`, "TypeMismatch"],
    [`isEmpty(submission.note) && submission.note === "priority"`, "TypeMismatch"],
  ])("rejects type-invalid expressions: %s", async (when, code) => {
    await expect(createRouter().compile(definition(when))).rejects.toMatchObject({
      diagnostics: expect.arrayContaining([expect.objectContaining({ code, ruleId: "rule" })]),
    })
  })

  it("validates registered pure function arguments and output", async () => {
    const router = createRouter().registerPureFunction({
      name: "isWorkEmail",
      input: [type.string()],
      output: type.boolean(),
      run: (args: readonly unknown[]) => String(args[0]).endsWith("@work.test"),
    })
    await expect(router.compile(definition(`isWorkEmail(submission.email)`))).resolves.toBeDefined()
  })

  it("returns source positions in diagnostics", async () => {
    await expect(
      createRouter().compile(definition(`submission.unknown === true`)),
    ).rejects.toMatchObject({
      diagnostics: [expect.objectContaining({ start: 0, end: 18 })],
    })
  })

  it.each([`({ value: submission.note })`, `[submission.note]`, "`note:${submission.note}`"])(
    "does not lose optionality inside nested expressions: %s",
    async (withExpression) => {
      const router = createRouter().registerAction({
        name: "capture",
        input: type.object({ value: type.string() }),
        run: () => Effect.succeed(undefined),
      })
      await expect(
        router.compile({
          version: 1,
          schema,
          rules: [
            {
              id: "optional",
              when: `true`,
              actions: [{ use: "capture", with: withExpression }],
              route: "x",
            },
          ],
          fallback: "fallback",
        }),
      ).rejects.toMatchObject({ code: "InvalidActionArguments" })
    },
  )

  it("does not erase optional fields when the whole submission is passed", async () => {
    const router = createRouter().registerAction({
      name: "capture",
      input: type.object({
        email: type.string(),
        employees: type.number(),
        country: type.enum(["UK", "US"] as const),
        note: type.string(),
      }),
      run: () => Effect.succeed(undefined),
    })

    await expect(
      router.compile({
        version: 1,
        schema,
        rules: [
          {
            id: "optional-submission",
            when: `true`,
            actions: [{ use: "capture", with: `submission` }],
            route: "x",
          },
        ],
        fallback: "fallback",
      }),
    ).rejects.toMatchObject({ code: "InvalidActionArguments" })
  })

  it("does not carry an optional-field proof into actions when presence is not guaranteed", async () => {
    const router = createRouter().registerAction({
      name: "capture",
      input: type.object({ note: type.string() }),
      run: () => Effect.succeed(undefined),
    })

    await expect(
      router.compile({
        version: 1,
        schema,
        rules: [
          {
            id: "possibly-empty",
            when: `isEmpty(submission.note)`,
            actions: [{ use: "capture", with: `({ note: submission.note })` }],
            route: "x",
          },
        ],
        fallback: "fallback",
      }),
    ).rejects.toMatchObject({ code: "InvalidActionArguments" })
  })

  it("accepts enum-valued conditional action arguments", async () => {
    const router = createRouter().registerAction({
      name: "capture",
      input: type.object({ priority: type.enum(["high", "normal"] as const) }),
      run: () => Effect.succeed(undefined),
    })
    await expect(
      router.compile({
        version: 1,
        schema,
        rules: [
          {
            id: "enum",
            when: `true`,
            actions: [
              {
                use: "capture",
                with: `({ priority: submission.employees > 1000 ? "high" : "normal" })`,
              },
            ],
            route: "x",
          },
        ],
        fallback: "fallback",
      }),
    ).resolves.toBeDefined()
  })

  it("widens mixed literal and field arrays without retaining a false enum constraint", async () => {
    const router = createRouter().registerAction({
      name: "values",
      input: type.array(type.string()),
      run: () => Effect.succeed(undefined),
    })
    const compiled = await router.compile({
      version: 1,
      schema,
      rules: [
        {
          id: "array",
          when: `true`,
          actions: [{ use: "values", with: `["fixed", submission.email]` }],
          route: "x",
        },
      ],
      fallback: "fallback",
    })
    await expect(
      compiled.run({ email: "dynamic", employees: 1, country: "UK" }),
    ).resolves.toMatchObject({ route: "x" })
  })

  it("treats inherited names as unknown fields", async () => {
    await expect(
      createRouter().compile(definition(`submission.toString === "x"`)),
    ).rejects.toMatchObject({ code: "UnknownField" })
  })

  it("rejects malformed persisted schema contracts", async () => {
    const malformed = {
      version: 1 as const,
      schema: {
        closed: true as const,
        fields: { age: { required: true, valueType: 0, runtimeType: { kind: "date" } } },
      },
      rules: [],
      fallback: "fallback",
    }
    await expect(createRouter().compile(malformed as never)).rejects.toMatchObject({
      code: "TypeMismatch",
    })
  })

  it("returns stable diagnostics for malformed persisted definitions", async () => {
    await expect(
      createRouter().compile({ version: 1, schema, rules: null, fallback: "x" } as never),
    ).rejects.toBeInstanceOf(CompilationError)
  })

  it("rejects routing contract accessors without invoking them", async () => {
    let fallbackGetterCalls = 0
    let ruleGetterCalls = 0
    const definitionWithFallbackAccessor = { version: 1, schema, rules: [] }

    Object.defineProperty(definitionWithFallbackAccessor, "fallback", {
      enumerable: true,
      get: () => {
        fallbackGetterCalls += 1
        return "fallback"
      },
    })

    const accessorRules: unknown[] = []
    Object.defineProperty(accessorRules, "0", {
      enumerable: true,
      get: () => {
        ruleGetterCalls += 1
        return { id: "unsafe", when: "true", route: "unsafe" }
      },
    })
    const definitionWithRuleAccessor = {
      version: 1,
      schema,
      rules: accessorRules,
      fallback: "fallback",
    }

    await expect(createRouter().compile(definitionWithFallbackAccessor)).rejects.toBeInstanceOf(
      CompilationError,
    )
    await expect(createRouter().compile(definitionWithRuleAccessor)).rejects.toBeInstanceOf(
      CompilationError,
    )
    expect(fallbackGetterCalls).toBe(0)
    expect(ruleGetterCalls).toBe(0)
  })

  it("returns stable diagnostics for unsupported object keys", async () => {
    const router = createRouter().registerAction({
      name: "capture",
      input: type.object({ value: type.string() }),
      run: () => Effect.succeed(undefined),
    })

    await expect(
      router.compile({
        version: 1,
        schema,
        rules: [
          {
            id: "invalid-key",
            when: `true`,
            actions: [{ use: "capture", with: `({ "not-valid": "x" })` }],
            route: "x",
          },
        ],
        fallback: "fallback",
      }),
    ).rejects.toBeInstanceOf(CompilationError)
  })
})
