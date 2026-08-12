"use client"

import {
  type FieldControl,
  type FormDefinition,
  type FormFieldDefinition,
  type NormalizedSubmission,
} from "@screeem/forms"
import {
  useRespondentForm,
  validateRespondentField,
  type RespondentInputValue,
} from "@screeem/forms-react"
import { createElement, useId, type ComponentType } from "react"

export interface RespondentControlProps {
  readonly field: FormFieldDefinition
  readonly id: string
  readonly value: RespondentInputValue
  readonly disabled: boolean
  readonly describedBy?: string
  readonly invalid: boolean
  readonly onBlur: () => void
  readonly onChange: (value: RespondentInputValue) => void
}

export type RespondentControlRegistry = Partial<
  Record<FieldControl, ComponentType<RespondentControlProps>>
>

export interface RespondentFormProps {
  readonly definition: FormDefinition
  readonly onSubmit: (values: NormalizedSubmission) => Promise<void> | void
  readonly controls?: RespondentControlRegistry
  readonly className?: string
}

/**
 * TanStack Form respondent behavior over a plain Screeem form definition.
 * Hosts may replace any control renderer without changing validation or
 * submission normalization.
 */
export function RespondentForm({
  definition,
  onSubmit,
  controls = {},
  className,
}: RespondentFormProps) {
  const formId = useId()
  const { form, submissionError } = useRespondentForm({ definition, onSubmit })

  return (
    <form
      className={className}
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        event.stopPropagation()
        void form.handleSubmit()
      }}
    >
      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(isSubmitting) => (
          <div className="space-y-6">
            {definition.fields.map((definitionField) => (
              <form.Field
                key={definitionField.id}
                name={definitionField.name}
                validators={{
                  onBlur: ({ value }) => validateRespondentField(definitionField, value),
                  onSubmit: ({ value }) => validateRespondentField(definitionField, value),
                }}
              >
                {(fieldApi) => {
                  const inputId = `${formId}-${definitionField.id}`
                  const descriptionId = definitionField.description
                    ? `${inputId}-description`
                    : undefined
                  const error = fieldApi.state.meta.errors[0]
                  const errorId = error ? `${inputId}-error` : undefined
                  const describedBy =
                    [descriptionId, errorId].filter(Boolean).join(" ") || undefined
                  const Control = controls[definitionField.control] ?? DefaultControl

                  return (
                    <div>
                      {definitionField.control !== "checkbox" ? (
                        <label
                          htmlFor={inputId}
                          className="mb-2 block text-sm font-medium text-gray-900"
                        >
                          {definitionField.label}
                          {definitionField.required ? (
                            <span className="ml-1 text-teal-600" aria-hidden="true">
                              *
                            </span>
                          ) : null}
                        </label>
                      ) : null}

                      {createElement(Control, {
                        field: definitionField,
                        id: inputId,
                        value: fieldApi.state.value,
                        disabled: isSubmitting,
                        ...(describedBy ? { describedBy } : {}),
                        invalid: Boolean(error),
                        onBlur: fieldApi.handleBlur,
                        onChange: fieldApi.handleChange,
                      })}

                      {definitionField.description ? (
                        <p id={descriptionId} className="mt-1.5 text-xs leading-5 text-gray-500">
                          {definitionField.description}
                        </p>
                      ) : null}
                      {error ? (
                        <p
                          id={errorId}
                          role="alert"
                          className="mt-1.5 text-xs font-medium text-red-600"
                        >
                          {String(error)}
                        </p>
                      ) : null}
                    </div>
                  )
                }}
              </form.Field>
            ))}
          </div>
        )}
      </form.Subscribe>

      {submissionError ? (
        <p
          role="alert"
          className="mt-5 border-l-2 border-red-500 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {submissionError}
        </p>
      ) : null}

      <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
        {([canSubmit, isSubmitting]) => (
          <button
            type="submit"
            disabled={!canSubmit || isSubmitting}
            className="mt-8 w-full rounded-lg bg-teal-600 px-4 py-3 text-sm font-semibold text-white transition-[background-color,transform] duration-150 hover:bg-teal-700 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? "Sending…" : definition.submitLabel}
          </button>
        )}
      </form.Subscribe>
    </form>
  )
}

function DefaultControl({
  field,
  id,
  value,
  disabled,
  describedBy,
  invalid,
  onBlur,
  onChange,
}: RespondentControlProps) {
  const common = {
    id,
    disabled,
    "aria-describedby": describedBy,
    "aria-invalid": invalid,
    "aria-required": field.required,
    onBlur,
    className:
      "w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-950 outline-none transition-[border-color,box-shadow] focus:border-teal-500 focus:ring-2 focus:ring-teal-100 disabled:bg-gray-50",
  }

  switch (field.control) {
    case "textarea":
      return (
        <textarea
          {...common}
          rows={5}
          placeholder={field.placeholder}
          value={String(value)}
          onChange={(event) => onChange(event.target.value)}
        />
      )

    case "select":
      return (
        <select
          {...common}
          value={String(value)}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">Choose an option</option>
          {field.values.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      )

    case "checkbox":
      return (
        <label className="flex cursor-pointer items-start gap-3 text-sm text-gray-800">
          <input
            id={id}
            type="checkbox"
            checked={value === true}
            disabled={disabled}
            aria-describedby={describedBy}
            aria-invalid={invalid}
            aria-required={field.required}
            onBlur={onBlur}
            onChange={(event) => onChange(event.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-gray-300 accent-teal-600"
          />
          <span>
            {field.label}
            {field.required ? (
              <span className="ml-1 text-teal-600" aria-hidden="true">
                *
              </span>
            ) : null}
          </span>
        </label>
      )

    case "email":
    case "number":
    case "text":
      return (
        <input
          {...common}
          type={field.control}
          inputMode={field.control === "number" ? "decimal" : undefined}
          placeholder={field.placeholder}
          value={String(value)}
          onChange={(event) => onChange(event.target.value)}
        />
      )
  }
}
