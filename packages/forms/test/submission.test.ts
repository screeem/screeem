import { describe, expect, it } from "vitest"

import { InvalidSubmissionError } from "../src/errors.js"
import type { FormDefinition } from "../src/model.js"
import { normalizeSubmission } from "../src/submission.js"

const definition = {
  formatVersion: 1,
  title: "Lead qualification",
  submitLabel: "Send",
  successMessage: "Thank you",
  fields: [
    {
      id: "name-field",
      name: "name",
      label: "Name",
      required: true,
      type: "string",
      control: "text",
      validation: { minLength: 2, maxLength: 20 },
    },
    {
      id: "email-field",
      name: "email",
      label: "Work email",
      required: true,
      type: "string",
      control: "email",
    },
    {
      id: "employees-field",
      name: "employees",
      label: "Employees",
      required: true,
      type: "number",
      control: "number",
      validation: { min: 1, max: 100_000 },
    },
    {
      id: "country-field",
      name: "country",
      label: "Country",
      required: false,
      type: "enum",
      control: "select",
      values: ["UK", "US", "DE"],
    },
    {
      id: "consent-field",
      name: "consent",
      label: "Consent",
      required: true,
      type: "boolean",
      control: "checkbox",
    },
    {
      id: "updates-field",
      name: "updates",
      label: "Product updates",
      required: false,
      type: "boolean",
      control: "checkbox",
    },
  ],
} as const satisfies FormDefinition

