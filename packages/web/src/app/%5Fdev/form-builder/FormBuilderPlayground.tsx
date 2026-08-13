"use client"

import {
  addField,
  applyBuilderDefinition,
  createBuilderState,
  createField,
  createFormDefinition,
  createRoutingCondition,
  duplicateField,
  generateFormRoutingDefinition,
  markBuilderSaved,
  maximumRoutingAuthoringRules,
  maximumRoutingConditionsPerRule,
  MemoryFormDefinitionStore,
  moveField,
  redoBuilder,
  removeField,
  selectBuilderField,
  undoBuilder,
  updateField,
  updateForm,
  type BuilderState,
  type FieldControl,
  type FormDefinition,
  type FormFieldDefinition,
  type FormRoutingAuthoring,
  type FormRoutingAuthoringRule,
  type FormRoutingCondition,
  type FormRoutingDefinition,
} from "@screeem/forms"
import Link from "next/link"
import { useMemo, useRef, useState } from "react"
import { DraggableField } from "../../../components/forms/DraggableField"
import { RoutingEditor } from "../../../components/forms/RoutingEditor"

type View = "builder" | "routing" | "preview" | "definition"
type Fixture = "lead" | "contact" | "eligibility"

const controls: readonly { control: FieldControl; label: string }[] = [
  { control: "text", label: "Short text" },
  { control: "email", label: "Email" },
  { control: "textarea", label: "Long answer" },
  { control: "number", label: "Number" },
  { control: "checkbox", label: "Checkbox" },
  { control: "select", label: "Single select" },
]

const fixtures: readonly { id: Fixture; label: string }[] = [
  { id: "lead", label: "Lead qualification" },
  { id: "contact", label: "Contact request" },
  { id: "eligibility", label: "Programme eligibility" },
]

function createLeadQualificationFixture(): FormDefinition {
  let definition = updateForm(createFormDefinition("Request an enterprise demo"), {
    description:
      "Tell us about your team and goals. We’ll route your request to the right specialist.",
    submitLabel: "Request a demo",
    successMessage: "Thanks — a specialist will be in touch within one business day.",
  })

  const fixtureFields: readonly [
    FieldControl,
    string,
    string,
    string,
    Readonly<Record<string, unknown>>,
  ][] = [
    ["text", "full-name", "Full name", "name", { required: true, placeholder: "Ada Lovelace" }],
    [
      "email",
      "work-email",
      "Work email",
      "email",
      { required: true, placeholder: "ada@analytical.co" },
    ],
    [
      "number",
      "employee-count",
      "Number of employees",
      "employees",
      { required: true, validation: { min: 1, max: 100_000 } },
    ],
    [
      "select",
      "country",
      "Company location",
      "country",
      { required: true, values: ["UK", "US", "Germany", "Other"] },
    ],
    [
      "textarea",
      "priority",
      "What would you like to improve?",
      "priority",
      { description: "A sentence or two helps us prepare.", validation: { maxLength: 500 } },
    ],
    ["checkbox", "follow-up", "I’m happy to receive product updates", "product_updates", {}],
  ]

  for (const [control, id, label, name, update] of fixtureFields) {
    const field = createField(control, { id, label, name })
    definition = addField(definition, field)
    definition = updateField(definition, id, update)
  }

  return definition
}

function createContactFixture(): FormDefinition {
  let definition = updateForm(createFormDefinition("Talk to our team"), {
    description: "Share a little context and we’ll make sure the right person replies.",
    submitLabel: "Send request",
  })
  for (const [control, id, label, name, update] of [
    ["text", "contact-name", "Your name", "name", { required: true }],
    ["email", "contact-email", "Email address", "email", { required: true }],
    [
      "select",
      "contact-topic",
      "What can we help with?",
      "topic",
      { required: true, values: ["Sales", "Support", "Partnership", "Other"] },
    ],
    ["textarea", "contact-message", "Message", "message", { required: true }],
  ] as const) {
    definition = addField(definition, createField(control, { id, label, name }))
    definition = updateField(definition, id, update)
  }
  return definition
}

function createEligibilityFixture(): FormDefinition {
  let definition = updateForm(createFormDefinition("Growth programme eligibility"), {
    description: "Check whether your organisation meets the initial programme criteria.",
    submitLabel: "Check eligibility",
  })
  for (const [control, id, label, name, update] of [
    ["text", "organisation", "Organisation name", "organisation", { required: true }],
    [
      "number",
      "team-size",
      "Current team size",
      "employees",
      { required: true, validation: { min: 1, max: 10_000 } },
    ],
    [
      "select",
      "operating-country",
      "Primary operating country",
      "country",
      { required: true, values: ["UK", "Ireland", "France", "Germany"] },
    ],
    [
      "checkbox",
      "trading-status",
      "The organisation is currently trading",
      "currently_trading",
      { required: true },
    ],
  ] as const) {
    definition = addField(definition, createField(control, { id, label, name }))
    definition = updateField(definition, id, update)
  }
  return definition
}

