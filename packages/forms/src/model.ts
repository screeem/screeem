import type { Rule } from "@screeem/routing"

export const FORM_DEFINITION_FORMAT_VERSION = 1 as const
export const FORM_ROUTING_FORMAT_VERSION = 1 as const
export const FORM_ROUTING_AUTHORING_FORMAT_VERSION = 1 as const

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
  readonly authoring?: FormRoutingAuthoring
}

export type FormRoutingCombinator = "all" | "any"

export type FormRoutingOperator =
  | "equals"
  | "not_equals"
  | "greater_than"
  | "greater_than_or_equal"
  | "less_than"
  | "less_than_or_equal"
  | "is_empty"
  | "is_not_empty"

export interface FormRoutingCondition {
  readonly id: string
  readonly fieldId: string
  readonly operator: FormRoutingOperator
  readonly value?: string | number | boolean
}

export interface FormRoutingAuthoringRule {
  readonly id: string
  readonly combinator: FormRoutingCombinator
  readonly conditions: readonly FormRoutingCondition[]
  readonly route: string
}

/** Versioned visual source used to regenerate runtime routing expressions. */
export interface FormRoutingAuthoring {
  readonly version: typeof FORM_ROUTING_AUTHORING_FORMAT_VERSION
  readonly rules: readonly FormRoutingAuthoringRule[]
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

export interface FormRoutingAuthoringIssue extends FormRoutingIssue {
  readonly conditionId?: string
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
  readonly routing: SubmissionRoutingResult
  readonly createdAt: string
}

export type SubmissionRoutingStatus = "not_configured" | "matched" | "fallback" | "failed"

export interface SubmissionRoutingResult {
  readonly status: SubmissionRoutingStatus
  readonly route: string | null
  readonly matchedRule: string | null
  readonly error: string | null
}

export interface SubmissionIssue {
  readonly code: string
  readonly message: string
  readonly field?: string
}

export type SubmissionMode = "json" | "form"