describe("normalizeSubmission", () => {
  it("keeps JSON values type-strict and returns an immutable safe snapshot", () => {
    const input = {
      name: "Ada",
      email: "ada@example.com",
      employees: 500,
      country: "UK",
      consent: true,
    }

    const result = normalizeSubmission(definition, input, { mode: "json" })

    input.name = "Changed later"
    expect(result).toEqual({
      name: "Ada",
      email: "ada@example.com",
      employees: 500,
      country: "UK",
      consent: true,
    })
    expect(Object.getPrototypeOf(result)).toBeNull()
    expect(Object.isFrozen(result)).toBe(true)
  })

  it("normalizes browser number and checkbox conventions without inventing other optional values", () => {
    const result = normalizeSubmission(
      definition,
      {
        name: "Ada",
        email: "ada@example.com",
        employees: "5e2",
        country: "",
        consent: "on",
      },
      { mode: "form" },
    )

    expect(result).toEqual({
      name: "Ada",
      email: "ada@example.com",
      employees: 500,
      consent: true,
      updates: false,
    })
  })

  it("rejects JSON coercion and non-finite values instead of changing API meaning", () => {
    for (const employees of ["500", Number.POSITIVE_INFINITY, Number.NaN]) {
      expectInvalid(
        () =>
          normalizeSubmission(
            definition,
            {
              name: "Ada",
              email: "ada@example.com",
              employees,
              consent: true,
            },
            { mode: "json" },
          ),
        "invalid_number",
        "employees",
      )
    }
  })

  it("treats an empty required browser string as missing", () => {
    expectInvalid(
      () =>
        normalizeSubmission(
          definition,
          {
            name: "",
            email: "ada@example.com",
            employees: "500",
            consent: "on",
          },
          { mode: "form" },
        ),
      "required",
      "name",
    )
  })

  it("allows a blank optional email without applying non-empty constraints", () => {
    const optionalEmailDefinition = {
      ...definition,
      fields: definition.fields.map((field) =>
        field.name === "email"
          ? {
              ...field,
              required: false,
              validation: { minLength: 5 },
            }
          : field,
      ),
    } as FormDefinition

    expect(
      normalizeSubmission(
        optionalEmailDefinition,
        {
          name: "Ada",
          email: "",
          employees: "500",
          consent: "on",
        },
        { mode: "form" },
      ),
    ).toMatchObject({ email: "" })
  })

  it("reports required, email, length, numeric-bound, and enum failures together", () => {
    const error = captureInvalid(() =>
      normalizeSubmission(
        definition,
        {
          name: "A",
          email: "not-an-email",
          employees: 100_001,
          country: "FR",
          consent: false,
        },
        { mode: "json" },
      ),
    )

    expect(error.issues).toEqual([
      expect.objectContaining({ code: "min_length", field: "name" }),
      expect.objectContaining({ code: "invalid_email", field: "email" }),
      expect.objectContaining({ code: "maximum", field: "employees" }),
      expect.objectContaining({ code: "invalid_enum", field: "country" }),
      expect.objectContaining({ code: "required", field: "consent" }),
    ])
    expect(Object.isFrozen(error.issues)).toBe(true)
  })

  it("rejects unknown, duplicate, accessor, symbol, and unsafe fields without invoking accessors", () => {
    let getterCalls = 0
    const input = Object.create(null) as Record<PropertyKey, unknown>
    Object.assign(input, {
      name: "Ada",
      email: "ada@example.com",
      employees: "500",
      country: ["UK", "US"],
      consent: "on",
      unexpected: "value",
    })
    Object.defineProperty(input, "__proto__", { value: "unsafe", enumerable: true })
    Object.defineProperty(input, "prototype", { value: "unsafe", enumerable: true })
    Object.defineProperty(input, "constructor", { value: "unsafe", enumerable: true })
    Object.defineProperty(input, "secret", {
      enumerable: true,
      get() {
        getterCalls += 1
        return "never read"
      },
    })
    input[Symbol("hidden")] = "value"

    const error = captureInvalid(() => normalizeSubmission(definition, input, { mode: "form" }))

    expect(getterCalls).toBe(0)
    expect(error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "symbol_not_allowed" }),
        expect.objectContaining({ code: "duplicate_value", field: "country" }),
        expect.objectContaining({ code: "accessor_not_allowed", field: "secret" }),
        expect.objectContaining({ code: "unsafe_field", field: "__proto__" }),
        expect.objectContaining({ code: "unsafe_field", field: "prototype" }),
        expect.objectContaining({ code: "unsafe_field", field: "constructor" }),
        expect.objectContaining({ code: "unknown_field", field: "unexpected" }),
      ]),
    )
  })

  it("distinguishes allowed own prototype-named fields from inherited properties", () => {
    const prototypeNameDefinition = {
      ...definition,
      fields: [
        {
          id: "display-name",
          name: "toString",
          label: "Display name",
          required: false,
          type: "string",
          control: "text",
        },
      ],
    } as const satisfies FormDefinition

    const absent = normalizeSubmission(prototypeNameDefinition, {}, { mode: "json" })
    const present = normalizeSubmission(
      prototypeNameDefinition,
      { toString: "Ada" },
      { mode: "json" },
    )

    expect(Object.hasOwn(absent, "toString")).toBe(false)
    expect(Object.hasOwn(present, "toString")).toBe(true)
    expect(present.toString).toBe("Ada")
  })

  it("accepts finite decimal form numbers and rejects JavaScript-only spellings", () => {
    for (const [input, expected] of [
      ["  +.5  ", 0.5],
      ["-1.25e2", -125],
    ] as const) {
      const numericDefinition = withEmployeeBoundsRemoved()
      expect(
        normalizeSubmission(
          numericDefinition,
          { name: "Ada", email: "ada@example.com", employees: input, consent: "on" },
          { mode: "form" },
        ).employees,
      ).toBe(expected)
    }

    for (const input of ["0x10", "1_000", "Infinity", "   "]) {
      expectInvalid(
        () =>
          normalizeSubmission(
            definition,
            { name: "Ada", email: "ada@example.com", employees: input, consent: "on" },
            { mode: "form" },
          ),
        "invalid_number",
        "employees",
      )
    }
  })

  it("accepts FormData while rejecting duplicate values and files", () => {
    expect(normalizeSubmission(definition, validFormData(), { mode: "form" })).toEqual({
      name: "Ada",
      email: "ada@example.com",
      employees: 500,
      consent: true,
      updates: false,
    })

    const duplicate = validFormData()
    duplicate.append("country", "UK")
    duplicate.append("country", "US")
    expectInvalid(
      () => normalizeSubmission(definition, duplicate, { mode: "form" }),
      "duplicate_value",
      "country",
    )

    const withFile = validFormData()
    withFile.append("attachment", new Blob(["contents"]), "lead.txt")
    expectInvalid(
      () => normalizeSubmission(definition, withFile, { mode: "form" }),
      "unsupported_file",
      "attachment",
    )
  })

  it("rejects containers that could hide repeated or inherited values", () => {
    for (const input of [[], new (class Submission {})()]) {
      expectInvalid(() => normalizeSubmission(definition, input, { mode: "json" }), "invalid_type")
    }
  })

  it("turns hostile transport proxy failures into structured submission errors", () => {
    const revoked = Proxy.revocable({}, {})
    revoked.revoke()
    expectInvalid(
      () => normalizeSubmission(definition, revoked.proxy, { mode: "json" }),
      "invalid_type",
    )

    const formData = new Proxy(validFormData(), {
      get(target, property, receiver) {
        if (property === "entries") throw new Error("hostile entries trap")
        return Reflect.get(target, property, receiver)
      },
    })
    expectInvalid(() => normalizeSubmission(definition, formData, { mode: "form" }), "invalid_type")
  })
})

function validFormData() {
  const data = new FormData()
  data.set("name", "Ada")
  data.set("email", "ada@example.com")
  data.set("employees", "500")
  data.set("consent", "on")
  return data
}

function withEmployeeBoundsRemoved(): FormDefinition {
  return {
    ...definition,
    fields: definition.fields.map((field) =>
      field.name === "employees" ? { ...field, validation: undefined } : field,
    ),
  } as FormDefinition
}

function captureInvalid(action: () => unknown): InvalidSubmissionError {
  try {
    action()
  } catch (error) {
    expect(error).toBeInstanceOf(InvalidSubmissionError)
    return error as InvalidSubmissionError
  }
  throw new Error("Expected InvalidSubmissionError")
}

function expectInvalid(action: () => unknown, code: string, field?: string) {
  const error = captureInvalid(action)
  expect(error.issues).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code, ...(field === undefined ? {} : { field }) }),
    ]),
  )
}
