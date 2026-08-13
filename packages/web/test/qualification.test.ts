import { describe, expect, it } from "vitest"
import {
  addField,
  createField,
  createFormDefinition,
  generateFormRoutingDefinition,
  updateField,
} from "@screeem/forms"
import { qualifySubmission } from "../src/lib/forms/qualification"

describe("submission qualification", () => {
  const definition = updateField(
    addField(
      createFormDefinition("Demo request"),
      createField("number", { id: "employees", name: "employees", label: "Employees" }),
    ),
    "employees",
    { required: true },
  )
  const generated = generateFormRoutingDefinition(definition, {
    version: 1,
    rules: [{
      id: "enterprise",
      combinator: "all",
      conditions: [{
        id: "large-team",
        fieldId: "employees",
        operator: "greater_than_or_equal",
        value: 250,
      }],
      route: "book-meeting",
    }],
    fallback: "nurture",
  })
  if (!generated.ok) throw new Error("Fixture routing must compile")

  it("returns the first matching qualification route", async () => {
    await expect(
      qualifySubmission(definition, generated.routing, { employees: 500 }),
    ).resolves.toEqual({ route: "book-meeting", matchedRule: "enterprise" })
  })

  it("returns the fallback for an unqualified submission", async () => {
    await expect(
      qualifySubmission(definition, generated.routing, { employees: 10 }),
    ).resolves.toEqual({ route: "nurture", matchedRule: null })
  })

  it("does nothing when the publication has no workflow", async () => {
    await expect(qualifySubmission(definition, null, { employees: 500 })).resolves.toBeNull()
  })
})
