import { describe, expect, it } from "vitest"
import {
  addField,
  applyBuilderDefinition,
  createBuilderState,
  createField,
  createFormDefinition,
  duplicateField,
  InvalidFormDefinitionError,
  markBuilderSaved,
  moveField,
  redoBuilder,
  removeField,
  snapshotFormDefinition,
  suggestFieldName,
  undoBuilder,
  updateField,
} from "../src/index.js"

describe("form definitions", () => {
  it("builds a routing-compatible plain definition with stable field identity", () => {
    const definition = addField(
      createFormDefinition("Lead qualification"),
      createField("number", { id: "fld_employees", label: "Employees" }),
    )

    expect(definition.fields[0]).toMatchObject({
      id: "fld_employees",
      name: "employees",
      type: "number",
      control: "number",
      required: false,
    })
    expect(Object.isFrozen(definition.fields)).toBe(true)
  })

  it("creates safe unique names without exposing prototype properties", () => {
    expect(suggestFieldName("Company name", ["company_name"])).toBe("company_name_2")
    expect(suggestFieldName("constructor")).toBe("field_constructor")
    expect(suggestFieldName("123")).toBe("field_123")
  })

  it("edits, duplicates, moves, and removes fields without mutating prior definitions", () => {
    const first = addField(
      createFormDefinition("Eligibility"),
      createField("number", { id: "age", label: "Age" }),
    )
    const second = addField(first, createField("select", { id: "country", label: "Country" }))
    const updated = updateField(second, "age", { required: true })
    const duplicated = duplicateField(updated, "age", "age_copy")
    const moved = moveField(duplicated, "country", 0)
    const removed = removeField(moved, "age_copy")

    expect(first.fields).toHaveLength(1)
    expect(updated.fields[0]?.required).toBe(true)
    expect(duplicated.fields.map((field) => field.id)).toEqual(["age", "age_copy", "country"])
    expect(moved.fields[0]?.id).toBe("country")
    expect(removed.fields.map((field) => field.id)).toEqual(["country", "age"])
  })

  it("rejects duplicate and unsafe field names", () => {
    const base = createFormDefinition("Unsafe")
    const field = createField("text", { id: "one", label: "Name" })
    expect(() =>
      snapshotFormDefinition({ ...base, fields: [field, { ...field, id: "two" }] }),
    ).toThrow(InvalidFormDefinitionError)
    expect(() =>
      snapshotFormDefinition({ ...base, fields: [{ ...field, name: "toString" }] }),
    ).not.toThrow()
    expect(() =>
      snapshotFormDefinition({ ...base, fields: [{ ...field, name: "constructor" }] }),
    ).toThrow(InvalidFormDefinitionError)
  })

  it("rejects accessors without evaluating them", () => {
    let accessed = false
    const input = createFormDefinition("Accessors") as unknown as Record<string, unknown>
    const field = Object.create(null) as Record<string, unknown>
    Object.assign(field, createField("text", { id: "name", label: "Name" }))
    Object.defineProperty(field, "label", {
      enumerable: true,
      get() {
        accessed = true
        return "Name"
      },
    })

    expect(() => snapshotFormDefinition({ ...input, fields: [field] })).toThrow(
      InvalidFormDefinitionError,
    )
    expect(accessed).toBe(false)
  })

  it("returns domain validation for hostile proxy traps", () => {
    const revoked = Proxy.revocable({}, {})
    revoked.revoke()

    expect(() => snapshotFormDefinition(revoked.proxy)).toThrow(InvalidFormDefinitionError)
    expect(() =>
      snapshotFormDefinition(
        new Proxy(createFormDefinition("Hostile"), {
          ownKeys() {
            throw new Error("hostile ownKeys trap")
          },
        }),
      ),
    ).toThrow(InvalidFormDefinitionError)
  })

  it("does not execute overridden array methods while reading enum values", () => {
    let methodCalls = 0
    const values = ["UK", "US"]
    Object.defineProperty(values, "forEach", {
      value() {
        methodCalls += 1
        throw new Error("must not execute")
      },
    })
    const definition = addField(createFormDefinition("Markets"), {
      id: "country",
      name: "country",
      label: "Country",
      required: false,
      type: "enum",
      control: "select",
      values,
    })

    expect(definition.fields[0]).toMatchObject({ values: ["UK", "US"] })
    expect(methodCalls).toBe(0)
  })

  it("requires a field only when validating for publication", () => {
    const definition = createFormDefinition("Draft")
    expect(snapshotFormDefinition(definition)).toEqual(definition)
    expect(() => snapshotFormDefinition(definition, { publishable: true })).toThrow(
      InvalidFormDefinitionError,
    )
  })
})

describe("builder history", () => {
  it("supports deterministic undo and redo around immutable definitions", () => {
    const initial = createFormDefinition("Lead form")
    const next = addField(initial, createField("email", { id: "email", label: "Email" }))
    const edited = applyBuilderDefinition(createBuilderState(initial, 3), next, "email")
    const undone = undoBuilder(edited)
    const redone = redoBuilder(undone)

    expect(edited.dirty).toBe(true)
    expect(undone.definition.fields).toHaveLength(0)
    expect(redone.definition.fields[0]?.id).toBe("email")
    expect(redone.baseRevision).toBe(3)
  })

  it("does not create history or dirty state for an unchanged definition", () => {
    const definition = addField(
      createFormDefinition("Lead form"),
      createField("email", { id: "email", label: "Email" }),
    )
    const initial = createBuilderState(definition, 3)
    const unchanged = applyBuilderDefinition(initial, {
      ...definition,
      fields: [...definition.fields],
    })

    expect(unchanged).toBe(initial)
    expect(unchanged.past).toHaveLength(0)
    expect(unchanged.dirty).toBe(false)

    const selected = applyBuilderDefinition(unchanged, definition, "email")
    expect(selected.selectedFieldId).toBe("email")
    expect(selected.past).toHaveLength(0)
    expect(selected.dirty).toBe(false)
  })

  it("advances the revision without losing edits made while a save was in flight", () => {
    const initial = createFormDefinition("Lead form")
    const submitted = addField(initial, createField("email", { id: "email", label: "Email" }))
    const saving = applyBuilderDefinition(createBuilderState(initial, 3), submitted)
    const editedAgain = applyBuilderDefinition(
      saving,
      addField(submitted, createField("number", { id: "employees", label: "Employees" })),
    )
    const acknowledged = markBuilderSaved(editedAgain, 4, submitted)

    expect(acknowledged.baseRevision).toBe(4)
    expect(acknowledged.dirty).toBe(true)
    expect(acknowledged.definition.fields.map((field) => field.id)).toEqual([
      "email",
      "employees",
    ])
  })
})
