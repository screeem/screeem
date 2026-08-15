import { describe, expect, it } from "vitest"
import {
  InvalidFormRoutingError,
  MemoryFormDefinitionStore,
  addField,
  createField,
  createFormDefinition,
  createRoutingCondition,
  createRoutingSample,
  defineIntegrationAction,
  generateFormRoutingDefinition,
  routingOperatorsForField,
  routingAuthoringMatchesDefinition,
  snapshotFormRoutingAuthoring,
  snapshotFormRoutingDefinition,
  snapshotIntegrationType,
  testFormRouting,
  updateField,
  type FormDefinition,
  type FormRoutingAuthoring,
} from "../src/index.js"

describe("routing authoring", () => {
  it("offers operators that match field type and optionality", () => {
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

  it("generates field-aware expressions and retains immutable authoring source", () => {
    const result = generateFormRoutingDefinition(fixture(), authoring())

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
        authoring: authoring(),
      },
    })
    if (!result.ok) throw new Error("Expected generated routing")
    expect(Object.isFrozen(result.routing.authoring?.rules)).toBe(true)
  })

  it("regenerates expressions from stable field IDs after a submission key rename", () => {
    const definition = updateField(fixture(), "employees", { name: "team_size" })
    const result = generateFormRoutingDefinition(definition, authoring())

    expect(result.ok && result.routing.rules[0]?.when).toContain("submission.team_size >= 500")
  })

  it("generates ordered integration actions from stable field mappings", () => {
    const result = generateFormRoutingDefinition(
      actionFixture(),
      authoringWithAction(),
      [crmAction],
    )

    expect(result.ok && result.routing.rules[0]?.actions).toEqual([
      {
        use: "crm.upsertLead",
        with:
          '({ "lastName": submission.last_name, "company": submission.company, "email": submission.email })',
      },
    ])
  })

  it("regenerates action input expressions after a mapped field rename", () => {
    const definition = updateField(actionFixture(), "last-name", { name: "surname" })
    const result = generateFormRoutingDefinition(
      definition,
      authoringWithAction(),
      [crmAction],
    )

    expect(result.ok && result.routing.rules[0]?.actions?.[0]?.with).toContain(
      "submission.surname",
    )
  })

  it("rejects missing, optional, or incompatible mapped action fields", () => {
    const optional = updateField(actionFixture(), "company", { required: false })
    const optionalResult = generateFormRoutingDefinition(
      optional,
      authoringWithAction(),
      [crmAction],
    )
    expect(optionalResult).toMatchObject({
      ok: false,
      issues: [expect.objectContaining({ code: "incompatible_action_field", inputName: "company" })],
    })

    const missing = generateFormRoutingDefinition(
      fixture(),
      authoringWithAction(),
      [crmAction],
    )
    expect(missing).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "missing_action_field", inputName: "lastName" }),
      ]),
    })

    const incompatible = authoringWithAction()
    const rule = incompatible.rules[0]!
    const action = rule.actions![0]!
    const incompatibleResult = generateFormRoutingDefinition(
      actionFixture(),
      {
        ...incompatible,
        rules: [{
          ...rule,
          actions: [{
            ...action,
            inputs: action.inputs.map((input) =>
              input.input === "email"
                ? { ...input, fieldId: "company" }
                : input,
            ),
          }],
        }],
      },
      [crmAction],
    )
    expect(incompatibleResult).toMatchObject({
      ok: false,
      issues: [expect.objectContaining({ code: "incompatible_action_field", inputName: "email" })],
    })
  })

  it("detects runtime action tampering against visual authoring", () => {
    const generated = generateFormRoutingDefinition(
      actionFixture(),
      authoringWithAction(),
      [crmAction],
    )
    if (!generated.ok) throw new Error("Expected generated action routing")

    expect(
      routingAuthoringMatchesDefinition(actionFixture(), generated.routing, [crmAction]),
    ).toBe(true)
    expect(
      routingAuthoringMatchesDefinition(
        actionFixture(),
        {
          ...generated.routing,
          rules: generated.routing.rules.map((rule) => ({
            ...rule,
            actions: [{ use: "crm.upsertLead", with: "({ email: submission.email })" }],
          })),
        },
        [crmAction],
      ),
    ).toBe(false)
  })

  it("round-trips visual source through draft and publication storage", async () => {
    const generated = generateFormRoutingDefinition(fixture(), authoring())
    if (!generated.ok) throw new Error("Expected generated routing")
    const store = new MemoryFormDefinitionStore()
    await store.create("lead", fixture())
    const draft = await store.saveRoutingDraft("lead", 0, generated.routing)
    const published = await store.publish("lead", draft.revision, "2026-08-12T00:00:00.000Z")

    expect((await store.getDraft("lead")).routing?.authoring).toEqual(authoring())
    expect(published.routing?.authoring).toEqual(authoring())
  })

  it("accepts expression-only routing without visual authoring source", () => {
    expect(
      snapshotFormRoutingDefinition({
        version: 1,
        rules: [{ id: "expression-rule", when: "true", route: "sales" }],
        fallback: "review",
      }),
    ).toEqual({
      version: 1,
      rules: [{ id: "expression-rule", when: "true", route: "sales" }],
      fallback: "review",
    })
  })

  it("does not present mismatched editable source as the stored runtime", () => {
    const generated = generateFormRoutingDefinition(fixture(), authoring())
    if (!generated.ok) throw new Error("Expected generated routing")

    expect(routingAuthoringMatchesDefinition(fixture(), generated.routing)).toBe(true)
    expect(
      routingAuthoringMatchesDefinition(fixture(), {
        ...generated.routing,
        fallback: "different-runtime-destination",
      }),
    ).toBe(false)
  })

  it("rejects unknown, accessor, duplicate, and over-limit visual source", () => {
    expect(() => snapshotFormRoutingAuthoring({ ...authoring(), extra: true })).toThrow(
      InvalidFormRoutingError,
    )

    const accessor = Object.create(null) as Record<string, unknown>
    Object.defineProperties(accessor, {
      version: { value: 1, enumerable: true },
      rules: { get: () => [], enumerable: true },
      fallback: { value: "review", enumerable: true },
    })
    expect(() => snapshotFormRoutingAuthoring(accessor)).toThrow(InvalidFormRoutingError)

    const duplicateCondition = authoring()
    expect(() =>
      snapshotFormRoutingAuthoring({
        ...duplicateCondition,
        rules: [
          {
            ...duplicateCondition.rules[0],
            conditions: [
              duplicateCondition.rules[0]!.conditions[0],
              duplicateCondition.rules[0]!.conditions[0],
            ],
          },
        ],
      }),
    ).toThrow(
      expect.objectContaining({
        issues: [expect.objectContaining({ code: "duplicate_condition_id" })],
      }),
    )

    expect(() =>
      snapshotFormRoutingAuthoring({
        version: 1,
        rules: Array.from({ length: 101 }, (_, index) => ({
          id: `rule-${index}`,
          combinator: "all",
          conditions: [
            { id: `condition-${index}`, fieldId: "employees", operator: "equals", value: 1 },
          ],
          route: "sales",
        })),
        fallback: "review",
      }),
    ).toThrow(
      expect.objectContaining({ issues: [expect.objectContaining({ code: "routing_rule_limit" })] }),
    )

    const oversizedValue = authoring()
    expect(() =>
      snapshotFormRoutingAuthoring({
        ...oversizedValue,
        rules: oversizedValue.rules.map((rule) => ({
          ...rule,
          conditions: rule.conditions.map((condition, index) =>
            index === 0 ? { ...condition, value: "x".repeat(1_025) } : condition,
          ),
        })),
      }),
    ).toThrow(
      expect.objectContaining({
        issues: [expect.objectContaining({ code: "routing_condition_value_limit" })],
      }),
    )

    const withAction = authoringWithAction()
    expect(() => snapshotFormRoutingAuthoring({
      ...withAction,
      rules: withAction.rules.map((rule) => ({
        ...rule,
        actions: [rule.actions![0]!, rule.actions![0]!],
      })),
    })).toThrow(
      expect.objectContaining({
        issues: [expect.objectContaining({ code: "duplicate_action_id" })],
      }),
    )
  })

  it("rejects invalid form values before testing routing", async () => {
    let definition = fixture()
    definition = addField(
      definition,
      createField("email", { id: "email", name: "email", label: "Work email" }),
    )
    definition = updateField(definition, "email", { required: true })

    await expect(
      testFormRouting(definition, authoring(), {
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

  it("creates a valid starting condition for every field", () => {
    for (const field of fixture().fields) {
      const condition = createRoutingCondition(field, `condition-${field.id}`)
      expect(
        generateFormRoutingDefinition(fixture(), {
          version: 1,
          rules: [
            {
              id: `rule-${field.id}`,
              combinator: "all",
              conditions: [condition],
              route: "x",
            },
          ],
          fallback: "fallback",
        }).ok,
      ).toBe(true)
    }
  })

  it("uses a number field maximum when no minimum is configured", () => {
    let definition = createFormDefinition("Zero maximum")
    definition = addField(
      definition,
      createField("number", { id: "score", name: "score", label: "Score" }),
    )
    definition = updateField(definition, "score", { required: true, validation: { max: 0 } })

    expect(createRoutingSample(definition)).toEqual({ score: 0 })
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

function authoring(): FormRoutingAuthoring {
  return {
    version: 1,
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

function actionFixture(): FormDefinition {
  let definition = fixture()
  for (const [control, id, name, label] of [
    ["text", "last-name", "last_name", "Last name"],
    ["text", "company", "company", "Company"],
    ["email", "email", "email", "Email"],
  ] as const) {
    definition = addField(definition, createField(control, { id, name, label }))
    definition = updateField(definition, id, { required: true })
  }
  return definition
}

function authoringWithAction(): FormRoutingAuthoring {
  const source = authoring()
  return {
    ...source,
    rules: source.rules.map((rule) => ({
      ...rule,
      actions: [
        {
          id: "action-1",
          use: "crm.upsertLead",
          inputs: [
            { input: "lastName", fieldId: "last-name" },
            { input: "company", fieldId: "company" },
            { input: "email", fieldId: "email" },
          ],
        },
      ],
    })),
  }
}

const crmAction = defineIntegrationAction({
  use: "crm.upsertLead",
  integrationType: snapshotIntegrationType("crm"),
  capability: "upsertLead",
  label: "Upsert CRM lead",
  description: "Create or update a CRM lead.",
  inputs: [
    {
      name: "lastName",
      label: "Last name",
      required: true,
      fieldTypes: ["string"],
      fieldControls: ["text"],
      suggestedFieldNames: ["last_name"],
    },
    {
      name: "company",
      label: "Company",
      required: true,
      fieldTypes: ["string"],
      fieldControls: ["text"],
      suggestedFieldNames: ["company"],
    },
    {
      name: "email",
      label: "Email",
      required: true,
      fieldTypes: ["string"],
      fieldControls: ["email"],
      suggestedFieldNames: ["email"],
    },
  ],
})
