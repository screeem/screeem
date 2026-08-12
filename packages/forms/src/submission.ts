import { snapshotFormDefinition } from "./definition.js"
import { InvalidSubmissionError } from "./errors.js"
import type {
  FormDefinition,
  FormFieldDefinition,
  SubmissionIssue,
  SubmissionMode,
} from "./model.js"

export interface NormalizeSubmissionOptions {
  readonly mode: SubmissionMode
}

type SubmissionValue<Field extends FormFieldDefinition> = Field extends {
  readonly type: "enum"
  readonly values: readonly (infer Value extends string)[]
}
  ? Value
  : Field extends { readonly type: "number" }
    ? number
    : Field extends { readonly type: "boolean" }
      ? boolean
      : string

type DefinitionField<Definition extends FormDefinition> = Definition["fields"][number]

export type NormalizedSubmission<Definition extends FormDefinition = FormDefinition> =
  string extends DefinitionField<Definition>["name"]
    ? Readonly<Record<string, string | number | boolean>>
    : Readonly<
        {
          [Field in DefinitionField<Definition> as Field["required"] extends true
            ? Field["name"]
            : never]: SubmissionValue<Field>
        } & {
          [Field in DefinitionField<Definition> as Field["required"] extends false
            ? Field["name"]
            : never]?: SubmissionValue<Field>
        }
      >

const unsafeKeys = new Set(["__proto__", "prototype", "constructor"])
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const decimalPattern = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/

/**
 * Takes an untrusted transport payload and returns values safe to persist and
 * pass to routing. The definition is snapshotted before the payload is read so
 * validation cannot be changed through later mutation.
 */
export function normalizeSubmission<const Definition extends FormDefinition>(
  definition: Definition,
  input: unknown,
  options: NormalizeSubmissionOptions,
): NormalizedSubmission<Definition> {
  const current = snapshotFormDefinition(definition, { publishable: true })
  const parsed = readSubmissionInput(input, options.mode)
  const issues = [...parsed.issues]
  const fields = new Map(current.fields.map((field) => [field.name, field]))

  for (const key of parsed.values.keys()) {
    if (unsafeKeys.has(key)) {
      issues.push(submissionIssue("unsafe_field", `Submission field ${key} is not safe`, key))
    } else if (!fields.has(key)) {
      issues.push(submissionIssue("unknown_field", `Unknown submission field ${key}`, key))
    }
  }

  const normalized = Object.create(null) as Record<string, string | number | boolean>
  for (const field of current.fields) {
    const entry = parsed.values.get(field.name)
    const result = normalizeField(field, entry, options.mode)
    issues.push(...result.issues)
    if (result.value !== undefined) normalized[field.name] = result.value
  }

  if (issues.length > 0) {
    throw new InvalidSubmissionError(Object.freeze(issues))
  }

  return Object.freeze(normalized) as NormalizedSubmission<Definition>
}

interface InputEntry {
  readonly present: boolean
  readonly value?: unknown
}

interface ParsedInput {
  readonly values: ReadonlyMap<string, InputEntry>
  readonly issues: readonly SubmissionIssue[]
}

function readSubmissionInput(input: unknown, mode: SubmissionMode): ParsedInput {
  if (mode === "form" && isFormData(input)) return readFormData(input)
  if (!isPlainObject(input)) {
    throwInvalidInput("Submission must be a plain object or FormData")
  }

  const values = new Map<string, InputEntry>()
  const issues: SubmissionIssue[] = []
  let names: string[]
  let symbols: symbol[]

  try {
    names = Object.getOwnPropertyNames(input)
    symbols = Object.getOwnPropertySymbols(input)
  } catch {
    throwInvalidInput("Submission properties could not be read safely")
  }

  if (symbols.length > 0) {
    issues.push(submissionIssue("symbol_not_allowed", "Submission cannot contain symbol fields"))
  }

  for (const name of names) {
    let descriptor: PropertyDescriptor | undefined
    try {
      descriptor = Object.getOwnPropertyDescriptor(input, name)
    } catch {
      issues.push(
        submissionIssue("unsafe_input", `Submission field ${name} could not be read safely`, name),
      )
      continue
    }
    if (!descriptor || !("value" in descriptor)) {
      issues.push(
        submissionIssue("accessor_not_allowed", "Submission accessors are not allowed", name),
      )
      continue
    }
    if (Array.isArray(descriptor.value)) {
      issues.push(
        submissionIssue("duplicate_value", `Submission field ${name} must have one value`, name),
      )
      continue
    }
    if (isFileLike(descriptor.value)) {
      issues.push(
        submissionIssue("unsupported_file", `Submission field ${name} cannot contain a file`, name),
      )
      continue
    }
    values.set(name, { present: true, value: descriptor.value })
  }

  return { values, issues }
}

function readFormData(input: FormData): ParsedInput {
  const values = new Map<string, InputEntry>()
  const issues: SubmissionIssue[] = []

  try {
    for (const [name, value] of input.entries()) {
      if (values.has(name)) {
        issues.push(
          submissionIssue("duplicate_value", `Submission field ${name} must have one value`, name),
        )
        continue
      }
      if (typeof value !== "string") {
        issues.push(
          submissionIssue(
            "unsupported_file",
            `Submission field ${name} cannot contain a file`,
            name,
          ),
        )
        continue
      }
      values.set(name, { present: true, value })
    }
  } catch {
    throwInvalidInput("FormData entries could not be read safely")
  }

  return { values, issues }
}

