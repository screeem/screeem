import { describe, expect, it } from "vitest"
import {
  defineIntegrationAction,
  snapshotIntegrationActionCatalog,
  snapshotIntegrationType,
} from "../src/index.js"

describe("integration action definitions", () => {
  it("owns one immutable type and capability-derived action identity", () => {
    const definition = defineIntegrationAction({
      use: "crm.upsertLead",
      integrationType: snapshotIntegrationType("crm"),
      capability: "upsertLead",
      label: "Upsert CRM lead",
      description: "Create or update a lead.",
      inputs: [
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

    expect(definition.use).toBe("crm.upsertLead")
    expect(Object.isFrozen(definition)).toBe(true)
    expect(Object.isFrozen(definition.inputs)).toBe(true)
    expect(Object.isFrozen(definition.inputs[0]?.fieldControls)).toBe(true)
  })

  it("rejects a name that drifts from its type and capability", () => {
    expect(() => defineIntegrationAction({
      use: "salesforce.upsertLead",
      integrationType: snapshotIntegrationType("crm"),
      capability: "upsertLead",
      label: "Upsert CRM lead",
      description: "Create or update a lead.",
      inputs: [],
    })).toThrow("must match its type and capability")
  })

  it("rejects duplicate input names", () => {
    const input = {
      name: "email",
      label: "Email",
      required: true,
      fieldTypes: ["string"] as const,
      suggestedFieldNames: ["email"],
    }
    expect(() => defineIntegrationAction({
      use: "crm.upsertLead",
      integrationType: snapshotIntegrationType("crm"),
      capability: "upsertLead",
      label: "Upsert CRM lead",
      description: "Create or update a lead.",
      inputs: [input, input],
    })).toThrow("Duplicate integration action input")
  })

  it("rejects duplicate catalog actions and non-boolean requirements", () => {
    const action = defineIntegrationAction({
      use: "crm.upsertLead",
      integrationType: snapshotIntegrationType("crm"),
      capability: "upsertLead",
      label: "Upsert CRM lead",
      description: "Create or update a lead.",
      inputs: [],
    })
    expect(() => snapshotIntegrationActionCatalog([action, action])).toThrow(
      "Duplicate integration action",
    )
    expect(() => defineIntegrationAction({
      ...action,
      inputs: [{
        name: "email",
        label: "Email",
        required: "false" as unknown as boolean,
        fieldTypes: ["string"],
        suggestedFieldNames: ["email"],
      }],
    })).toThrow("input requirement")
  })
})
