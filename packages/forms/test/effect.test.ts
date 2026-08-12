import { Effect, Either } from "effect"
import { describe, expect, expectTypeOf, it } from "vitest"

import {
  addField,
  createField,
  createFormDefinition,
  InvalidSubmissionError,
  MemoryFormDefinitionStore,
  type FormDefinition,
  updateField,
} from "../src/index.js"
import {
  normalizeSubmissionEffect,
  toEffectFormDefinitionStore,
  type SubmissionValidationError,
} from "../src/effect.js"

const consumerDefinition = {
  formatVersion: 1,
  title: "Eligibility",
  submitLabel: "Check",
  successMessage: "Thanks",
  fields: [
    {
      id: "name",
      name: "name",
      label: "Name",
      required: true,
      type: "string",
      control: "text",
    },
    {
      id: "age",
      name: "age",
      label: "Age",
      required: true,
      type: "number",
      control: "number",
    },
  ],
} as const satisfies FormDefinition

function eligibilityDefinition() {
  let definition = createFormDefinition("Eligibility")
  definition = addField(
    definition,
    createField("text", { id: "name", name: "name", label: "Name" }),
  )
  definition = addField(definition, createField("number", { id: "age", name: "age", label: "Age" }))
  definition = updateField(definition, "name", { required: true })
  return updateField(definition, "age", { required: true })
}

describe("Effect integration", () => {
  it("validates an ordinary consumer object with a typed error channel", async () => {
    const program = normalizeSubmissionEffect(
      consumerDefinition,
      { name: "Ada", age: 21 },
      { mode: "json" },
    )

    expectTypeOf(program).toEqualTypeOf<
      Effect.Effect<Readonly<{ name: string; age: number }>, SubmissionValidationError>
    >()
    await expect(Effect.runPromise(program)).resolves.toEqual({ name: "Ada", age: 21 })
  })

  it("keeps invalid values as recoverable Effect failures", async () => {
    const result = await Effect.runPromise(
      Effect.either(
        normalizeSubmissionEffect(
          eligibilityDefinition(),
          { name: "Ada", age: "21" },
          { mode: "json" },
        ),
      ),
    )

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(InvalidSubmissionError)
      expect(result.left.issues).toContainEqual(
        expect.objectContaining({ code: "invalid_number", field: "age" }),
      )
    }
  })

  it("composes existing store implementations without changing their interface", async () => {
    const store = toEffectFormDefinitionStore(new MemoryFormDefinitionStore())
    const program = Effect.gen(function* () {
      yield* store.create("eligibility", eligibilityDefinition())
      yield* store.publish("eligibility", 0, "2026-08-12T12:00:00.000Z")
      return yield* store.getActive("eligibility")
    })

    await expect(Effect.runPromise(program)).resolves.toMatchObject({
      formId: "eligibility",
      version: 1,
    })
  })
})
