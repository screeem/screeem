"use client"

import {
  InvalidSubmissionError,
  normalizeSubmission,
  type FormDefinition,
  type FormFieldDefinition,
  type NormalizedSubmission,
} from "@screeem/forms"
import { useForm } from "@tanstack/react-form"
import { useState } from "react"

export type RespondentInputValue = string | boolean
export type RespondentInputValues = Record<string, RespondentInputValue>

export interface RespondentFormOptions {
  readonly definition: FormDefinition
  readonly onSubmit: (values: NormalizedSubmission) => Promise<void> | void
}

/**
 * TanStack Form state and normalized submission behavior without any rendering
 * or styling decisions.
 */
export function useRespondentForm({ definition, onSubmit }: RespondentFormOptions) {
  const [submissionError, setSubmissionError] = useState<string | null>(null)
  const defaultValues = Object.fromEntries(
    definition.fields.map((field) => [field.name, field.type === "boolean" ? false : ""]),
  ) as RespondentInputValues

  const form = useForm({
    defaultValues,
    onSubmit: async ({ value }) => {
      setSubmissionError(null)
      try {
        await onSubmit(normalizeRespondentValues(definition, value))
      } catch (error) {
        if (error instanceof InvalidSubmissionError) {
          setSubmissionError(error.issues[0]?.message ?? "Check the highlighted answers.")
          return
        }
        setSubmissionError(
          error instanceof Error ? error.message : "Your response could not be sent.",
        )
      }
    },
  })

  return { form, submissionError, setSubmissionError } as const
}

export function normalizeRespondentValues(
  definition: FormDefinition,
  values: RespondentInputValues,
): NormalizedSubmission {
  const transport = Object.create(null) as Record<string, string>
  for (const field of definition.fields) {
    const value = values[field.name]
    if (field.type === "boolean") {
      if (value === true) transport[field.name] = "on"
    } else if (typeof value === "string") {
      transport[field.name] = value
    }
  }
  return normalizeSubmission(definition, transport, { mode: "form" })
}

export function validateRespondentField(
  field: FormFieldDefinition,
  value: unknown,
): string | undefined {
  if (field.type === "boolean") {
    return field.required && value !== true ? `${field.label} is required` : undefined
  }

  if (typeof value !== "string") return `${field.label} has an invalid value`
  if (value === "") return field.required ? `${field.label} is required` : undefined

  if (field.type === "number") {
    const number = Number(value)
    if (!Number.isFinite(number)) return `${field.label} must be a number`
    if (field.validation?.min !== undefined && number < field.validation.min) {
      return `${field.label} must be at least ${field.validation.min}`
    }
    if (field.validation?.max !== undefined && number > field.validation.max) {
      return `${field.label} must be at most ${field.validation.max}`
    }
    return undefined
  }

  if (field.type === "enum") {
    return field.values.includes(value)
      ? undefined
      : `${field.label} must be one of the available options`
  }

  if (field.validation?.minLength !== undefined && value.length < field.validation.minLength) {
    return `${field.label} must be at least ${field.validation.minLength} characters`
  }
  if (field.validation?.maxLength !== undefined && value.length > field.validation.maxLength) {
    return `${field.label} must be at most ${field.validation.maxLength} characters`
  }
  if (field.control === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    return `${field.label} must be a valid email address`
  }
  return undefined
}
