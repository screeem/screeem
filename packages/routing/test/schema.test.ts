import { describe, expect, it } from "vitest"
import {
  CompilationError,
  InvalidFormDefinitionError,
  InvalidInputError,
  createRouter,
  defineSchema,
  field,
  schemaFromForm,
  type ExpressionLanguageDescription,
} from "../src/index.js"
import { type, validateRuntimeType } from "../src/schema.js"

const schema = defineSchema({
  email: field.string({ required: true }),
  employees: field.number({ required: true }),
  active: field.boolean({ required: true }),
  country: field.enum(["UK", "US", "DE"] as const, { required: true }),
  message: field.string({ required: false }),
})

async function compiled() {
  return createRouter().compile({ version: 1, schema, rules: [], fallback: "default" })
}

describe("schema and input contract", () => {
  it("creates a routing schema from plain form-builder data", async () => {
    const form: unknown = JSON.parse(`{
      "id": "lead-form",
      "fields": [
        { "name": "name", "type": "string", "required": true },
        { "name": "age", "type": "number", "required": true },
        { "name": "country", "type": "enum", "values": ["UK", "US"], "required": false }
      ]
    }`)
    const generatedSchema = schemaFromForm(form)
    const routing = await createRouter().compile({
      version: 1,
      schema: generatedSchema,
      rules: [{ id: "adult", when: `submission.age >= 18`, route: "allowed" }],
      fallback: "denied",
    })

    await expect(routing.run({ name: "Ada", age: 21 })).resolves.toMatchObject({
      route: "allowed",
    })
    await expect(routing.run({ name: "Lin", age: 17, country: "US" })).resolves.toMatchObject({
      route: "denied",
    })
  })

  it("snapshots form-builder fields and enum values", async () => {
    const countries = ["UK", "US"]
    const form = {
      fields: [
        { name: "country", type: "enum" as const, values: countries, required: true as const },
      ],
    }
    const generatedSchema = schemaFromForm(form)

    countries.push("DE")
    form.fields[0]!.name = "changed"

    const routing = await createRouter().compile({
      version: 1,
      schema: generatedSchema,
      rules: [{ id: "uk", when: `submission.country === "UK"`, route: "uk" }],
      fallback: "other",
    })

    await expect(routing.run({ country: "UK" })).resolves.toMatchObject({ route: "uk" })
    await expect(routing.run({ country: "DE" } as never)).rejects.toMatchObject({
      code: "InvalidInput",
    })
  })

  it.each([
    [
      "duplicate names",
      {
        fields: [
          { name: "age", type: "number", required: true },
          { name: "age", type: "number", required: false },
        ],
      },
    ],
    ["unsafe names", { fields: [{ name: "constructor", type: "string", required: true }] }],
    ["unsupported types", { fields: [{ name: "birthday", type: "date", required: true }] }],
    ["empty enums", { fields: [{ name: "country", type: "enum", values: [], required: true }] }],
    [
      "duplicate enum values",
      { fields: [{ name: "country", type: "enum", values: ["UK", "UK"], required: true }] },
    ],
  ])("rejects malformed form-builder data: %s", (_name, form) => {
    expect(() => schemaFromForm(form)).toThrow(InvalidFormDefinitionError)
  })

  it("rejects form-builder accessors without invoking them", () => {
    let getterCalls = 0
    const form = {}

    Object.defineProperty(form, "fields", {
      enumerable: true,
      get: () => {
        getterCalls += 1
        return []
      },
    })

    expect(() => schemaFromForm(form)).toThrow(/data property/)
    expect(getterCalls).toBe(0)
  })

  it("rejects invalid form metadata without coercing it", () => {
    let coercionCalls = 0
    const hostileValue = {
      toString: () => {
        coercionCalls += 1
        return "age"
      },
    }

    expect(() =>
      schemaFromForm({
        fields: [{ name: hostileValue, type: "number", required: true }],
      }),
    ).toThrow(InvalidFormDefinitionError)
    expect(() =>
      schemaFromForm({
        fields: [{ name: "age", type: hostileValue, required: true }],
      }),
    ).toThrow(InvalidFormDefinitionError)
    expect(coercionCalls).toBe(0)
  })

  it("rejects schema accessors without invoking them", async () => {
    let fieldsGetterCalls = 0
    const accessorSchema = { closed: true }

    Object.defineProperty(accessorSchema, "fields", {
      enumerable: true,
      get: () => {
        fieldsGetterCalls += 1
        return {}
      },
    })

    await expect(
      createRouter().compile({
        version: 1,
        schema: accessorSchema,
        rules: [],
        fallback: "fallback",
      }),
    ).rejects.toBeInstanceOf(CompilationError)
    expect(fieldsGetterCalls).toBe(0)

    let kindGetterCalls = 0
    const accessorRuntimeType = {}

    Object.defineProperty(accessorRuntimeType, "kind", {
      enumerable: true,
      get: () => {
        kindGetterCalls += 1
        return "string"
      },
    })

    await expect(
      createRouter().compile({
        version: 1,
        schema: {
          closed: true,
          fields: {
            email: { required: true, runtimeType: accessorRuntimeType },
          },
        },
        rules: [],
        fallback: "fallback",
      }),
    ).rejects.toBeInstanceOf(CompilationError)
    expect(kindGetterCalls).toBe(0)
  })

  it("accepts required values and absent optional values", async () => {
    const routing = await compiled()
    await expect(
      routing.run({ email: "a@b.test", employees: 10, active: true, country: "UK" }),
    ).resolves.toEqual({ route: "default", matchedRule: null, actions: [] })
  })

  it.each([
    [
      "missing required field",
      { email: "a@b.test", active: true, country: "UK" },
      "employees is missing",
    ],
    [
      "wrong primitive type",
      { email: "a@b.test", employees: "10", active: true, country: "UK" },
      "must be a finite number",
    ],
    [
      "unknown enum value",
      { email: "a@b.test", employees: 10, active: true, country: "FR" },
      "must be one of",
    ],
    [
      "unknown field",
      { email: "a@b.test", employees: 10, active: true, country: "UK", surprise: true },
      "Unknown submission field",
    ],
  ])("rejects malformed input before evaluation: %s", async (_name, input, message) => {
    const routing = await compiled()
    await expect(routing.run(input as never)).rejects.toMatchObject({
      code: "InvalidInput",
      message: expect.stringContaining(message),
    })
  })

  it("describes the schema for editors", async () => {
    const routing = await compiled()
    expect(routing.describeSchema().fields).toContainEqual({
      path: "submission.country",
      type: "enum",
      values: ["UK", "US", "DE"],
      required: true,
    })
  })

  it("describes operators and registered condition functions for expression editors", () => {
    const router = createRouter().registerPureFunction({
      name: "isLargeMarket",
      input: [type.enum(["UK", "US"] as const)] as const,
      output: type.boolean(),
      run: ([country]) => country === "UK",
    })
    const language: ExpressionLanguageDescription = router.describeExpressionLanguage()

    expect(language.functions).toContainEqual({
      name: "exists",
      parameters: [{ type: "field", acceptsOptional: true }],
      result: { type: "boolean" },
      description: "Whether the field has a submitted value",
    })
    expect(language.functions).toContainEqual({
      name: "isLargeMarket",
      parameters: [{ type: "enum", values: ["UK", "US"], acceptsOptional: false }],
      result: { type: "boolean" },
    })
    expect(language.operators).toContainEqual({
      symbol: ">=",
      category: "comparison",
      description: "Greater than or equal to",
    })
    expect(Object.isFrozen(language.functions)).toBe(true)
  })

  it("rejects unsafe schema keys", async () => {
    const unsafe = defineSchema({ constructor: field.string({ required: true }) })
    await expect(
      createRouter().compile({ version: 1, schema: unsafe, rules: [], fallback: "x" }),
    ).rejects.toBeInstanceOf(CompilationError)
  })

  it("uses stable typed errors", async () => {
    const routing = await compiled()
    await expect(routing.run(null as never)).rejects.toBeInstanceOf(InvalidInputError)
  })

  it("handles optional field names inherited from Object.prototype", async () => {
    const inheritedNameSchema = defineSchema({ toString: field.string({ required: false }) })
    const routing = await createRouter().compile({
      version: 1,
      schema: inheritedNameSchema,
      rules: [],
      fallback: "ok",
    })
    await expect(routing.run({})).resolves.toMatchObject({ route: "ok" })
  })

  it("treats an absent optional prototype-named field as absent in expressions", async () => {
    const inheritedNameSchema = defineSchema({ toString: field.string({ required: false }) })
    const routing = await createRouter().compile({
      version: 1,
      schema: inheritedNameSchema,
      rules: [{ id: "present", when: `exists(submission.toString)`, route: "present" }],
      fallback: "absent",
    })

    await expect(routing.run({})).resolves.toMatchObject({ route: "absent" })
    await expect(routing.run({ toString: "label" })).resolves.toMatchObject({ route: "present" })
  })

  it("does not satisfy nested required fields with inherited properties", () => {
    const expected = type.object({ toString: type.string() })

    expect(validateRuntimeType({}, expected, "value")).toBe("value.toString is required")
  })

  it("rejects nested object accessors without reading them", () => {
    let getterCalls = 0
    const expected = type.object({ toString: type.string() })
    const accessor = {}
    Object.defineProperty(accessor, "toString", {
      enumerable: true,
      get: () => {
        getterCalls += 1
        return "unstable"
      },
    })

    expect(validateRuntimeType(accessor, expected, "value")).toBe(
      "value.toString must be a data property",
    )
    expect(getterCalls).toBe(0)
  })

  it("rejects array element accessors without reading them", () => {
    let getterCalls = 0
    const arrayAccessor: string[] = []
    Object.defineProperty(arrayAccessor, "0", {
      enumerable: true,
      get: () => {
        getterCalls += 1
        return "unstable"
      },
    })

    expect(validateRuntimeType(arrayAccessor, type.array(type.string()), "value")).toBe(
      "value[0] must be a data property",
    )
    expect(getterCalls).toBe(0)
  })

  it("rejects accessor submissions instead of validating a changing value", async () => {
    const input = {}
    Object.defineProperty(input, "email", { enumerable: true, get: () => "valid@example.com" })
    const routing = await compiled()
    await expect(routing.run(input as never)).rejects.toMatchObject({
      code: "InvalidInput",
      message: expect.stringContaining("data property"),
    })
  })

  it("enforces the top-level submission collection limit", async () => {
    const twoFields = defineSchema({
      first: field.string({ required: true }),
      second: field.string({ required: true }),
    })
    const routing = await createRouter({ limits: { maximumCollectionSize: 1 } }).compile({
      version: 1,
      schema: twoFields,
      rules: [],
      fallback: "ok",
    })
    await expect(routing.run({ first: "a", second: "b" })).rejects.toMatchObject({
      code: "InvalidInput",
    })
  })
})
