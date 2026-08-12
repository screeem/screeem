"use client"

import {
  addField,
  applyBuilderDefinition,
  createBuilderState,
  createField,
  createFormDefinition,
  duplicateField,
  markBuilderSaved,
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
  type FormIssue,
} from "@screeem/forms"
import Link from "next/link"
import { useEffect, useMemo, useRef, useState } from "react"
import { DraggableField } from "../../../../components/forms/DraggableField"
import { RespondentForm } from "../../../../components/forms/RespondentForm"

type EditorView = "build" | "preview"

type LoadedForm = {
  id: string
  name: string
  endpoint_key?: string
  availability?: "draft" | "active" | "paused"
  is_active?: boolean
  published_version?: number | null
}

interface DraftResponse {
  readonly revision: number
  readonly definition: FormDefinition
}

interface PublishedResponse {
  readonly version: number
}

interface EditorApiBody {
  readonly error?: unknown
  readonly issues?: unknown
  readonly draft?: DraftResponse | null
  readonly form?: LoadedForm & { readonly draft?: DraftResponse | null }
  readonly legacy?: boolean
  readonly availability?: "draft" | "active" | "paused"
  readonly publishedVersion?: number | null
  readonly lastPublishedDraftRevision?: number | null
  readonly published?: PublishedResponse
}

const controls: readonly { control: FieldControl; label: string }[] = [
  { control: "text", label: "Short text" },
  { control: "email", label: "Email" },
  { control: "textarea", label: "Long answer" },
  { control: "number", label: "Number" },
  { control: "checkbox", label: "Checkbox" },
  { control: "select", label: "Single select" },
]

