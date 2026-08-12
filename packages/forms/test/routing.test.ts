import { describe, expect, it } from "vitest"
import { createRouter, schemaFromForm } from "@screeem/routing"
import {
  MemoryFormDefinitionStore,
  addField,
  createField,
  createFormDefinition,
  compileFormRoutingDefinition,
  InvalidFormRoutingError,
  normalizeSubmission,
  type FormDefinition,
  snapshotFormRoutingDefinition,
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

  it("returns rule diagnostics when a persisted condition does not match the form schema", async () => {
    const definition = addField(
      createFormDefinition("No removed field"),
      createField("text", { id: "name", name: "name", label: "Name" }),
    )

    await expect(
      compileFormRoutingDefinition(definition, {
        version: 1,
        rules: [{ id: "removed-field", when: "submission.removed === true", route: "sales" }],
        fallback: "review",
      }),
    ).rejects.toMatchObject({
      code: "invalid_form_routing",
      issues: [expect.objectContaining({ code: "UnknownField", ruleId: "removed-field" })],
    })
  })

  it("rejects non-data and unknown routing properties before persistence", () => {
    const routing = {
      version: 1,
      rules: [{ id: "one", when: "true", route: "sales", extra: "unsafe" }],
      fallback: "review",
    }
    expect(() => snapshotFormRoutingDefinition(routing)).toThrow(InvalidFormRoutingError)

    const accessor = Object.create(null) as Record<string, unknown>
    Object.defineProperties(accessor, {
      version: { value: 1, enumerable: true },
      rules: { get: () => [], enumerable: true },
      fallback: { value: "review", enumerable: true },
    })
    expect(() => snapshotFormRoutingDefinition(accessor)).toThrow(InvalidFormRoutingError)
  })

  it("accepts routing strings at their persistence boundaries", () => {
    expect(() =>
      snapshotFormRoutingDefinition({
        version: 1,
        rules: [
          {
            id: "i".repeat(128),
            when: "w".repeat(4_096),
            route: "r".repeat(256),
            actions: [{ use: "a".repeat(128), with: "x".repeat(4_096) }],
          },
        ],
        fallback: "f".repeat(256),
      }),
    ).not.toThrow()
  })

  it.each([
    ["rule IDs", { id: "i".repeat(129) }, "routing_rule_id_limit"],
    ["conditions", { when: "w".repeat(4_097) }, "routing_expression_limit"],
    ["rule routes", { route: "r".repeat(257) }, "routing_route_limit"],
    ["action names", { actions: [{ use: "a".repeat(129) }] }, "routing_action_name_limit"],
    [
      "action inputs",
      { actions: [{ use: "notify", with: "x".repeat(4_097) }] },
      "routing_expression_limit",
    ],
  ])("rejects overlong %s", (_label, ruleOverride, code) => {
    const rule = {
      id: "qualified",
      when: "true",
      route: "sales",
      ...ruleOverride,
    }
    expect(() =>
      snapshotFormRoutingDefinition({
        version: 1,
        rules: [rule],
        fallback: "review",
      }),
    ).toThrow(expect.objectContaining({ issues: [expect.objectContaining({ code })] }))
  })

  it("rejects an overlong fallback route", () => {
    expect(() =>
      snapshotFormRoutingDefinition({
        version: 1,
        rules: [],
        fallback: "f".repeat(257),
      }),
    ).toThrow(
      expect.objectContaining({
        issues: [expect.objectContaining({ code: "routing_route_limit", path: "fallback" })],
      }),
    )
  })
})
