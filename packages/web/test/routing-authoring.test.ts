import {
  addField,
  createField,
  createFormDefinition,
  removeField,
  updateField,
  type FormDefinition,
} from "@screeem/forms"
import { describe, expect, it } from "vitest"
import {
  defaultRoutingCondition,
  routingOperatorsForField,
  serializeVisualRouting,
  testVisualRouting,
  type VisualRoutingDraft,
} from "../src/lib/forms/routing-authoring"

describe("visual routing authoring", () => {
  it("offers operators that match the selected field type and optionality", () => {
    const definition = fixture()
    const employees = definition.fields.find((field) => field.id === "employees")!
    const note = definition.fields.find((field) => field.id === "note")!

    expect(routingOperatorsForField(employees).map(({ value }) => value)).toEqual([
      "equals",
      "not_equals",
      "greater_than",
      "greater_than_or_equal",
      "less_than",
      "less_than_or_equal",
    ])
    expect(routingOperatorsForField(note).map(({ value }) => value)).toEqual([
      "equals",
      "not_equals",
      "is_empty",
      "is_not_empty",
    ])
  })

  it("serializes field-aware conditions and guards optional values", () => {
    const definition = fixture()
    const result = serializeVisualRouting(definition, draft())

    expect(result).toMatchObject({
      ok: true,
      routing: {
        rules: [
          {
            when:
              '(submission.employees >= 500) && (submission.country === "UK") && (exists(submission.note) && submission.note !== "")',
          },
        ],
        fallback: "commercial",
      },
    })
  })

  it("uses stable field identity when a submission key is renamed", () => {
    const definition = updateField(fixture(), "employees", { name: "team_size" })
    const result = serializeVisualRouting(definition, draft())

    expect(result.ok && result.routing.rules[0]?.when).toContain("submission.team_size >= 500")
  })

  it("reports removed fields instead of emitting a stale expression", () => {
    const definition = removeField(fixture(), "country")
    const result = serializeVisualRouting(definition, draft())

    expect(result).toEqual({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({
          code: "missing_field",
          ruleId: "uk-enterprise",
          conditionId: "country-condition",
        }),
      ]),
    })
  })

  it("evaluates ordered rules and returns the fallback when none match", async () => {
    const definition = fixture()
    await expect(
      testVisualRouting(definition, draft(), {
        employees: 850,
        country: "UK",
        note: "Priority",
      }),
    ).resolves.toMatchObject({ route: "uk-enterprise", matchedRule: "uk-enterprise" })

    await expect(
      testVisualRouting(definition, draft(), {
        employees: 12,
        country: "US",
      }),
    ).resolves.toMatchObject({ route: "commercial", matchedRule: null })
  })

  it("creates a type-correct starting condition for every field", () => {
    for (const field of fixture().fields) {
      const condition = defaultRoutingCondition(field, `condition-${field.id}`)
      expect(serializeVisualRouting(fixture(), {
        rules: [{ id: `rule-${field.id}`, combinator: "all", conditions: [condition], route: "x" }],
        fallback: "fallback",
      }).ok).toBe(true)
    }
  })

  it("uses the shared routing contract for persistence limits", () => {
    const current = draft()
    const result = serializeVisualRouting(fixture(), {
      ...current,
      rules: current.rules.map((rule) => ({ ...rule, route: "x".repeat(257) })),
    })

    expect(result).toEqual({
      ok: false,
      issues: [expect.objectContaining({ code: "routing_route_limit" })],
    })
  })

  it("rejects sample values that the form would reject before routing them", async () => {
    let definition = fixture()
    definition = addField(
      definition,
      createField("email", { id: "email", name: "email", label: "Work email" }),
    )
    definition = updateField(definition, "email", { required: true })

    await expect(
      testVisualRouting(definition, draft(), {
        employees: 850,
        country: "UK",
        note: "Priority",
        email: "not-an-email",
      }),
    ).rejects.toMatchObject({
      code: "invalid_submission",
      issues: [expect.objectContaining({ code: "invalid_email", field: "email" })],
    })
  })
})

function fixture(): FormDefinition {
  let definition = createFormDefinition("Lead qualification")
  definition = addField(
    definition,
    createField("number", { id: "employees", name: "employees", label: "Employees" }),
  )
  definition = updateField(definition, "employees", { required: true })
  definition = addField(
    definition,
    createField("select", { id: "country", name: "country", label: "Country" }),
  )
  definition = updateField(definition, "country", { required: true, values: ["UK", "US"] })
  return addField(
    definition,
    createField("text", { id: "note", name: "note", label: "Note" }),
  )
}

function draft(): VisualRoutingDraft {
  return {
    rules: [
      {
        id: "uk-enterprise",
        combinator: "all",
        conditions: [
          {
            id: "employees-condition",
            fieldId: "employees",
            operator: "greater_than_or_equal",
            value: 500,
          },
          {
            id: "country-condition",
            fieldId: "country",
            operator: "equals",
            value: "UK",
          },
          {
            id: "note-condition",
            fieldId: "note",
            operator: "not_equals",
            value: "",
          },
        ],
        route: "uk-enterprise",
      },
    ],
    fallback: "commercial",
  }
}
