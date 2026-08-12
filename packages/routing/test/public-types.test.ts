import { Effect } from "effect"
import { describe, expectTypeOf, it } from "vitest"
import {
  createRouter,
  defineSchema,
  field,
  schemaFromForm,
  type,
  type ExpressionLanguageDescription,
  type InferSubmission,
  type RoutingExecutionError,
  type RoutingResult,
  type RuntimeType,
} from "../src/index.js"

describe("public TypeScript contracts", () => {
  it("infers submissions from literal form-builder definitions", async () => {
    const generatedSchema = schemaFromForm({
      fields: [
        { name: "name", label: "Full name", type: "string", required: true },
        { name: "age", label: "Age", type: "number", required: true },
        {
          name: "country",
          label: "Country",
          type: "enum",
          values: ["UK", "US"],
          required: false,
        },
      ],
    })
    type GeneratedSubmission = InferSubmission<typeof generatedSchema>

    const valid: GeneratedSubmission = { name: "Ada", age: 21 }
    const withOptional: GeneratedSubmission = { name: "Lin", age: 30, country: "US" }

    if (false) {
      // @ts-expect-error generated required fields cannot be omitted
      const missing: GeneratedSubmission = { name: "Ada" }
      // @ts-expect-error generated enum values retain their literal union
      const invalidEnum: GeneratedSubmission = { name: "Ada", age: 21, country: "DE" }
      // @ts-expect-error generated schemas remain closed to unknown fields
      const extra: GeneratedSubmission = { name: "Ada", age: 21, surprise: true }
      void missing
      void invalidEnum
      void extra
    }

    expectTypeOf(valid).toMatchTypeOf<GeneratedSubmission>()
    expectTypeOf(withOptional).toMatchTypeOf<GeneratedSubmission>()

    const routing = await createRouter().compile({
      version: 1,
      schema: generatedSchema,
      rules: [],
      fallback: "ok",
    })

    void routing.run({ name: "Ada", age: 21 })
  })

  it("exposes expression-language metadata from routers and compiled definitions", async () => {
    const router = createRouter()
    const schema = defineSchema({ email: field.string({ required: true }) })
    const compiled = await router.compile({ version: 1, schema, rules: [], fallback: "ok" })

    expectTypeOf(router.describeExpressionLanguage()).toEqualTypeOf<ExpressionLanguageDescription>()
    expectTypeOf(
      compiled.describeExpressionLanguage(),
    ).toEqualTypeOf<ExpressionLanguageDescription>()
  })

  it("exposes an Effect-native run with a typed routing error channel", async () => {
    const schema = defineSchema({ email: field.string({ required: true }) })
    const compiled = await createRouter().compile({
      version: 1,
      schema,
      rules: [],
      fallback: "ok",
    })

    expectTypeOf(compiled.runEffect({ email: "a@b.test" })).toEqualTypeOf<
      Effect.Effect<RoutingResult, RoutingExecutionError, never>
    >()
    expectTypeOf(compiled.run({ email: "a@b.test" })).toEqualTypeOf<Promise<RoutingResult>>()
  })

  it("accepts routing definitions loaded as unknown runtime data", async () => {
    const persisted: unknown = {
      version: 1,
      schema: defineSchema({ age: field.number({ required: true }) }),
      rules: [{ id: "adult", when: `submission.age >= 18`, route: "adult" }],
      fallback: "minor",
    }
    const compiled = await createRouter().compile(persisted)

    expectTypeOf(compiled).toMatchTypeOf<{
      run(submission: object): Promise<RoutingResult>
    }>()
  })

  it("infers action input from its runtime descriptor", () => {
    createRouter().registerAction({
      name: "email",
      input: type.object({ to: type.string(), attempts: type.number() }),
      run: ({ input }) => {
        expectTypeOf(input).toEqualTypeOf<{ readonly to: string; readonly attempts: number }>()
        return Effect.succeed({ accepted: true })
      },
    })
  })

  it("links pure function implementations to declared runtime types", () => {
    createRouter().registerPureFunction({
      name: "valid",
      input: [type.string()] as const,
      output: type.boolean(),
      run: ([value]) => value.length > 0,
    })

    createRouter().registerPureFunction({
      name: "invalid",
      input: [type.string()] as const,
      output: type.boolean(),
      // @ts-expect-error a boolean descriptor cannot have a string implementation
      run: () => "not boolean",
    })
  })

  it("rejects non-literal required flags", () => {
    const required: boolean = Math.random() > 0.5
    defineSchema({
      // @ts-expect-error required must be a literal contract value
      email: field.string({ required }),
    })
  })

  it("rejects void action effects", () => {
    createRouter().registerAction({
      name: "invalid",
      input: type.object({}),
      // @ts-expect-error action effects must produce JSON-compatible output or undefined
      run: () => Effect.void,
    })
  })

  it("checks submissions without colliding with Object prototype names", async () => {
    const schema = defineSchema({
      email: field.string({ required: true }),
      toString: field.string({ required: false }),
    })
    const routing = await createRouter().compile({ version: 1, schema, rules: [], fallback: "ok" })

    void routing.runEffect({ email: "a@b.test" })
    void routing.runEffect({ email: "a@b.test", toString: "label" })
    void routing.run({ email: "a@b.test" })
    void routing.run({ email: "a@b.test", toString: "label" })

    if (false) {
      // @ts-expect-error required schema fields cannot be omitted
      void routing.runEffect({})
      // @ts-expect-error field values must match their runtime descriptors
      void routing.runEffect({ email: 42 })
      // @ts-expect-error closed schemas reject unknown fields
      void routing.runEffect({ email: "a@b.test", surprise: true })
      // @ts-expect-error required schema fields cannot be omitted
      void routing.run({})
      // @ts-expect-error field values must match their runtime descriptors
      void routing.run({ email: 42 })
      // @ts-expect-error closed schemas reject unknown fields
      void routing.run({ email: "a@b.test", surprise: true })
    }
  })

  it("materializes inferred submissions with optional Object prototype names", () => {
    const schema = defineSchema({
      email: field.string({ required: true }),
      toString: field.string({ required: false }),
      valueOf: field.number({ required: false }),
    })
    type Submission = InferSubmission<typeof schema>

    const absent: Submission = { email: "a@b.test" }
    const present: Submission = { email: "a@b.test", toString: "label", valueOf: 42 }

    if (false) {
      // @ts-expect-error inferred submissions remain closed to unknown fields
      const extra: Submission = { email: "a@b.test", surprise: true }
      // @ts-expect-error prototype-named fields retain their declared value types
      const wrong: Submission = { email: "a@b.test", toString: 42 }
      void extra
      void wrong
    }

    expectTypeOf(absent).toMatchTypeOf<Submission>()
    expectTypeOf(present).toMatchTypeOf<Submission>()
  })

  it("prevents structurally forged descriptors and fields", () => {
    // @ts-expect-error runtime descriptors are nominal and must come from the builders
    const dishonest: RuntimeType<string> = { kind: "number" }
    expectTypeOf(dishonest).toEqualTypeOf<RuntimeType<string>>()

    defineSchema({
      // @ts-expect-error fields are nominal and must come from the field builders
      age: { valueType: "", required: true, runtimeType: type.number() },
    })
  })
})