interface NormalizedField {
  readonly value?: string | number | boolean
  readonly issues: readonly SubmissionIssue[]
}

function normalizeField(
  field: FormFieldDefinition,
  entry: InputEntry | undefined,
  mode: SubmissionMode,
): NormalizedField {
  if (field.type === "boolean" && mode === "form") {
    const value = entry?.present === true
    if (field.required && !value) return requiredField(field)
    return { value, issues: [] }
  }

  if (!entry?.present || isMissingValue(field, entry.value, mode)) {
    return field.required ? requiredField(field) : { issues: [] }
  }

  switch (field.type) {
    case "string":
      return normalizeString(field, entry.value)
    case "number":
      return normalizeNumber(field, entry.value, mode)
    case "boolean":
      if (typeof entry.value !== "boolean") return invalidType(field, "a boolean")
      if (field.required && !entry.value) return requiredField(field)
      return { value: entry.value, issues: [] }
    case "enum":
      if (typeof entry.value !== "string") return invalidType(field, "a string")
      if (!field.values.includes(entry.value)) {
        return {
          issues: [
            submissionIssue(
              "invalid_enum",
              `${field.label} must be one of the configured options`,
              field.name,
            ),
          ],
        }
      }
      return { value: entry.value, issues: [] }
  }
}

function normalizeString(
  field: Extract<FormFieldDefinition, { readonly type: "string" }>,
  value: unknown,
): NormalizedField {
  if (typeof value !== "string") return invalidType(field, "a string")
  if (!field.required && value.length === 0) return { value, issues: [] }
  const issues: SubmissionIssue[] = []
  const { minLength, maxLength } = field.validation ?? {}

  if (minLength !== undefined && value.length < minLength) {
    issues.push(
      submissionIssue(
        "min_length",
        `${field.label} must be at least ${minLength} characters`,
        field.name,
      ),
    )
  }
  if (maxLength !== undefined && value.length > maxLength) {
    issues.push(
      submissionIssue(
        "max_length",
        `${field.label} must be at most ${maxLength} characters`,
        field.name,
      ),
    )
  }
  if (field.control === "email" && !emailPattern.test(value)) {
    issues.push(
      submissionIssue("invalid_email", `${field.label} must be a valid email address`, field.name),
    )
  }

  return issues.length > 0 ? { issues } : { value, issues }
}

function normalizeNumber(
  field: Extract<FormFieldDefinition, { readonly type: "number" }>,
  input: unknown,
  mode: SubmissionMode,
): NormalizedField {
  let value: number
  if (mode === "json") {
    if (typeof input !== "number" || !Number.isFinite(input)) return invalidNumber(field)
    value = input
  } else {
    if (typeof input !== "string" || !decimalPattern.test(input.trim())) return invalidNumber(field)
    value = Number(input)
    if (!Number.isFinite(value)) return invalidNumber(field)
  }

  const issues: SubmissionIssue[] = []
  const { min, max } = field.validation ?? {}
  if (min !== undefined && value < min) {
    issues.push(submissionIssue("minimum", `${field.label} must be at least ${min}`, field.name))
  }
  if (max !== undefined && value > max) {
    issues.push(submissionIssue("maximum", `${field.label} must be at most ${max}`, field.name))
  }
  return issues.length > 0 ? { issues } : { value, issues }
}

function isMissingValue(field: FormFieldDefinition, value: unknown, mode: SubmissionMode) {
  if (value !== "") return false
  if (field.required && (field.type === "string" || mode === "form")) return true
  return mode === "form" && field.type !== "string"
}

function requiredField(field: FormFieldDefinition): NormalizedField {
  return {
    issues: [submissionIssue("required", `${field.label} is required`, field.name)],
  }
}

function invalidType(field: FormFieldDefinition, expected: string): NormalizedField {
  return {
    issues: [submissionIssue("invalid_type", `${field.label} must be ${expected}`, field.name)],
  }
}

function invalidNumber(field: FormFieldDefinition): NormalizedField {
  return {
    issues: [
      submissionIssue("invalid_number", `${field.label} must be a finite number`, field.name),
    ],
  }
}

function submissionIssue(code: string, message: string, field?: string): SubmissionIssue {
  return Object.freeze({ code, message, ...(field === undefined ? {} : { field }) })
}

function throwInvalidInput(message: string): never {
  throw new InvalidSubmissionError(Object.freeze([submissionIssue("invalid_type", message)]))
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false
    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
  } catch {
    return false
  }
}

function isFormData(value: unknown): value is FormData {
  try {
    return typeof FormData !== "undefined" && value instanceof FormData
  } catch {
    return false
  }
}

function isFileLike(value: unknown): boolean {
  try {
    if (typeof Blob !== "undefined" && value instanceof Blob) return true
    return typeof File !== "undefined" && value instanceof File
  } catch {
    // A value that cannot safely expose its prototype is not submission data.
    return true
  }
}
