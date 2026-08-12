import type { FormDefinition } from "@screeem/forms"
import { describe, expect, it } from "vitest"

import { normalizeRespondentValues, validateRespondentField } from "../src/index.js"

const definition = {
  formatVersion: 1,
  title: "Eligibility",
  submitLabel: "Check",
  successMessage: "Thanks",
  fields: [
    {
      id: "age",
      name: "age",
      label: "Age",
      required: true,
      type: "number",
      control: "number",
      validation: { min: 18 },
    },
    {
      id: "updates",
      name: "updates",
      label: "Updates",
      required: false,
      type: "boolean",
      control: "checkbox",
    },
  ],
} as const satisfies FormDefinition

describe("respondent bindings", () => {
  it("normalizes browser-shaped state with the canonical forms validator", () => {
    expect(normalizeRespondentValues(definition, { age: "21", updates: false })).toEqual({
      age: 21,
      updates: false,
    })
  })

  it("reports field constraints before submit without changing their meaning", () => {
    expect(validateRespondentField(definition.fields[0], "17")).toBe("Age must be at least 18")
    expect(validateRespondentField(definition.fields[0], "21")).toBeUndefined()
  })
})