function createFixture(fixture: Fixture): FormDefinition {
  switch (fixture) {
    case "lead":
      return createLeadQualificationFixture()
    case "contact":
      return createContactFixture()
    case "eligibility":
      return createEligibilityFixture()
  }
}

function createRoutingFixture(fixture: Fixture): FormRoutingAuthoring {
  switch (fixture) {
    case "lead":
      return {
        version: 1,
        rules: [
          {
            id: "uk-enterprise",
            combinator: "all",
            conditions: [
              {
                id: "lead-employees",
                fieldId: "employee-count",
                operator: "greater_than_or_equal",
                value: 500,
              },
              {
                id: "lead-country-uk",
                fieldId: "country",
                operator: "equals",
                value: "UK",
              },
            ],
            route: "uk-enterprise",
          },
          {
            id: "us-enterprise",
            combinator: "all",
            conditions: [
              {
                id: "lead-us-employees",
                fieldId: "employee-count",
                operator: "greater_than_or_equal",
                value: 500,
              },
              {
                id: "lead-country-us",
                fieldId: "country",
                operator: "equals",
                value: "US",
              },
            ],
            route: "us-enterprise",
          },
        ],
        fallback: "commercial",
      }
    case "contact":
      return {
        version: 1,
        rules: [
          {
            id: "support",
            combinator: "all",
            conditions: [
              {
                id: "contact-support",
                fieldId: "contact-topic",
                operator: "equals",
                value: "Support",
              },
            ],
            route: "support",
          },
          {
            id: "partnerships",
            combinator: "all",
            conditions: [
              {
                id: "contact-partnership",
                fieldId: "contact-topic",
                operator: "equals",
                value: "Partnership",
              },
            ],
            route: "partnerships",
          },
        ],
        fallback: "sales",
      }
    case "eligibility":
      return {
        version: 1,
        rules: [
          {
            id: "eligible",
            combinator: "all",
            conditions: [
              {
                id: "eligibility-size",
                fieldId: "team-size",
                operator: "greater_than_or_equal",
                value: 10,
              },
              {
                id: "eligibility-country",
                fieldId: "operating-country",
                operator: "equals",
                value: "UK",
              },
              {
                id: "eligibility-trading",
                fieldId: "trading-status",
                operator: "equals",
                value: true,
              },
            ],
            route: "eligible",
          },
        ],
        fallback: "review",
      }
  }
}

