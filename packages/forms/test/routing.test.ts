import { describe, expect, it } from "vitest"
import { createRouter, schemaFromForm } from "@screeem/routing"
import {
  MemoryFormDefinitionStore,
  addField,
  createField,
  createFormDefinition,
  normalizeSubmission,
  type FormDefinition,
  updateField,
} from "../src/index.js"

describe("routing integration", () => {
  it("uses the published form definition and normalized values without an adapter schema", async () => {
    let definition = createFormDefinition("Eligibility")
    definition = addField(definition, createField("text", { id: "name", label: "Name" }))
    definition = addField(definition, createField("number", { id: "age", label: "Age" }))
    definition = updateField(definition, "name", { required: true })
    definition = updateField(definition, "age", { required: true })

    const store = new MemoryFormDefinitionStore()
    await store.create("eligibility", definition)
    const published = await store.publish("eligibility", 0, "2026-08-12T12:00:00.000Z")
    const schema = schemaFromForm(published.definition)
    const routing = await createRouter().compile({
      version: 1,
      schema,
      rules: [{ id: "adult", when: "submission.age >= 18", route: "allow" }],
      fallback: "deny",
    })
    const submission = normalizeSubmission(
      published.definition,
      { name: "Ada", age: 21 },
      { mode: "json" },
    )

    await expect(routing.run(submission)).resolves.toMatchObject({
      route: "allow",
      matchedRule: "adult",
    })
  })

  it("accepts a consumer-created plain definition and submission end to end", async () => {
    const consumerDefinition = {
      formatVersion: 1,
      title: "Sales enquiry",
      submitLabel: "Send",
      successMessage: "Thanks",
      fields: [
        {
          id: "employees",
          name: "employees",
          label: "Employees",
          required: true,
          type: "number",
          control: "number",
        },
        {
          id: "country",
          name: "country",
          label: "Country",
          required: true,
          type: "enum",
          control: "select",
          values: ["UK", "US"],
        },
      ],
    } as const satisfies FormDefinition
    const routing = await createRouter().compile({
      version: 1,
      schema: schemaFromForm(consumerDefinition),
      rules: [
        {
          id: "uk-enterprise",
          when: `submission.employees >= 500 && submission.country === "UK"`,
          route: "sales",
        },
      ],
      fallback: "self-serve",
    })
    const values = normalizeSubmission(
      consumerDefinition,
      { employees: "750", country: "UK" },
      { mode: "form" },
    )

    await expect(routing.run(values)).resolves.toMatchObject({
      route: "sales",
      matchedRule: "uk-enterprise",
    })
  })
})