export function FormEditor({
  teamId,
  formId,
  initialName,
}: {
  readonly teamId: string
  readonly formId: string
  readonly initialName?: string
}) {
  const [form, setForm] = useState<LoadedForm | null>(null)
  const [builder, setBuilder] = useState<BuilderState | null>(null)
  const [view, setView] = useState<EditorView>("build")
  const [error, setError] = useState("")
  const [issues, setIssues] = useState<readonly FormIssue[]>([])
  const [status, setStatus] = useState("")
  const [draftExists, setDraftExists] = useState(false)
  const [publishedRevision, setPublishedRevision] = useState<number | null>(null)
  const [busy, setBusy] = useState<"save" | "publish" | null>(null)
  const idCounter = useRef(1)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setError("")
      try {
        const response = await fetch(`/api/teams/${teamId}/forms/${formId}/draft`)
        const body = await readBody(response)
        if (cancelled) return
        if (!response.ok) {
          setError(readError(body, "Could not load this form"))
          return
        }
        const draft = body.draft !== undefined ? body.draft : body.form?.draft
        const loadedForm = {
          ...(body.form ?? { id: formId, name: draft?.definition?.title ?? "Form" }),
          availability: body.availability ?? body.form?.availability,
          published_version: body.publishedVersion ?? body.form?.published_version ?? null,
        }
        if (body.legacy === true && draft === null) {
          const definition = createFormDefinition(initialName?.trim() || "Untitled form")
          setForm({
            id: formId,
            name: initialName?.trim() || "Untitled form",
            availability: body.availability,
            published_version: body.publishedVersion,
          })
          setBuilder(createBuilderState(definition, 0))
          setDraftExists(false)
          setPublishedRevision(null)
          setStatus("New structured draft")
          return
        }
        if (!draft?.definition || typeof draft.revision !== "number") {
          setError("The form draft response is incomplete")
          return
        }
        setForm(loadedForm as LoadedForm)
        setBuilder(createBuilderState(draft.definition as FormDefinition, draft.revision))
        setDraftExists(true)
        setPublishedRevision(
          typeof body.lastPublishedDraftRevision === "number"
            ? body.lastPublishedDraftRevision
            : null,
        )
        setStatus(`Draft revision ${draft.revision}`)
      } catch {
        if (!cancelled) setError("Could not load this form")
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [formId, initialName, teamId])

  const selectedField = useMemo(() => {
    if (!builder) return null
    return builder.definition.fields.find((field) => field.id === builder.selectedFieldId) ?? null
  }, [builder])

  function commit(
    edit: (definition: FormDefinition) => FormDefinition,
    selectedFieldId = builder?.selectedFieldId ?? null,
  ) {
    if (!builder) return
    try {
      setBuilder((current) =>
        current
          ? applyBuilderDefinition(current, edit(current.definition), selectedFieldId)
          : current,
      )
      setIssues([])
      setError("")
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That change is not valid")
    }
  }

  function addControl(control: FieldControl) {
    if (!builder) return
    const id = `${formId}-field-${Date.now()}-${idCounter.current++}`
    commit((definition) => {
      const field = createField(
        control,
        { id },
        definition.fields.map((item) => item.name),
      )
      return addField(definition, field)
    }, id)
  }

  function editSelected(update: Readonly<Record<string, unknown>>) {
    if (!builder?.selectedFieldId) return
    const selectedId = builder.selectedFieldId
    commit((definition) => updateField(definition, selectedId, update), selectedId)
  }

  function moveSelected(offset: number) {
    if (!builder || !selectedField) return
    const index = builder.definition.fields.findIndex((field) => field.id === selectedField.id)
    commit(
      (definition) => moveField(definition, selectedField.id, index + offset),
      selectedField.id,
    )
  }

  function reorderField(fieldId: string, targetIndex: number) {
    commit((definition) => moveField(definition, fieldId, targetIndex), fieldId)
  }

  function duplicateSelected() {
    if (!selectedField) return
    const id = `${formId}-field-${Date.now()}-${idCounter.current++}`
    commit((definition) => duplicateField(definition, selectedField.id, id), id)
  }

  function removeSelected() {
    if (!builder || !selectedField) return
    const index = builder.definition.fields.findIndex((field) => field.id === selectedField.id)
    const nextId =
      builder.definition.fields[index + 1]?.id ?? builder.definition.fields[index - 1]?.id ?? null
    commit((definition) => removeField(definition, selectedField.id), nextId)
  }

  async function saveDraft(): Promise<number | null> {
    if (!builder) return null
    if (!builder.dirty && draftExists) return builder.baseRevision
    setBusy("save")
    setError("")
    setIssues([])
    try {
      const response = await fetch(`/api/teams/${teamId}/forms/${formId}/draft`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedRevision: builder.baseRevision,
          definition: builder.definition,
        }),
      })
      const body = await readBody(response)
      if (!response.ok) {
        applyResponseError(body, "Could not save the draft", setError, setIssues)
        return null
      }
      const draft = body.draft
      if (!draft || typeof draft.revision !== "number") {
        setError("The save response did not include a revision")
        return null
      }
      setBuilder((current) => (current ? markBuilderSaved(current, draft.revision) : current))
      setDraftExists(true)
      setStatus(`Draft saved · revision ${draft.revision}`)
      return draft.revision
    } catch {
      setError("Could not save the draft")
      return null
    } finally {
      setBusy(null)
    }
  }

  async function publish() {
    const revision = await saveDraft()
    if (revision === null) return
    setBusy("publish")
    setError("")
    setIssues([])
    try {
      const response = await fetch(`/api/teams/${teamId}/forms/${formId}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedRevision: revision }),
      })
      const body = await readBody(response)
      if (!response.ok) {
        applyResponseError(body, "Could not publish the form", setError, setIssues)
        return
      }
      const published = body.published
      if (!published || typeof published.version !== "number") {
        setError("The publish response did not include a version")
        return
      }
      const availability = body.availability === "paused" ? "paused" : "active"
      setForm((current) =>
        current
          ? {
              ...current,
              availability,
              is_active: availability === "active",
              published_version: published.version,
            }
          : current,
      )
      setPublishedRevision(revision)
      setStatus(`Published · version ${published.version}`)
    } catch {
      setError("Could not publish the form")
    } finally {
      setBusy(null)
    }
  }

  if (error && !builder) {
    return <LoadState title="Form unavailable" detail={error} />
  }
  if (!builder) return <LoadState title="Loading form" detail="Preparing the latest draft…" />

  const selectedIndex = selectedField
    ? builder.definition.fields.findIndex((field) => field.id === selectedField.id)
    : -1

  return (
    <div className="pb-12">
      <header className="border-b border-gray-200 pb-5">
        <Link
          href="/dashboard/forms"
          className="inline-flex text-xs font-medium text-gray-500 hover:text-gray-900"
        >
          ← Forms
        </Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-5">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight text-gray-950">
                {builder.definition.title}
              </h1>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${form?.published_version ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-600"}`}
              >
                {form?.published_version ? `Published v${form.published_version}` : "Draft"}
              </span>
            </div>
            <p className="mt-1 text-sm text-gray-500">
              {status}
              {builder.dirty ? " · Unsaved changes" : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={builder.past.length === 0}
              onClick={() => setBuilder((current) => (current ? undoBuilder(current) : current))}
              className={quietButton}
            >
              Undo
            </button>
            <button
              type="button"
              disabled={builder.future.length === 0}
              onClick={() => setBuilder((current) => (current ? redoBuilder(current) : current))}
              className={quietButton}
            >
              Redo
            </button>
            <button
              type="button"
              disabled={busy !== null || (!builder.dirty && draftExists)}
              onClick={() => void saveDraft()}
              className={secondaryButton}
            >
              {busy === "save" ? "Saving…" : "Save draft"}
            </button>
            <button
              type="button"
              disabled={
                busy !== null || (publishedRevision === builder.baseRevision && !builder.dirty)
              }
              onClick={() => void publish()}
              className="rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
            >
              {busy === "publish"
                ? "Publishing…"
                : publishedRevision === builder.baseRevision && !builder.dirty
                  ? "Published"
                  : "Publish"}
            </button>
          </div>
        </div>
      </header>

      <nav aria-label="Editor views" className="flex gap-1 py-4">
        {(["build", "preview"] as const).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setView(item)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${view === item ? "bg-gray-950 text-white" : "text-gray-600 hover:bg-gray-100"}`}
          >
            {item[0].toUpperCase() + item.slice(1)}
          </button>
        ))}
      </nav>

      {error ? <ErrorSummary message={error} issues={issues} /> : null}

      {view === "build" ? (
        <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="grid min-h-[650px] lg:grid-cols-[180px_minmax(320px,1fr)_280px]">
            <aside className="border-b border-gray-200 bg-gray-50/80 p-4 lg:border-b-0 lg:border-r">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
                Add field
              </p>
              <div className="space-y-1">
                {controls.map((item) => (
                  <button
                    key={item.control}
                    type="button"
                    onClick={() => addControl(item.control)}
                    className="w-full rounded-md px-2.5 py-2 text-left text-sm font-medium text-gray-700 hover:bg-white hover:text-gray-950 hover:shadow-sm"
                  >
                    + {item.label}
                  </button>
                ))}
              </div>
            </aside>

            <main className="bg-[#f4f5f7] p-4 sm:p-7">
              <div className="mx-auto max-w-xl rounded-xl bg-white px-5 py-7 shadow-[0_12px_36px_rgba(15,23,42,0.08)] sm:px-8">
                <TextDraft
                  label="Form title"
                  value={builder.definition.title}
                  onCommit={(title) =>
                    title.trim() && commit((definition) => updateForm(definition, { title }))
                  }
                  heading
                />
                <TextDraft
                  label="Form description"
                  value={builder.definition.description ?? ""}
                  onCommit={(description) =>
                    commit((definition) => updateForm(definition, { description }))
                  }
                  multiline
                  subtle
                />
                <div className="mt-7 space-y-3">
                  {builder.definition.fields.map((field, index) => {
                    const selected = field.id === builder.selectedFieldId
                    return (
                      <DraggableField
                        key={field.id}
                        fieldId={field.id}
                        index={index}
                        onReorder={reorderField}
                      >
                        {({ dragHandleRef }) => (
                          <div
                            className={`rounded-lg border bg-white transition-[border-color,box-shadow] ${
                              selected
                                ? "border-teal-500 shadow-[0_0_0_3px_rgba(13,148,136,0.14)]"
                                : "border-gray-200 hover:border-gray-300"
                            }`}
                          >
                            <div className="flex items-stretch">
                              <button
                                ref={dragHandleRef}
                                type="button"
                                aria-label={`Drag ${field.label} to reorder`}
                                title="Drag to reorder"
                                onClick={() =>
                                  setBuilder((current) =>
                                    current ? selectBuilderField(current, field.id) : current,
                                  )
                                }
                                className="w-10 shrink-0 cursor-grab border-r border-gray-100 text-lg leading-none text-gray-300 transition-colors hover:bg-gray-50 hover:text-teal-600 active:cursor-grabbing"
                              >
                                ⠿
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setBuilder((current) =>
                                    current ? selectBuilderField(current, field.id) : current,
                                  )
                                }
                                className="min-w-0 flex-1 px-4 py-3.5 text-left"
                              >
                                <span className="flex items-center justify-between gap-3">
                                  <span className="text-sm font-medium text-gray-900">
                                    {field.label}
                                    {field.required ? (
                                      <span className="ml-1 text-teal-600">*</span>
                                    ) : null}
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
                                <MiniButton
                                  label="↑"
                                  title="Move up"
                                  disabled={index === 0}
                                  onClick={() => moveSelected(-1)}
                                />
                                <MiniButton
                                  label="↓"
                                  title="Move down"
                                  disabled={index === builder.definition.fields.length - 1}
                                  onClick={() => moveSelected(1)}
                                />
                                <MiniButton label="Duplicate" onClick={duplicateSelected} />
                                <MiniButton label="Remove" danger onClick={removeSelected} />
                              </div>
                            ) : null}
                          </div>
                        )}
                      </DraggableField>
                    )
                  })}
                  {builder.definition.fields.length === 0 ? (
                    <button
                      type="button"
                      onClick={() => addControl("text")}
                      className="w-full rounded-lg border border-dashed border-gray-300 px-4 py-10 text-sm text-gray-500 hover:border-teal-400 hover:text-teal-600"
                    >
                      Add your first field
                    </button>
                  ) : null}
                </div>
              </div>
            </main>

            <aside className="border-t border-gray-200 p-5 lg:border-l lg:border-t-0">
              {selectedField ? (
                <Inspector
                  field={selectedField}
                  index={selectedIndex}
                  total={builder.definition.fields.length}
                  onEdit={editSelected}
                  onMove={moveSelected}
                  onDuplicate={duplicateSelected}
                  onRemove={removeSelected}
                />
              ) : (
                <EmptySelection />
              )}
            </aside>
          </div>
        </section>
      ) : null}

      {view === "preview" ? <EditorPreview definition={builder.definition} /> : null}
    </div>
  )
}

function Inspector({
  field,
  index,
  total,
  onEdit,
  onMove,
  onDuplicate,
  onRemove,
}: {
  readonly field: FormFieldDefinition
  readonly index: number
  readonly total: number
  readonly onEdit: (update: Readonly<Record<string, unknown>>) => void
  readonly onMove: (offset: number) => void
  readonly onDuplicate: () => void
  readonly onRemove: () => void
}) {
  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
          Field settings
        </p>
        <p className="mt-1 text-sm font-semibold text-gray-950">{controlLabel(field.control)}</p>
      </div>
      <TextDraft
        label="Label"
        value={field.label}
        onCommit={(label) => label.trim() && onEdit({ label })}
      />
      <TextDraft
        label="Submission key"
        value={field.name}
        onCommit={(name) => name.trim() && onEdit({ name })}
        mono
      />
      <TextDraft
        label="Help text"
        value={field.description ?? ""}
        onCommit={(description) => onEdit({ description })}
        multiline
      />
      {field.control !== "checkbox" ? (
        <TextDraft
          label="Placeholder"
          value={field.placeholder ?? ""}
          onCommit={(placeholder) => onEdit({ placeholder })}
        />
      ) : null}
      <label className="flex cursor-pointer items-center justify-between rounded-md bg-gray-50 px-3 py-2.5 text-sm text-gray-700">
        Required response
        <input
          type="checkbox"
          checked={field.required}
          onChange={(event) => onEdit({ required: event.target.checked })}
          className="h-4 w-4 rounded accent-teal-600"
        />
      </label>
      {field.type === "number" ? (
        <div className="grid grid-cols-2 gap-3">
          <NumberDraft
            label="Minimum"
            value={field.validation?.min}
            onCommit={(min) => onEdit({ validation: cleanObject({ ...field.validation, min }) })}
          />
          <NumberDraft
            label="Maximum"
            value={field.validation?.max}
            onCommit={(max) => onEdit({ validation: cleanObject({ ...field.validation, max }) })}
          />
        </div>
      ) : null}
      {field.type === "string" && field.control !== "email" ? (
        <div className="grid grid-cols-2 gap-3">
          <NumberDraft
            label="Min length"
            value={field.validation?.minLength}
            onCommit={(minLength) =>
              onEdit({ validation: cleanObject({ ...field.validation, minLength }) })
            }
          />
          <NumberDraft
            label="Max length"
            value={field.validation?.maxLength}
            onCommit={(maxLength) =>
              onEdit({ validation: cleanObject({ ...field.validation, maxLength }) })
            }
          />
        </div>
      ) : null}
      {field.type === "enum" ? (
        <TextDraft
          label="Options (one per line)"
          value={field.values.join("\n")}
          multiline
          onCommit={(value) => {
            const values = value
              .split("\n")
              .map((item) => item.trim())
              .filter(Boolean)
            if (values.length) onEdit({ values })
          }}
        />
      ) : null}
      <div className="flex flex-wrap gap-1 border-t border-gray-200 pt-4">
        <MiniButton label="↑ Up" disabled={index === 0} onClick={() => onMove(-1)} />
        <MiniButton label="↓ Down" disabled={index === total - 1} onClick={() => onMove(1)} />
        <MiniButton label="Duplicate" onClick={onDuplicate} />
        <MiniButton label="Remove" danger onClick={onRemove} />
      </div>
    </div>
  )
}

function EditorPreview({ definition }: { readonly definition: FormDefinition }) {
  const [tested, setTested] = useState(false)

  return (
    <section className="rounded-xl border border-gray-200 bg-[#ebe9e4] px-4 py-10 sm:px-10">
      <div className="mx-auto max-w-xl rounded-2xl bg-white px-6 py-8 shadow-[0_18px_60px_rgba(15,23,42,0.12)] sm:px-10">
        <p className="text-xs font-semibold uppercase tracking-wider text-teal-600">
          Respondent preview
        </p>
        <h2 className="mt-3 text-2xl font-semibold text-gray-950">{definition.title}</h2>
        {definition.description ? (
          <p className="mt-2 text-sm leading-6 text-gray-600">{definition.description}</p>
        ) : null}
        <RespondentForm
          key={definition.fields.map((field) => field.id).join(":")}
          definition={definition}
          onSubmit={() => setTested(true)}
          className="mt-8"
        />
        {tested ? (
          <p role="status" className="mt-3 text-center text-xs font-medium text-emerald-700">
            Preview passed validation. Nothing was submitted.
          </p>
        ) : null}
        <p className="mt-3 text-center text-xs text-gray-500">
          Test responses stay in this browser and never reach the submission endpoint.
        </p>
      </div>
    </section>
  )
}

function TextDraft({
  label,
  value,
  onCommit,
  multiline = false,
  mono = false,
  heading = false,
  subtle = false,
}: {
  readonly label: string
  readonly value: string
  readonly onCommit: (value: string) => void
  readonly multiline?: boolean
  readonly mono?: boolean
  readonly heading?: boolean
  readonly subtle?: boolean
}) {
  const className = heading
    ? "w-full border-0 bg-transparent p-0 text-xl font-semibold text-gray-950 outline-none focus:ring-0"
    : subtle
      ? "mt-2 w-full resize-none border-0 bg-transparent p-0 text-sm leading-5 text-gray-500 outline-none focus:ring-0"
      : `w-full rounded-md border border-gray-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100 ${mono ? "font-mono text-xs" : ""}`
  return (
    <label className={heading || subtle ? "block" : "block text-xs font-medium text-gray-600"}>
      {heading || subtle ? (
        <span className="sr-only">{label}</span>
      ) : (
        <span className="mb-1.5 block">{label}</span>
      )}
      {multiline ? (
        <textarea
          key={value}
          rows={subtle ? 2 : 4}
          defaultValue={value}
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

function NumberDraft({
  label,
  value,
  onCommit,
}: {
  readonly label: string
  readonly value?: number
  readonly onCommit: (value?: number) => void
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
        className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm outline-none focus:border-teal-500"
      />
    </label>
  )
}

function MiniButton({
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
      className={`rounded-md px-2.5 py-1.5 text-xs font-medium disabled:opacity-30 ${danger ? "text-red-600 hover:bg-red-50" : "text-gray-600 hover:bg-gray-100 hover:text-gray-950"}`}
    >
      {label}
    </button>
  )
}

function ErrorSummary({
  message,
  issues,
}: {
  readonly message: string
  readonly issues: readonly FormIssue[]
}) {
  return (
    <div
      role="alert"
      className="mb-4 border-l-2 border-red-500 bg-red-50 px-4 py-3 text-sm text-red-800"
    >
      <p className="font-medium">{message}</p>
      {issues.length ? (
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {issues.map((issue, index) => (
            <li key={`${issue.path}-${index}`}>
              {issue.message}
              <span className="ml-1 font-mono text-xs text-red-600">{issue.path}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function LoadState({ title, detail }: { readonly title: string; readonly detail: string }) {
  return (
    <div className="py-16 text-center">
      <h1 className="text-lg font-semibold text-gray-950">{title}</h1>
      <p className="mt-2 text-sm text-gray-500">{detail}</p>
      <Link href="/dashboard/forms" className="mt-5 inline-flex text-sm font-medium text-teal-600">
        Back to forms
      </Link>
    </div>
  )
}

function EmptySelection() {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center text-center">
      <p className="text-sm font-medium text-gray-800">Select a field</p>
      <p className="mt-1 text-xs leading-5 text-gray-500">
        Choose a field on the canvas to edit its settings.
      </p>
    </div>
  )
}

function controlLabel(control: FieldControl) {
  return controls.find((item) => item.control === control)?.label ?? control
}

function cleanObject(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined))
}

const quietButton =
  "rounded-md px-2.5 py-2 text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-30"
const secondaryButton =
  "rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"

async function readBody(response: Response): Promise<EditorApiBody> {
  const value: unknown = await response.json().catch(() => ({}))
  return isObject(value) ? (value as EditorApiBody) : {}
}

function readError(body: EditorApiBody, fallback: string) {
  return typeof body.error === "string" ? body.error : fallback
}

function applyResponseError(
  body: EditorApiBody,
  fallback: string,
  setError: (message: string) => void,
  setIssues: (issues: readonly FormIssue[]) => void,
) {
  setError(readError(body, fallback))
  setIssues(Array.isArray(body.issues) ? body.issues.filter(isFormIssue) : [])
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isFormIssue(value: unknown): value is FormIssue {
  return (
    isObject(value) &&
    typeof value.code === "string" &&
    typeof value.message === "string" &&
    typeof value.path === "string"
  )
}
