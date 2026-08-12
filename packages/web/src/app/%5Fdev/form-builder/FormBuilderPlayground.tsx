"use client"

import {
  addField,
  applyBuilderDefinition,
  createBuilderState,
  createField,
  createFormDefinition,
  duplicateField,
  markBuilderSaved,
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
} from "@screeem/forms"
import Link from "next/link"
import { useMemo, useRef, useState } from "react"

type Direction = "canvas" | "outline" | "focus"
type View = "builder" | "preview" | "definition"
type Fixture = "lead" | "contact" | "eligibility"

const controls: readonly { control: FieldControl; label: string; detail: string }[] = [
  { control: "text", label: "Short text", detail: "Name or company" },
  { control: "email", label: "Email", detail: "Work email" },
  { control: "textarea", label: "Long answer", detail: "Notes or context" },
  { control: "number", label: "Number", detail: "Age or employees" },
  { control: "checkbox", label: "Checkbox", detail: "Yes or no" },
  { control: "select", label: "Single select", detail: "One fixed option" },
]

const directions: readonly {
  id: Direction
  label: string
  description: string
  verdict: "Selected" | "Rejected"
  reason: string
}[] = [
  {
    id: "canvas",
    label: "Canvas",
    description: "Palette, form canvas and inspector",
    verdict: "Selected",
    reason: "Best balance of discoverability, direct manipulation and field context.",
  },
  {
    id: "outline",
    label: "Outline",
    description: "Compact field index with a wide editor",
    verdict: "Rejected",
    reason: "Efficient for experts, but hides too much of the respondent experience.",
  },
  {
    id: "focus",
    label: "Focus",
    description: "One question at a time with a sequence strip",
    verdict: "Rejected",
    reason: "Clear per question, but slower for scanning and reorganising a whole form.",
  },
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

export function FormBuilderPlayground() {
  const [builder, setBuilder] = useState(() =>
    selectBuilderField(createBuilderState(createLeadQualificationFixture()), "full-name"),
  )
  const [direction, setDirection] = useState<Direction>("canvas")
  const [view, setView] = useState<View>("builder")
  const [fixture, setFixture] = useState<Fixture>("lead")
  const [message, setMessage] = useState<string | null>(null)
  const [persistenceStatus, setPersistenceStatus] = useState("Not saved")
  const idCounter = useRef(100)
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

  function changeFixture(nextFixture: Fixture) {
    const definition = createFixture(nextFixture)
    setFixture(nextFixture)
    setBuilder(selectBuilderField(createBuilderState(definition), definition.fields[0]?.id ?? null))
    storeRef.current = new MemoryFormDefinitionStore()
    storeCreatedRef.current = false
    setPersistenceStatus("Not saved")
    setMessage(null)
  }

  async function saveDraftSimulation() {
    try {
      if (!storeCreatedRef.current) {
        const record = await storeRef.current.create("playground-form", builder.definition)
        storeCreatedRef.current = true
        setBuilder((current) => markBuilderSaved(current, record.draft.revision))
        setPersistenceStatus(`Draft saved · revision ${record.draft.revision}`)
        return record.draft.revision
      }
      if (!builder.dirty) {
        setPersistenceStatus(`Draft unchanged · revision ${builder.baseRevision}`)
        return builder.baseRevision
      }
      const draft = await storeRef.current.saveDraft(
        "playground-form",
        builder.baseRevision,
        builder.definition,
      )
      setBuilder((current) => markBuilderSaved(current, draft.revision))
      setPersistenceStatus(`Draft saved · revision ${draft.revision}`)
      return draft.revision
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
  }

  return (
    <div className="space-y-6 pb-12">
      <header className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
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
              Compare layout directions against one headless definition. Changes carry across every
              direction and never leave this page.
            </p>
          </div>

          <div className="space-y-2 text-right">
            <div className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white p-1 shadow-sm">
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
              <ActionButton label="Save draft" onClick={() => void saveDraftSimulation()} />
              <button
                type="button"
                onClick={() => void publishSimulation()}
                className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-indigo-700"
              >
                Publish
              </button>
            </div>
            <p className="text-xs text-gray-500">{persistenceStatus}</p>
          </div>
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
            {builder.dirty ? "Unsaved changes" : "Fixture"}
          </p>
        </div>
      </header>

      <nav aria-label="Playground views" className="flex flex-wrap justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs font-medium text-gray-500">
            Fixture
            <select
              value={fixture}
              onChange={(event) => changeFixture(event.target.value as Fixture)}
              className="rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-800 outline-none focus:border-indigo-500"
            >
              {fixtures.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <div className="flex rounded-lg bg-gray-200/70 p-1">
            {(["builder", "preview", "definition"] as const).map((item) => (
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

        {view === "builder" ? (
          <div className="flex flex-wrap gap-1" aria-label="Builder layout direction">
            {directions.map((item) => (
              <button
                key={item.id}
                type="button"
                title={item.description}
                onClick={() => setDirection(item.id)}
                className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                  direction === item.id
                    ? "bg-indigo-600 font-medium text-white"
                    : "bg-white text-gray-600 ring-1 ring-inset ring-gray-200 hover:text-gray-950"
                }`}
              >
                {item.label} · {item.verdict}
              </button>
            ))}
          </div>
        ) : null}
      </nav>

      {message ? (
        <div
          role="alert"
          className="border-l-2 border-red-500 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {message}
        </div>
      ) : null}

      {view === "builder" && direction === "canvas" ? <CanvasDirection {...shared} /> : null}
      {view === "builder" && direction === "outline" ? <OutlineDirection {...shared} /> : null}
      {view === "builder" && direction === "focus" ? <FocusDirection {...shared} /> : null}
      {view === "preview" ? <RespondentPreview definition={builder.definition} /> : null}
      {view === "definition" ? <DefinitionView definition={builder.definition} /> : null}
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
}

function CanvasDirection(props: BuilderLayoutProps) {
  return (
    <section
      aria-label="Canvas direction"
      className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm"
    >
      <DirectionHeader
        name="Canvas"
        description="Persistent field palette and property inspector around a visual form canvas."
        verdict="Selected"
        reason="Best balance of discoverability, direct manipulation and field context."
      />
      <div className="grid min-h-[620px] lg:grid-cols-[180px_minmax(300px,1fr)_260px]">
        <aside className="border-b border-gray-200 bg-gray-50/80 p-4 lg:border-b-0 lg:border-r">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
            Add field
          </p>
          <ControlPalette onAdd={props.onAdd} compact />
        </aside>

        <main className="bg-[#f4f5f7] p-4 sm:p-7">
          <div className="mx-auto max-w-xl rounded-xl bg-white px-5 py-7 shadow-[0_12px_36px_rgba(15,23,42,0.08)] sm:px-8">
            <p className="text-xs font-semibold uppercase tracking-wider text-indigo-600">
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

function OutlineDirection(props: BuilderLayoutProps) {
  return (
    <section
      aria-label="Outline direction"
      className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950 text-white shadow-sm"
    >
      <DirectionHeader
        dark
        name="Outline"
        description="A dense field index for teams that manage longer operational forms."
        verdict="Rejected"
        reason="Efficient for experts, but hides too much of the respondent experience."
      />
      <div className="border-b border-slate-800 px-5 py-4">
        <ControlPalette onAdd={props.onAdd} horizontal dark />
      </div>
      <div className="grid min-h-[560px] md:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="border-b border-slate-800 md:border-b-0 md:border-r">
          <div className="flex items-center justify-between px-4 py-3 text-xs text-slate-400">
            <span>Field outline</span>
            <span>{props.builder.definition.fields.length} total</span>
          </div>
          <div className="space-y-px px-2 pb-4">
            {props.builder.definition.fields.map((field, index) => (
              <button
                key={field.id}
                type="button"
                onClick={() => props.onSelect(field.id)}
                className={`grid w-full grid-cols-[24px_1fr_auto] items-center gap-2 rounded-md px-2 py-2.5 text-left transition-colors ${
                  props.builder.selectedFieldId === field.id
                    ? "bg-indigo-500/20 text-white"
                    : "text-slate-300 hover:bg-slate-900"
                }`}
              >
                <span className="font-mono text-xs text-slate-500">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="truncate text-sm font-medium">{field.label}</span>
                <span className="text-[10px] uppercase tracking-wide text-slate-500">
                  {field.control}
                </span>
              </button>
            ))}
          </div>
        </aside>
        <main className="bg-white p-6 text-gray-950 sm:p-8">
          <div className="mx-auto max-w-2xl">
            <FieldInspector {...props} expanded />
          </div>
        </main>
      </div>
    </section>
  )
}

function FocusDirection(props: BuilderLayoutProps) {
  const currentIndex = props.selectedField
    ? props.builder.definition.fields.findIndex((field) => field.id === props.selectedField?.id)
    : -1

  return (
    <section
      aria-label="Focus direction"
      className="overflow-hidden rounded-xl border border-gray-200 bg-[#fbfaf7] shadow-sm"
    >
      <DirectionHeader
        name="Focus"
        description="A guided question editor that keeps attention on one field at a time."
        verdict="Rejected"
        reason="Clear per question, but slower for scanning and reorganising a whole form."
      />
      <div className="border-b border-gray-200 bg-white px-5 py-4">
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {props.builder.definition.fields.map((field, index) => (
            <button
              key={field.id}
              type="button"
              aria-label={`Edit ${field.label}`}
              onClick={() => props.onSelect(field.id)}
              className={`h-2.5 min-w-10 flex-1 rounded-full transition-all ${
                props.builder.selectedFieldId === field.id
                  ? "bg-indigo-600 ring-4 ring-indigo-100"
                  : index < currentIndex
                    ? "bg-indigo-200 hover:bg-indigo-300"
                    : "bg-gray-200 hover:bg-gray-300"
              }`}
            />
          ))}
        </div>
        <p className="mt-3 text-xs text-gray-500">
          {currentIndex >= 0
            ? `Question ${currentIndex + 1} of ${props.builder.definition.fields.length}`
            : "Select a question"}
        </p>
      </div>

      <div className="grid min-h-[520px] lg:grid-cols-[minmax(0,1fr)_300px]">
        <main className="flex items-center justify-center p-6 sm:p-12">
          <div className="w-full max-w-xl">
            {props.selectedField ? (
              <>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-600">
                  {controlLabel(props.selectedField.control)}
                </p>
                <h2 className="mt-4 text-3xl font-semibold tracking-tight text-gray-950">
                  {props.selectedField.label}
                  {props.selectedField.required ? (
                    <span className="text-indigo-600"> *</span>
                  ) : null}
                </h2>
                {props.selectedField.description ? (
                  <p className="mt-2 text-base leading-7 text-gray-600">
                    {props.selectedField.description}
                  </p>
                ) : null}
                <div className="mt-8">
                  <PreviewInput
                    field={props.selectedField}
                    value=""
                    onChange={() => undefined}
                    large
                  />
                </div>
                <div className="mt-9 flex items-center justify-between border-t border-gray-200 pt-5">
                  <ActionButton
                    label="← Previous"
                    disabled={currentIndex <= 0}
                    onClick={() => {
                      const previous = props.builder.definition.fields[currentIndex - 1]
                      if (previous) props.onSelect(previous.id)
                    }}
                  />
                  <span className="text-xs text-gray-500">
                    Use the sequence strip to change questions
                  </span>
                  <ActionButton
                    label="Next →"
                    disabled={
                      currentIndex < 0 || currentIndex >= props.builder.definition.fields.length - 1
                    }
                    onClick={() => {
                      const next = props.builder.definition.fields[currentIndex + 1]
                      if (next) props.onSelect(next.id)
                    }}
                  />
                </div>
              </>
            ) : (
              <EmptySelection />
            )}
          </div>
        </main>
        <aside className="border-t border-gray-200 bg-white p-5 lg:border-l lg:border-t-0">
          <FieldInspector {...props} />
          <div className="mt-6 border-t border-gray-200 pt-5">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
              Add question
            </p>
            <ControlPalette onAdd={props.onAdd} compact />
          </div>
        </aside>
      </div>
    </section>
  )
}

function DirectionHeader({
  name,
  description,
  dark = false,
  verdict,
  reason,
}: {
  readonly name: string
  readonly description: string
  readonly dark?: boolean
  readonly verdict: "Selected" | "Rejected"
  readonly reason: string
}) {
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4 ${
        dark ? "border-slate-800" : "border-gray-200"
      }`}
    >
      <div>
        <h2 className={`text-sm font-semibold ${dark ? "text-white" : "text-gray-950"}`}>{name}</h2>
        <p className={`mt-0.5 text-xs ${dark ? "text-slate-400" : "text-gray-500"}`}>
          {description}
        </p>
        <p
          className={`mt-1 text-xs ${verdict === "Selected" ? "text-emerald-600" : dark ? "text-slate-500" : "text-gray-400"}`}
        >
          {reason}
        </p>
      </div>
      <span
        className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
          dark ? "bg-slate-900 text-slate-400" : "bg-gray-100 text-gray-600"
        }`}
      >
        {verdict}
      </span>
    </div>
  )
}

function ControlPalette({
  onAdd,
  compact = false,
  horizontal = false,
  dark = false,
}: {
  readonly onAdd: (control: FieldControl) => void
  readonly compact?: boolean
  readonly horizontal?: boolean
  readonly dark?: boolean
}) {
  return (
    <div className={horizontal ? "flex flex-wrap gap-2" : "space-y-1.5"}>
      {controls.map((item) => (
        <button
          key={item.control}
          type="button"
          onClick={() => onAdd(item.control)}
          className={`group text-left transition-colors ${
            horizontal
              ? `rounded-md px-3 py-2 text-xs font-medium ${
                  dark
                    ? "bg-slate-900 text-slate-300 ring-1 ring-inset ring-slate-700 hover:bg-slate-800 hover:text-white"
                    : "bg-white text-gray-700 ring-1 ring-inset ring-gray-200 hover:bg-gray-50"
                }`
              : `w-full rounded-md px-2.5 py-2 ${
                  dark ? "hover:bg-slate-900" : "hover:bg-white hover:shadow-sm"
                }`
          }`}
        >
          <span className={`block ${horizontal ? "" : "text-sm font-medium"}`}>+ {item.label}</span>
          {!compact && !horizontal ? (
            <span className={`mt-0.5 block text-xs ${dark ? "text-slate-500" : "text-gray-500"}`}>
              {item.detail}
            </span>
          ) : null}
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
          <div
            key={field.id}
            className={`group relative rounded-lg border transition-all ${
              selected
                ? "border-indigo-500 bg-indigo-50/50 shadow-[0_0_0_3px_rgba(99,102,241,0.12)]"
                : "border-gray-200 bg-white hover:border-gray-300"
            }`}
          >
            <button
              type="button"
              onClick={() => props.onSelect(field.id)}
              className="w-full px-4 py-3.5 text-left"
            >
              <span className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-gray-900">
                  {field.label}
                  {field.required ? <span className="ml-1 text-indigo-600">*</span> : null}
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
            {selected ? (
              <div className="flex items-center gap-1 border-t border-indigo-100 px-3 py-2">
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
          className="h-4 w-4 rounded border-gray-300 accent-indigo-600"
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
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-600">
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
                  {field.required ? <span className="ml-1 text-indigo-600">*</span> : null}
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
          className="mt-8 w-full rounded-lg bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
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
  const inputClass = `w-full border-0 border-b bg-transparent px-0 text-gray-950 outline-none transition-colors placeholder:text-gray-400 focus:border-indigo-600 focus:ring-0 ${
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
            className="mt-1 h-4 w-4 rounded border-gray-300 accent-indigo-600"
          />
          <span>
            {field.label}
            {field.required ? <span className="ml-1 text-indigo-600">*</span> : null}
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

function DefinitionView({ definition }: { readonly definition: FormDefinition }) {
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
          <h2 className="text-sm font-semibold">Normalized form definition</h2>
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
            Definition
          </p>
          <pre className="text-xs leading-6 text-slate-300">
            {JSON.stringify(definition, null, 2)}
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
            Routing can evaluate fields directly, for example:
            <code className="mt-2 block rounded bg-slate-900 px-3 py-2 text-indigo-300">
              submission.employees &gt;= 500 &amp;&amp; submission.country === &quot;UK&quot;
            </code>
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
  const className = `w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 ${
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
        className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
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
