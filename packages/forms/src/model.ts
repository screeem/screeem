import type { Rule } from "@screeem/routing"

export const FORM_DEFINITION_FORMAT_VERSION = 1 as const
export const FORM_ROUTING_FORMAT_VERSION = 1 as const

export type FieldControl = "text" | "email" | "textarea" | "number" | "checkbox" | "select"

export interface StringValidation {
  readonly minLength?: number
  readonly maxLength?: number
}

export interface NumberValidation {
  readonly min?: number
  readonly max?: number
}

interface BaseFieldDefinition {
  readonly id: string
  readonly name: string
  readonly label: string
  readonly description?: string
  readonly required: boolean
}

export interface StringFieldDefinition extends BaseFieldDefinition {
  readonly type: "string"
  readonly control: "text" | "email" | "textarea"
  readonly placeholder?: string
  readonly validation?: StringValidation
}

export interface NumberFieldDefinition extends BaseFieldDefinition {
  readonly type: "number"
  readonly control: "number"
  readonly placeholder?: string
  readonly validation?: NumberValidation
}

export interface BooleanFieldDefinition extends BaseFieldDefinition {
  readonly type: "boolean"
  readonly control: "checkbox"
}

export interface EnumFieldDefinition extends BaseFieldDefinition {
  readonly type: "enum"
  readonly control: "select"
  readonly placeholder?: string
  readonly values: readonly string[]
}

export type FormFieldDefinition =
  | StringFieldDefinition
  | NumberFieldDefinition
  | BooleanFieldDefinition
  | EnumFieldDefinition

export interface FormDefinition {
  readonly formatVersion: typeof FORM_DEFINITION_FORMAT_VERSION
  readonly title: string
  readonly description?: string
  readonly submitLabel: string
  readonly successMessage: string
  readonly fields: readonly FormFieldDefinition[]
}

export interface FormIssue {
  readonly code: string
  readonly message: string
  readonly path: string
}

/** Schema-free routing data stored with a form draft and compiled against its fields. */
export interface FormRoutingDefinition {
  readonly version: typeof FORM_ROUTING_FORMAT_VERSION
  readonly rules: readonly Rule[]
  readonly fallback: string
}

export interface FormRoutingIssue {
  readonly code: string
  readonly message: string
  readonly path?: string
  readonly ruleId?: string
  readonly start?: number
  readonly end?: number
}

export interface FormDraft {
  readonly formId: string
  readonly revision: number
  readonly definition: FormDefinition
  readonly routing: FormRoutingDefinition | null
}

export interface PublishedForm {
  readonly formId: string
  readonly version: number
  readonly definition: FormDefinition
  readonly routing: FormRoutingDefinition | null
  readonly publishedAt: string
}

export type FormAvailability = "draft" | "active" | "paused"

export interface FormRecord {
  readonly formId: string
  readonly availability: FormAvailability
  readonly draft: FormDraft
  readonly publishedVersion: number | null
}

export interface StoredSubmission {
  readonly id: string
  readonly formId: string
  readonly publicationVersion: number | null
  readonly values: Readonly<Record<string, string | number | boolean>>
  readonly createdAt: string
}

export interface SubmissionIssue {
  readonly code: string
  readonly message: string
  readonly field?: string
}

export type SubmissionMode = "json" | "form"