export function FormBuilderPlayground() {
  const [builder, setBuilder] = useState(() =>
    selectBuilderField(createBuilderState(createLeadQualificationFixture()), "full-name"),
  )
  const [view, setView] = useState<View>("builder")
  const [fixture, setFixture] = useState<Fixture>("lead")
  const [routing, setRouting] = useState<FormRoutingAuthoring>(() => createRoutingFixture("lead"))
  const [routingDirty, setRoutingDirty] = useState(true)
  const [message, setMessage] = useState<string | null>(null)
  const [persistenceStatus, setPersistenceStatus] = useState("Not saved")
  const idCounter = useRef(100)
  const routingIdCounter = useRef(100)
  const storeRef = useRef(new MemoryFormDefinitionStore())
  const storeCreatedRef = useRef(false)

  const selectedField = useMemo(
    () => builder.definition.fields.find((field) => field.id === builder.selectedFieldId) ?? null,
    [builder.definition.fields, builder.selectedFieldId],
  )

  function commit(
    edit: (definition: FormDefinition) => FormDefinition,
    selectedFieldId = builder.selectedFieldId,
  ) {
    try {
      setBuilder((current) =>
        applyBuilderDefinition(current, edit(current.definition), selectedFieldId),
      )
      setMessage(null)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "That change is not valid.")
    }
  }

  function addControl(control: FieldControl) {
    const id = `playground-field-${idCounter.current++}`
    commit((definition) => {
      const field = createField(
        control,
        { id },
        definition.fields.map((item) => item.name),
      )
      return addField(definition, field)
    }, id)
  }

  function selectField(fieldId: string) {
    setBuilder((current) => selectBuilderField(current, fieldId))
    setMessage(null)
  }

  function editSelected(update: Readonly<Record<string, unknown>>) {
    if (!builder.selectedFieldId) return
    commit(
      (definition) => updateField(definition, builder.selectedFieldId as string, update),
      builder.selectedFieldId,
    )
  }

  function duplicateSelected() {
    if (!selectedField) return
    const id = `playground-field-${idCounter.current++}`
    commit((definition) => duplicateField(definition, selectedField.id, id), id)
  }

  function removeSelected() {
    if (!selectedField) return
    const currentIndex = builder.definition.fields.findIndex(
      (field) => field.id === selectedField.id,
    )
    const nextSelection =
      builder.definition.fields[currentIndex + 1]?.id ??
      builder.definition.fields[currentIndex - 1]?.id ??
      null
    commit((definition) => removeField(definition, selectedField.id), nextSelection)
  }

  function moveSelected(offset: number) {
    if (!selectedField) return
    const currentIndex = builder.definition.fields.findIndex(
      (field) => field.id === selectedField.id,
    )
    commit(
      (definition) => moveField(definition, selectedField.id, currentIndex + offset),
      selectedField.id,
    )
  }

  function reorderField(fieldId: string, targetIndex: number) {
    commit((definition) => moveField(definition, fieldId, targetIndex), fieldId)
  }

  function commitRouting(edit: (current: FormRoutingAuthoring) => FormRoutingAuthoring) {
    setRouting((current) => edit(current))
    setRoutingDirty(true)
    setMessage(null)
  }

  function addRoutingRule() {
    if (routing.rules.length >= maximumRoutingAuthoringRules) {
      setMessage("Routing supports up to 100 rules.")
      return
    }
    const field = builder.definition.fields[0]
    if (!field) {
      setMessage("Add a form field before creating a routing rule.")
      return
    }
    const number = routingIdCounter.current++
    commitRouting((current) => ({
      ...current,
      rules: [
        ...current.rules,
        {
          id: `rule-${number}`,
          combinator: "all",
          conditions: [createRoutingCondition(field, `condition-${number}`)],
          route: "new-route",
        },
      ],
    }))
  }

  function updateRoutingRule(ruleId: string, update: Partial<FormRoutingAuthoringRule>) {
    commitRouting((current) => ({
      ...current,
      rules: current.rules.map((rule) => (rule.id === ruleId ? { ...rule, ...update } : rule)),
    }))
  }

  function removeRoutingRule(ruleId: string) {
    commitRouting((current) => ({
      ...current,
      rules: current.rules.filter((rule) => rule.id !== ruleId),
    }))
  }

  function reorderRoutingRule(ruleId: string, targetIndex: number) {
    commitRouting((current) => {
      const sourceIndex = current.rules.findIndex((rule) => rule.id === ruleId)
      if (sourceIndex < 0) return current
      const rules = [...current.rules]
      const [rule] = rules.splice(sourceIndex, 1)
      if (!rule) return current
      rules.splice(Math.max(0, Math.min(targetIndex, rules.length)), 0, rule)
      return { ...current, rules }
    })
  }

  function addRoutingCondition(ruleId: string) {
    const field = builder.definition.fields[0]
    if (!field) return
    const rule = routing.rules.find((candidate) => candidate.id === ruleId)
    if (!rule || rule.conditions.length >= maximumRoutingConditionsPerRule) {
      setMessage("A routing rule supports up to 20 conditions.")
      return
    }
    const id = `condition-${routingIdCounter.current++}`
    commitRouting((current) => ({
      ...current,
      rules: current.rules.map((rule) =>
        rule.id === ruleId
          ? { ...rule, conditions: [...rule.conditions, createRoutingCondition(field, id)] }
          : rule,
      ),
    }))
  }

  function updateRoutingCondition(
    ruleId: string,
    conditionId: string,
    update: Partial<FormRoutingCondition>,
  ) {
    commitRouting((current) => ({
      ...current,
      rules: current.rules.map((rule) =>
        rule.id === ruleId
          ? {
              ...rule,
              conditions: rule.conditions.map((condition) =>
                condition.id === conditionId ? { ...condition, ...update } : condition,
              ),
            }
          : rule,
      ),
    }))
  }

  function removeRoutingCondition(ruleId: string, conditionId: string) {
    commitRouting((current) => ({
      ...current,
      rules: current.rules.map((rule) =>
        rule.id === ruleId
          ? {
              ...rule,
              conditions: rule.conditions.filter((condition) => condition.id !== conditionId),
            }
          : rule,
      ),
    }))
  }

  function changeFixture(nextFixture: Fixture) {
    const definition = createFixture(nextFixture)
    setFixture(nextFixture)
    setBuilder(selectBuilderField(createBuilderState(definition), definition.fields[0]?.id ?? null))
    setRouting(createRoutingFixture(nextFixture))
    setRoutingDirty(true)
    storeRef.current = new MemoryFormDefinitionStore()
    storeCreatedRef.current = false
    setPersistenceStatus("Not saved")
    setMessage(null)
  }

  async function saveDraftSimulation() {
    try {
      const serialized = generateFormRoutingDefinition(builder.definition, routing)
      if (!serialized.ok) {
        setMessage(serialized.issues[0]?.message ?? "Routing is incomplete.")
        return null
      }

      let revision = builder.baseRevision
      if (!storeCreatedRef.current) {
        const record = await storeRef.current.create("playground-form", builder.definition)
        storeCreatedRef.current = true
        revision = record.draft.revision
        setBuilder((current) => markBuilderSaved(current, revision))
      } else if (builder.dirty) {
        const draft = await storeRef.current.saveDraft(
          "playground-form",
          revision,
          builder.definition,
        )
        revision = draft.revision
        setBuilder((current) => markBuilderSaved(current, revision))
      }

      // Field key changes alter generated expressions even when the visual rule did not change.
      if (routingDirty || builder.dirty) {
        const draft = await storeRef.current.saveRoutingDraft(
          "playground-form",
          revision,
          serialized.routing,
        )
        revision = draft.revision
        setRoutingDirty(false)
        setBuilder((current) => markBuilderSaved(current, revision))
      }

      setPersistenceStatus(
        builder.dirty || routingDirty
          ? `Draft saved · revision ${revision}`
          : `Draft unchanged · revision ${revision}`,
      )
      setMessage(null)
      return revision
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The draft could not be saved.")
      return null
    }
  }

  async function publishSimulation() {
    const revision = await saveDraftSimulation()
    if (revision === null) return
    try {
      const published = await storeRef.current.publish(
        "playground-form",
        revision,
        new Date().toISOString(),
      )
      setPersistenceStatus(`Published in memory · version ${published.version}`)
      setMessage(null)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The form could not be published.")
    }
  }

  const shared: BuilderLayoutProps = {
    builder,
    selectedField,
    onAdd: addControl,
    onSelect: selectField,
    onEdit: editSelected,
    onDuplicate: duplicateSelected,
    onRemove: removeSelected,
    onMove: moveSelected,
    onReorder: reorderField,
  }
  const serializedRouting = generateFormRoutingDefinition(builder.definition, routing)
  const generatedRouting = serializedRouting.ok ? serializedRouting.routing : null

  return (
    <div className="mx-auto w-full max-w-[1680px] space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <header className="space-y-5">
        <div className="space-y-2">
          <Link
            href="/_dev"
            className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-900"
          >
            <span aria-hidden="true">←</span> Playgrounds
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-gray-950">Form builder</h1>
            <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">
              Development only
            </span>
          </div>
          <p className="max-w-2xl text-sm leading-6 text-gray-600">
            Build fields and routing rules against one headless definition. Changes stay in this
            page.
          </p>
        </div>

        <div className="grid gap-4 border-y border-gray-200 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <div className="grid gap-3 sm:grid-cols-2">
            <TextSetting
              label="Form title"
              value={builder.definition.title}
              onCommit={(title) =>
                title.trim() && commit((definition) => updateForm(definition, { title }))
              }
            />
            <TextSetting
              label="Description"
              value={builder.definition.description ?? ""}
              onCommit={(description) =>
                commit((definition) => updateForm(definition, { description }))
              }
            />
          </div>
          <p className="pb-2 text-xs text-gray-500">
            {builder.definition.fields.length} fields ·{" "}
            {builder.dirty || routingDirty ? "Unsaved changes" : "Saved draft"}
          </p>
        </div>
      </header>

      <nav
        aria-label="Playground views"
        className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between"
      >
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs font-medium text-gray-500">
            Fixture
            <select
              value={fixture}
              onChange={(event) => changeFixture(event.target.value as Fixture)}
              className="rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-800 outline-none focus:border-teal-500"
            >
              {fixtures.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <div className="flex rounded-lg bg-gray-200/70 p-1">
            {(["builder", "routing", "preview", "definition"] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setView(item)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium capitalize transition-colors ${
                  view === item
                    ? "bg-white text-gray-950 shadow-sm"
                    : "text-gray-600 hover:text-gray-950"
                }`}
              >
                {item === "definition" ? "JSON definition" : item}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col items-start gap-1.5 sm:items-end">
          <div className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white p-1 shadow-sm">
            {view === "builder" ? (
              <>
                <ActionButton
                  label="Undo"
                  disabled={builder.past.length === 0}
                  onClick={() => setBuilder((current) => undoBuilder(current))}
                />
                <ActionButton
                  label="Redo"
                  disabled={builder.future.length === 0}
                  onClick={() => setBuilder((current) => redoBuilder(current))}
                />
                <span className="mx-1 h-5 w-px bg-gray-200" aria-hidden="true" />
              </>
            ) : null}
            <ActionButton label="Save draft" onClick={() => void saveDraftSimulation()} />
            <button
              type="button"
              onClick={() => void publishSimulation()}
              className="rounded-md bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-teal-700"
            >
              Publish
            </button>
          </div>
          <p className="px-1 text-xs text-gray-500">{persistenceStatus}</p>
        </div>
      </nav>

      {message ? (
        <div
          role="alert"
          className="border-l-2 border-red-500 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {message}
        </div>
      ) : null}

      {view === "builder" ? <BuilderCanvas {...shared} /> : null}
      {view === "routing" ? (
        <RoutingEditor
          definition={builder.definition}
          draft={routing}
          issues={serializedRouting.ok ? [] : serializedRouting.issues}
          onAddRule={addRoutingRule}
          onUpdateRule={updateRoutingRule}
          onRemoveRule={removeRoutingRule}
          onReorderRule={reorderRoutingRule}
          onAddCondition={addRoutingCondition}
          onUpdateCondition={updateRoutingCondition}
          onRemoveCondition={removeRoutingCondition}
          onFallbackChange={(fallback) =>
            commitRouting((current) => ({ ...current, fallback }))
          }
        />
      ) : null}
      {view === "preview" ? <RespondentPreview definition={builder.definition} /> : null}
      {view === "definition" ? (
        <DefinitionView definition={builder.definition} routing={generatedRouting} />
      ) : null}
    </div>
  )
}

interface BuilderLayoutProps {
  readonly builder: BuilderState
  readonly selectedField: FormFieldDefinition | null
  readonly onAdd: (control: FieldControl) => void
  readonly onSelect: (fieldId: string) => void
  readonly onEdit: (update: Readonly<Record<string, unknown>>) => void
  readonly onDuplicate: () => void
  readonly onRemove: () => void
  readonly onMove: (offset: number) => void
  readonly onReorder: (fieldId: string, targetIndex: number) => void
}

function BuilderCanvas(props: BuilderLayoutProps) {
  return (
    <section
      aria-label="Form builder"
      className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm"
    >
      <div className="grid min-h-[620px] lg:grid-cols-[180px_minmax(300px,1fr)_260px]">
        <aside className="border-b border-gray-200 bg-gray-50/80 p-4 lg:border-b-0 lg:border-r">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
            Add field
          </p>
          <ControlPalette onAdd={props.onAdd} />
        </aside>

        <main className="bg-[#f4f5f7] p-4 sm:p-7">
          <div className="mx-auto max-w-xl rounded-xl bg-white px-5 py-7 shadow-[0_12px_36px_rgba(15,23,42,0.08)] sm:px-8">
            <p className="text-xs font-semibold uppercase tracking-wider text-teal-600">
              Form canvas
            </p>
            <h2 className="mt-3 text-xl font-semibold text-gray-950">
              {props.builder.definition.title}
            </h2>
            <p className="mt-1 text-sm leading-5 text-gray-500">
              {props.builder.definition.description}
            </p>
            <FieldList {...props} roomy />
          </div>
        </main>

        <aside className="border-t border-gray-200 p-5 lg:border-l lg:border-t-0">
          <FieldInspector {...props} />
        </aside>
      </div>
    </section>
  )
}

function ControlPalette({ onAdd }: { readonly onAdd: (control: FieldControl) => void }) {
  return (
    <div className="space-y-1.5">
      {controls.map((item) => (
        <button
          key={item.control}
          type="button"
          onClick={() => onAdd(item.control)}
          className="group w-full rounded-md px-2.5 py-2 text-left transition-colors hover:bg-white hover:shadow-sm"
        >
          <span className="block text-sm font-medium">+ {item.label}</span>
        </button>
      ))}
    </div>
  )
}

function FieldList(props: BuilderLayoutProps & { readonly roomy?: boolean }) {
  return (
    <div className={props.roomy ? "mt-7 space-y-3" : "space-y-2"}>
      {props.builder.definition.fields.map((field, index) => {
        const selected = field.id === props.builder.selectedFieldId
        return (
          <DraggableField
            key={field.id}
            fieldId={field.id}
            index={index}
            onReorder={props.onReorder}
          >
            {({ dragHandleRef }) => (
              <div
                className={`group overflow-hidden rounded-lg border transition-[border-color,box-shadow,background-color] ${
                  selected
                    ? "border-teal-500 bg-teal-50/50 shadow-[0_0_0_3px_rgba(13,148,136,0.14)]"
                    : "border-gray-200 bg-white hover:border-gray-300"
                }`}
              >
                <div className="flex items-stretch">
                  <button
                    ref={dragHandleRef}
                    type="button"
                    aria-label={`Drag ${field.label} to reorder`}
                    title="Drag to reorder"
                    onClick={() => props.onSelect(field.id)}
                    className="w-10 shrink-0 cursor-grab border-r border-gray-100 text-lg leading-none text-gray-300 transition-colors hover:bg-gray-50 hover:text-teal-600 active:cursor-grabbing"
                  >
                    ⠿
                  </button>
                  <button
                    type="button"
                    onClick={() => props.onSelect(field.id)}
                    className="min-w-0 flex-1 px-4 py-3.5 text-left"
                  >
                    <span className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium text-gray-900">
                        {field.label}
                        {field.required ? <span className="ml-1 text-teal-600">*</span> : null}
                      </span>
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                        {controlLabel(field.control)}
                      </span>
                    </span>
                    {field.description ? (
                      <span className="mt-1 block text-xs leading-5 text-gray-500">
                        {field.description}
                      </span>
                    ) : null}
                  </button>
                </div>
                {selected ? (
                  <div className="flex items-center gap-1 border-t border-teal-100 px-3 py-2">
                    <ActionButton
                      label="↑"
                      title="Move up"
                      disabled={index === 0}
                      onClick={() => props.onMove(-1)}
                    />
                    <ActionButton
                      label="↓"
                      title="Move down"
                      disabled={index === props.builder.definition.fields.length - 1}
                      onClick={() => props.onMove(1)}
                    />
                    <ActionButton label="Duplicate" onClick={props.onDuplicate} />
                    <ActionButton label="Remove" danger onClick={props.onRemove} />
                  </div>
                ) : null}
              </div>
            )}
          </DraggableField>
        )
      })}
    </div>
  )
}

function FieldInspector(props: BuilderLayoutProps & { readonly expanded?: boolean }) {
  const field = props.selectedField
  if (!field) return <EmptySelection />
  const index = props.builder.definition.fields.findIndex((item) => item.id === field.id)

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
            Field settings
          </p>
          <p className="mt-1 text-sm font-semibold text-gray-950">{controlLabel(field.control)}</p>
        </div>
        <span className="rounded bg-gray-100 px-2 py-1 font-mono text-[10px] text-gray-500">
          {field.name}
        </span>
      </div>

      <div className={props.expanded ? "grid gap-4 sm:grid-cols-2" : "space-y-4"}>
        <TextSetting
          label="Label"
          value={field.label}
          onCommit={(label) => label.trim() && props.onEdit({ label })}
        />
        <TextSetting
          label="Submission key"
          value={field.name}
          onCommit={(name) => name.trim() && props.onEdit({ name })}
          mono
        />
        <TextSetting
          label="Help text"
          value={field.description ?? ""}
          onCommit={(description) => props.onEdit({ description })}
        />
        {field.control !== "checkbox" ? (
          <TextSetting
            label="Placeholder"
            value={field.placeholder ?? ""}
            onCommit={(placeholder) => props.onEdit({ placeholder })}
          />
        ) : null}
      </div>

      <label className="flex cursor-pointer items-center justify-between gap-3 rounded-md bg-gray-50 px-3 py-2.5 text-sm text-gray-700">
        Required response
        <input
          type="checkbox"
          checked={field.required}
          onChange={(event) => props.onEdit({ required: event.target.checked })}
          className="h-4 w-4 rounded border-gray-300 accent-teal-600"
        />
      </label>

      {field.type === "number" ? (
        <div className="grid grid-cols-2 gap-3">
          <NumberSetting
            label="Minimum"
            value={field.validation?.min}
            onCommit={(min) =>
              props.onEdit({
                validation: { ...field.validation, ...(min === undefined ? {} : { min }) },
              })
            }
          />
          <NumberSetting
            label="Maximum"
            value={field.validation?.max}
            onCommit={(max) =>
              props.onEdit({
                validation: { ...field.validation, ...(max === undefined ? {} : { max }) },
              })
            }
          />
        </div>
      ) : null}

      {field.type === "string" && field.control !== "email" ? (
        <div className="grid grid-cols-2 gap-3">
          <NumberSetting
            label="Min length"
            value={field.validation?.minLength}
            onCommit={(minLength) =>
              props.onEdit({
                validation: {
                  ...field.validation,
                  ...(minLength === undefined ? {} : { minLength }),
                },
              })
            }
          />
          <NumberSetting
            label="Max length"
            value={field.validation?.maxLength}
            onCommit={(maxLength) =>
              props.onEdit({
                validation: {
                  ...field.validation,
                  ...(maxLength === undefined ? {} : { maxLength }),
                },
              })
            }
          />
        </div>
      ) : null}

      {field.type === "enum" ? (
        <TextSetting
          label="Options (one per line)"
          value={field.values.join("\n")}
          multiline
          onCommit={(value) => {
            const values = value
              .split("\n")
              .map((item) => item.trim())
              .filter(Boolean)
            if (values.length > 0) props.onEdit({ values })
          }}
        />
      ) : null}

      <div className="flex flex-wrap items-center gap-1 border-t border-gray-200 pt-4">
        <ActionButton label="↑ Up" disabled={index === 0} onClick={() => props.onMove(-1)} />
        <ActionButton
          label="↓ Down"
          disabled={index === props.builder.definition.fields.length - 1}
          onClick={() => props.onMove(1)}
        />
        <ActionButton label="Duplicate" onClick={props.onDuplicate} />
        <ActionButton label="Remove" danger onClick={props.onRemove} />
      </div>
    </div>
  )
}

function RespondentPreview({ definition }: { readonly definition: FormDefinition }) {
  const [values, setValues] = useState<Record<string, string | number | boolean>>({})
  const [submitted, setSubmitted] = useState(false)

  function setValue(name: string, value: string | number | boolean) {
    setValues((current) => ({ ...current, [name]: value }))
    setSubmitted(false)
  }

  return (
    <section className="relative overflow-hidden rounded-xl border border-gray-200 bg-[#ebe9e4] px-4 py-10 sm:px-10">
      <div className="absolute right-4 top-4 rounded-full bg-white/80 px-3 py-1 text-xs font-medium text-gray-600 backdrop-blur">
        Inert preview · no data is saved
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          setSubmitted(true)
        }}
        className="mx-auto max-w-xl rounded-2xl bg-white px-6 py-8 shadow-[0_18px_60px_rgba(15,23,42,0.12)] sm:px-10 sm:py-10"
      >
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-600">
          Enterprise sales
        </p>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight text-gray-950">
          {definition.title}
        </h2>
        {definition.description ? (
          <p className="mt-2 text-sm leading-6 text-gray-600">{definition.description}</p>
        ) : null}

        <div className="mt-8 space-y-6">
          {definition.fields.map((field) => (
            <div key={field.id}>
              {field.control === "checkbox" ? null : (
                <label
                  htmlFor={`preview-${field.id}`}
                  className="mb-2 block text-sm font-medium text-gray-900"
                >
                  {field.label}
                  {field.required ? <span className="ml-1 text-teal-600">*</span> : null}
                </label>
              )}
              <PreviewInput
                id={`preview-${field.id}`}
                field={field}
                value={values[field.name] ?? (field.control === "checkbox" ? false : "")}
                onChange={(value) => setValue(field.name, value)}
              />
              {field.description ? (
                <p className="mt-1.5 text-xs text-gray-500">{field.description}</p>
              ) : null}
            </div>
          ))}
        </div>

        <button
          type="submit"
          className="mt-8 w-full rounded-lg bg-teal-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2"
        >
          {definition.submitLabel}
        </button>
        {submitted ? (
          <div
            role="status"
            className="mt-4 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
          >
            Preview complete. No API was called and no response was stored.
          </div>
        ) : null}
      </form>
    </section>
  )
}

function PreviewInput({
  field,
  value,
  onChange,
  id,
  large = false,
}: {
  readonly field: FormFieldDefinition
  readonly value: string | number | boolean
  readonly onChange: (value: string | number | boolean) => void
  readonly id?: string
  readonly large?: boolean
}) {
  const inputClass = `w-full border-0 border-b bg-transparent px-0 text-gray-950 outline-none transition-colors placeholder:text-gray-400 focus:border-teal-600 focus:ring-0 ${
    large ? "border-gray-400 py-3 text-lg" : "border-gray-300 py-2.5 text-sm"
  }`

  switch (field.control) {
    case "textarea":
      return (
        <textarea
          id={id}
          required={field.required}
          placeholder={field.placeholder}
          value={String(value)}
          onChange={(event) => onChange(event.target.value)}
          rows={large ? 3 : 4}
          className={inputClass}
        />
      )
    case "select":
      return (
        <select
          id={id}
          required={field.required}
          value={String(value)}
          onChange={(event) => onChange(event.target.value)}
          className={inputClass}
        >
          <option value="">{field.placeholder || "Choose an option"}</option>
          {field.values.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      )
    case "checkbox":
      return (
        <label
          htmlFor={id}
          className="flex cursor-pointer items-start gap-3 text-sm leading-6 text-gray-800"
        >
          <input
            id={id}
            type="checkbox"
            required={field.required}
            checked={Boolean(value)}
            onChange={(event) => onChange(event.target.checked)}
            className="mt-1 h-4 w-4 rounded border-gray-300 accent-teal-600"
          />
          <span>
            {field.label}
            {field.required ? <span className="ml-1 text-teal-600">*</span> : null}
          </span>
        </label>
      )
    case "number":
      return (
        <input
          id={id}
          type="number"
          required={field.required}
          min={field.validation?.min}
          max={field.validation?.max}
          placeholder={field.placeholder}
          value={value === "" ? "" : Number(value)}
          onChange={(event) =>
            onChange(event.target.value === "" ? "" : event.target.valueAsNumber)
          }
          className={inputClass}
        />
      )
    case "email":
    case "text":
      return (
        <input
          id={id}
          type={field.control}
          required={field.required}
          minLength={field.validation?.minLength}
          maxLength={field.validation?.maxLength}
          placeholder={field.placeholder}
          value={String(value)}
          onChange={(event) => onChange(event.target.value)}
          className={inputClass}
        />
      )
  }
}

function DefinitionView({
  definition,
  routing,
}: {
  readonly definition: FormDefinition
  readonly routing: FormRoutingDefinition | null
}) {
  const exampleSubmission = Object.fromEntries(
    definition.fields.map((field) => {
      switch (field.type) {
        case "string":
          return [field.name, field.control === "email" ? "ada@analytical.co" : "Example response"]
        case "number":
          return [field.name, 850]
        case "boolean":
          return [field.name, true]
        case "enum":
          return [field.name, field.values[0] ?? ""]
      }
    }),
  )

  return (
    <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950 text-slate-100 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold">Versioned form draft</h2>
          <p className="mt-0.5 text-xs text-slate-400">
            The same plain data drives rendering, validation and routing.
          </p>
        </div>
        <span className="font-mono text-xs text-slate-500">
          formatVersion {definition.formatVersion}
        </span>
      </div>
      <div className="grid lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)]">
        <div className="overflow-x-auto p-5 lg:border-r lg:border-slate-800">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
            Form and routing
          </p>
          <pre className="text-xs leading-6 text-slate-300">
            {JSON.stringify({ definition, routing }, null, 2)}
          </pre>
        </div>
        <div className="overflow-x-auto border-t border-slate-800 p-5 lg:border-t-0">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
            Example normalized submission
          </p>
          <pre className="text-xs leading-6 text-emerald-300">
            {JSON.stringify(exampleSubmission, null, 2)}
          </pre>
          <div className="mt-6 border-t border-slate-800 pt-5 text-xs leading-5 text-slate-400">
            Visual conditions compile to the same expression language used by the routing runtime.
            {routing?.rules[0] ? (
              <code className="mt-2 block rounded bg-slate-900 px-3 py-2 text-teal-300">
                {routing.rules[0].when}
              </code>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  )
}

function TextSetting({
  label,
  value,
  onCommit,
  mono = false,
  multiline = false,
}: {
  readonly label: string
  readonly value: string
  readonly onCommit: (value: string) => void
  readonly mono?: boolean
  readonly multiline?: boolean
}) {
  const className = `w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition-colors focus:border-teal-500 focus:ring-2 focus:ring-teal-100 ${
    mono ? "font-mono text-xs" : ""
  }`

  return (
    <label className="block text-xs font-medium text-gray-600">
      <span className="mb-1.5 block">{label}</span>
      {multiline ? (
        <textarea
          key={value}
          defaultValue={value}
          rows={4}
          onBlur={(event) => onCommit(event.currentTarget.value)}
          className={className}
        />
      ) : (
        <input
          key={value}
          defaultValue={value}
          onBlur={(event) => onCommit(event.currentTarget.value)}
          className={className}
        />
      )}
    </label>
  )
}

function NumberSetting({
  label,
  value,
  onCommit,
}: {
  readonly label: string
  readonly value?: number
  readonly onCommit: (value: number | undefined) => void
}) {
  const inputValue = value === undefined ? "" : String(value)

  return (
    <label className="block text-xs font-medium text-gray-600">
      <span className="mb-1.5 block">{label}</span>
      <input
        key={inputValue}
        type="number"
        defaultValue={inputValue}
        onBlur={(event) =>
          onCommit(event.target.value === "" ? undefined : event.target.valueAsNumber)
        }
        className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
      />
    </label>
  )
}

function ActionButton({
  label,
  onClick,
  disabled = false,
  danger = false,
  title,
}: {
  readonly label: string
  readonly onClick: () => void
  readonly disabled?: boolean
  readonly danger?: boolean
  readonly title?: string
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
        danger
          ? "text-red-600 hover:bg-red-50"
          : "text-gray-600 hover:bg-gray-100 hover:text-gray-950"
      }`}
    >
      {label}
    </button>
  )
}

function EmptySelection() {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center text-center">
      <p className="text-sm font-medium text-gray-700">No field selected</p>
      <p className="mt-1 max-w-48 text-xs leading-5 text-gray-500">
        Select a field to edit its label, key and validation.
      </p>
    </div>
  )
}

function controlLabel(control: FieldControl) {
  return controls.find((item) => item.control === control)?.label ?? control
}
