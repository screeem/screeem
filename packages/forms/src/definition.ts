import { InvalidFormDefinitionError } from "./errors.js"
import {
  FORM_DEFINITION_FORMAT_VERSION,
  type BooleanFieldDefinition,
  type EnumFieldDefinition,
  type FieldControl,
  type FormDefinition,
  type FormFieldDefinition,
  type FormIssue,
  type NumberFieldDefinition,
  type StringFieldDefinition,
} from "./model.js"

const unsafeNames = new Set(["__proto__", "prototype", "constructor"])
const fieldKeys = new Set([
  "id",
  "name",
  "label",
  "description",
  "required",
  "type",
  "control",
  "placeholder",
  "validation",
  "values",
])
const definitionKeys = new Set([
  "formatVersion",
  "title",
  "description",
  "submitLabel",
  "successMessage",
  "fields",
])

export interface FormValidationOptions {
  readonly publishable?: boolean
}

export function createFormDefinition(title = "Untitled form"): FormDefinition {
  return Object.freeze({
    formatVersion: FORM_DEFINITION_FORMAT_VERSION,
    title,
    submitLabel: "Submit",
    successMessage: "Thanks — your response has been received.",
    fields: Object.freeze([]),
  })
}

export function isSafeFieldName(name: string): boolean {
  return /^[A-Za-z_$][\w$]*$/.test(name) && !unsafeNames.has(name)
}

export function suggestFieldName(label: string, existing: readonly string[] = []): string {
  const normalized = label
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_$]+/g, "_")
    .replace(/^_+|_+$/g, "")
  const base = isSafeFieldName(normalized) ? normalized : `field_${normalized || "value"}`
  const used = new Set(existing)
  if (!used.has(base)) return base
  let suffix = 2
  while (used.has(`${base}_${suffix}`)) suffix += 1
  return `${base}_${suffix}`
}

export function createField(
  control: FieldControl,
  options: { readonly id: string; readonly label?: string; readonly name?: string },
  existingNames: readonly string[] = [],
): FormFieldDefinition {
  const label = options.label ?? defaultLabel(control)
  const name = options.name ?? suggestFieldName(label, existingNames)
  const base = { id: options.id, name, label, required: false } as const

  switch (control) {
    case "text":
    case "email":
    case "textarea":
      return Object.freeze({ ...base, type: "string", control })
    case "number":
      return Object.freeze({ ...base, type: "number", control })
    case "checkbox":
      return Object.freeze({ ...base, type: "boolean", control })
    case "select":
      return Object.freeze({
        ...base,
        type: "enum",
        control,
        values: Object.freeze(["Option 1"]),
      })
  }
}

export function validateFormDefinition(
  input: unknown,
  options: FormValidationOptions = {},
): readonly FormIssue[] {
  return parseDefinition(input, options).issues
}

export function snapshotFormDefinition(
  input: unknown,
  options: FormValidationOptions = {},
): FormDefinition {
  const parsed = parseDefinition(input, options)
  if (!parsed.definition || parsed.issues.length > 0) {
    throw new InvalidFormDefinitionError(Object.freeze(parsed.issues))
  }
  return parsed.definition
}

export function addField(
  definition: FormDefinition,
  field: FormFieldDefinition,
  index = definition.fields.length,
): FormDefinition {
  const current = snapshotFormDefinition(definition)
  const safeIndex = Math.max(0, Math.min(index, current.fields.length))
  const fields = [...current.fields]
  fields.splice(safeIndex, 0, field)
  return snapshotFormDefinition({ ...current, fields })
}

export function updateField(
  definition: FormDefinition,
  fieldId: string,
  update: Readonly<Record<string, unknown>>,
): FormDefinition {
  const current = snapshotFormDefinition(definition)
  const index = current.fields.findIndex((field) => field.id === fieldId)
  if (index < 0) return current
  const fields = [...current.fields]
  fields[index] = { ...fields[index], ...update } as FormFieldDefinition
  return snapshotFormDefinition({ ...current, fields })
}

export function removeField(definition: FormDefinition, fieldId: string): FormDefinition {
  const current = snapshotFormDefinition(definition)
  const fields = current.fields.filter((field) => field.id !== fieldId)
  return fields.length === current.fields.length
    ? current
    : snapshotFormDefinition({ ...current, fields })
}

export function moveField(
  definition: FormDefinition,
  fieldId: string,
  targetIndex: number,
): FormDefinition {
  const current = snapshotFormDefinition(definition)
  const sourceIndex = current.fields.findIndex((field) => field.id === fieldId)
  if (sourceIndex < 0) return current
  const fields = [...current.fields]
  const [field] = fields.splice(sourceIndex, 1)
  if (!field) return current
  fields.splice(Math.max(0, Math.min(targetIndex, fields.length)), 0, field)
  return snapshotFormDefinition({ ...current, fields })
}

export function duplicateField(
  definition: FormDefinition,
  fieldId: string,
  newId: string,
): FormDefinition {
  const current = snapshotFormDefinition(definition)
  const index = current.fields.findIndex((field) => field.id === fieldId)
  const source = current.fields[index]
  if (!source) return current
  const name = suggestFieldName(
    source.name,
    current.fields.map((field) => field.name),
  )
  const copy = { ...source, id: newId, name, label: `${source.label} copy` }
  return addField(current, copy as FormFieldDefinition, index + 1)
}

export function updateForm(
  definition: FormDefinition,
  update: Readonly<Record<string, unknown>>,
): FormDefinition {
  return snapshotFormDefinition({ ...snapshotFormDefinition(definition), ...update })
}

interface ParsedDefinition {
  readonly definition?: FormDefinition
  readonly issues: FormIssue[]
}

function parseDefinition(input: unknown, options: FormValidationOptions): ParsedDefinition {
  try {
    return parseDefinitionUnchecked(input, options)
  } catch {
    return {
      issues: [issue("unsafe_input", "Form definition could not be read safely", "form")],
    }
  }
}

function parseDefinitionUnchecked(
  input: unknown,
  options: FormValidationOptions,
): ParsedDefinition {
  const issues: FormIssue[] = []
  if (!isPlainObject(input)) {
    return { issues: [issue("invalid_type", "Form definition must be a plain object", "form")] }
  }
  rejectAccessorsAndUnknown(input, definitionKeys, "form", issues)

  const formatVersion = readData(input, "formatVersion", "form.formatVersion", issues)
  const title = readString(input, "title", "form.title", issues, { min: 1, max: 120 })
  const description = readOptionalString(input, "description", "form.description", issues, 1000)
  const submitLabel = readString(input, "submitLabel", "form.submitLabel", issues, {
    min: 1,
    max: 80,
  })
  const successMessage = readString(input, "successMessage", "form.successMessage", issues, {
    min: 1,
    max: 500,
  })
  const fieldsValue = readData(input, "fields", "form.fields", issues)

  if (formatVersion !== FORM_DEFINITION_FORMAT_VERSION) {
    issues.push(
      issue("unsupported_format", "Form definition formatVersion must be 1", "form.formatVersion"),
    )
  }
  if (!Array.isArray(fieldsValue)) {
    issues.push(issue("invalid_type", "Form fields must be an array", "form.fields"))
    return { issues }
  }
  if (fieldsValue.length > 200) {
    issues.push(issue("too_many_fields", "A form can contain at most 200 fields", "form.fields"))
  }
  if (options.publishable === true && fieldsValue.length === 0) {
    issues.push(
      issue("empty_form", "A published form must contain at least one field", "form.fields"),
    )
  }

  const fields: FormFieldDefinition[] = []
  for (let index = 0; index < fieldsValue.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(fieldsValue, String(index))
    if (!descriptor || !("value" in descriptor)) {
      issues.push(
        issue(
          "accessor_not_allowed",
          "Form fields must contain data values",
          `form.fields.${index}`,
        ),
      )
      continue
    }
    const parsed = parseField(descriptor.value, index, issues)
    if (parsed) fields.push(parsed)
  }

  for (const [property, label] of [
    ["id", "field id"],
    ["name", "field name"],
  ] as const) {
    const seen = new Set<string>()
    fields.forEach((field, index) => {
      const value = field[property]
      if (seen.has(value)) {
        issues.push(
          issue("duplicate", `Duplicate ${label} ${value}`, `form.fields.${index}.${property}`),
        )
      }
      seen.add(value)
    })
  }

  if (
    issues.length > 0 ||
    title === undefined ||
    submitLabel === undefined ||
    successMessage === undefined
  ) {
    return { issues }
  }

  return {
    definition: Object.freeze({
      formatVersion: FORM_DEFINITION_FORMAT_VERSION,
      title,
      ...(description === undefined ? {} : { description }),
      submitLabel,
      successMessage,
      fields: Object.freeze(fields),
    }),
    issues,
  }
}

function parseField(
  input: unknown,
  index: number,
  issues: FormIssue[],
): FormFieldDefinition | undefined {
  const path = `form.fields.${index}`
  if (!isPlainObject(input)) {
    issues.push(issue("invalid_type", "Form field must be a plain object", path))
    return undefined
  }
  rejectAccessorsAndUnknown(input, fieldKeys, path, issues)
  const id = readString(input, "id", `${path}.id`, issues, { min: 1, max: 120 })
  const name = readString(input, "name", `${path}.name`, issues, { min: 1, max: 120 })
  const label = readString(input, "label", `${path}.label`, issues, { min: 1, max: 200 })
  const description = readOptionalString(input, "description", `${path}.description`, issues, 1000)
  const required = readData(input, "required", `${path}.required`, issues)
  const type = readData(input, "type", `${path}.type`, issues)
  const control = readData(input, "control", `${path}.control`, issues)
  const placeholder = readOptionalString(input, "placeholder", `${path}.placeholder`, issues, 300)

  if (typeof name === "string" && !isSafeFieldName(name)) {
    issues.push(issue("unsafe_name", `Field name ${name} is not safe`, `${path}.name`))
  }
  if (typeof required !== "boolean") {
    issues.push(issue("invalid_type", "Field required must be a boolean", `${path}.required`))
  }
  if (!id || !name || !label || typeof required !== "boolean") return undefined

  const base = {
    id,
    name,
    label,
    ...(description === undefined ? {} : { description }),
    required,
  }

  if (type === "string" && ["text", "email", "textarea"].includes(String(control))) {
    const validation = parseStringValidation(input, path, issues)
    return Object.freeze({
      ...base,
      type,
      control: control as StringFieldDefinition["control"],
      ...(placeholder === undefined ? {} : { placeholder }),
      ...(validation === undefined ? {} : { validation }),
    })
  }
  if (type === "number" && control === "number") {
    const validation = parseNumberValidation(input, path, issues)
    return Object.freeze({
      ...base,
      type,
      control,
      ...(placeholder === undefined ? {} : { placeholder }),
      ...(validation === undefined ? {} : { validation }),
    })
  }
  if (type === "boolean" && control === "checkbox") {
    return Object.freeze({ ...base, type, control }) as BooleanFieldDefinition
  }
  if (type === "enum" && control === "select") {
    const values = parseEnumValues(input, path, issues)
    if (!values) return undefined
    return Object.freeze({
      ...base,
      type,
      control,
      ...(placeholder === undefined ? {} : { placeholder }),
      values,
    }) as EnumFieldDefinition
  }
  issues.push(issue("unsupported_field", "Field type and control are not compatible", path))
  return undefined
}

function parseStringValidation(input: Record<string, unknown>, path: string, issues: FormIssue[]) {
  const value = readOptionalData(input, "validation", `${path}.validation`, issues)
  if (value === undefined) return undefined
  if (!isPlainObject(value)) {
    issues.push(
      issue("invalid_type", "String validation must be a plain object", `${path}.validation`),
    )
    return undefined
  }
  rejectAccessorsAndUnknown(
    value,
    new Set(["minLength", "maxLength"]),
    `${path}.validation`,
    issues,
  )
  const minLength = readOptionalInteger(value, "minLength", `${path}.validation.minLength`, issues)
  const maxLength = readOptionalInteger(value, "maxLength", `${path}.validation.maxLength`, issues)
  if (minLength !== undefined && maxLength !== undefined && minLength > maxLength) {
    issues.push(
      issue("invalid_range", "Minimum length cannot exceed maximum length", `${path}.validation`),
    )
  }
  return Object.freeze({
    ...(minLength === undefined ? {} : { minLength }),
    ...(maxLength === undefined ? {} : { maxLength }),
  })
}

function parseNumberValidation(input: Record<string, unknown>, path: string, issues: FormIssue[]) {
  const value = readOptionalData(input, "validation", `${path}.validation`, issues)
  if (value === undefined) return undefined
  if (!isPlainObject(value)) {
    issues.push(
      issue("invalid_type", "Number validation must be a plain object", `${path}.validation`),
    )
    return undefined
  }
  rejectAccessorsAndUnknown(value, new Set(["min", "max"]), `${path}.validation`, issues)
  const min = readOptionalFiniteNumber(value, "min", `${path}.validation.min`, issues)
  const max = readOptionalFiniteNumber(value, "max", `${path}.validation.max`, issues)
  if (min !== undefined && max !== undefined && min > max) {
    issues.push(issue("invalid_range", "Minimum cannot exceed maximum", `${path}.validation`))
  }
  return Object.freeze({
    ...(min === undefined ? {} : { min }),
    ...(max === undefined ? {} : { max }),
  })
}

function parseEnumValues(input: Record<string, unknown>, path: string, issues: FormIssue[]) {
  const value = readData(input, "values", `${path}.values`, issues)
  if (!Array.isArray(value) || value.length === 0) {
    issues.push(issue("invalid_enum", "Select fields need at least one option", `${path}.values`))
    return undefined
  }
  const values: string[] = []
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (
      !descriptor ||
      !("value" in descriptor) ||
      typeof descriptor.value !== "string" ||
      !descriptor.value
    ) {
      issues.push(
        issue(
          "invalid_enum",
          "Select options must be non-empty strings",
          `${path}.values.${index}`,
        ),
      )
    } else {
      values.push(descriptor.value)
    }
  }
  if (new Set(values).size !== values.length) {
    issues.push(issue("duplicate_enum", "Select options must be unique", `${path}.values`))
  }
  return Object.freeze(values)
}

function rejectAccessorsAndUnknown(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: string,
  issues: FormIssue[],
) {
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !("value" in descriptor)) {
      issues.push(
        issue(
          "accessor_not_allowed",
          "Accessors are not allowed in form definitions",
          `${path}.${key}`,
        ),
      )
    } else if (!allowed.has(key)) {
      issues.push(issue("unknown_property", `Unknown property ${key}`, `${path}.${key}`))
    }
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    issues.push(issue("symbol_not_allowed", "Symbol properties are not allowed", path))
  }
}

function readData(
  value: Record<string, unknown>,
  key: string,
  path: string,
  issues: FormIssue[],
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  if (!descriptor) {
    issues.push(issue("required", `${key} is required`, path))
    return undefined
  }
  if (!("value" in descriptor)) {
    issues.push(issue("accessor_not_allowed", `${key} must be a data property`, path))
    return undefined
  }
  return descriptor.value
}

function readOptionalData(
  value: Record<string, unknown>,
  key: string,
  path: string,
  issues: FormIssue[],
) {
  if (!Object.prototype.hasOwnProperty.call(value, key)) return undefined
  return readData(value, key, path, issues)
}

function readString(
  value: Record<string, unknown>,
  key: string,
  path: string,
  issues: FormIssue[],
  limits: { readonly min: number; readonly max: number },
) {
  const result = readData(value, key, path, issues)
  if (typeof result !== "string" || result.length < limits.min || result.length > limits.max) {
    issues.push(
      issue("invalid_string", `${key} must be ${limits.min}-${limits.max} characters`, path),
    )
    return undefined
  }
  return result
}

function readOptionalString(
  value: Record<string, unknown>,
  key: string,
  path: string,
  issues: FormIssue[],
  max: number,
) {
  const result = readOptionalData(value, key, path, issues)
  if (result === undefined) return undefined
  if (typeof result !== "string" || result.length > max) {
    issues.push(
      issue("invalid_string", `${key} must be a string of at most ${max} characters`, path),
    )
    return undefined
  }
  return result
}

function readOptionalInteger(
  value: Record<string, unknown>,
  key: string,
  path: string,
  issues: FormIssue[],
) {
  const result = readOptionalData(value, key, path, issues)
  if (result === undefined) return undefined
  if (!Number.isInteger(result) || (result as number) < 0) {
    issues.push(issue("invalid_integer", `${key} must be a non-negative integer`, path))
    return undefined
  }
  return result as number
}

function readOptionalFiniteNumber(
  value: Record<string, unknown>,
  key: string,
  path: string,
  issues: FormIssue[],
) {
  const result = readOptionalData(value, key, path, issues)
  if (result === undefined) return undefined
  if (typeof result !== "number" || !Number.isFinite(result)) {
    issues.push(issue("invalid_number", `${key} must be a finite number`, path))
    return undefined
  }
  return result
}

function issue(code: string, message: string, path: string): FormIssue {
  return Object.freeze({ code, message, path })
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

function defaultLabel(control: FieldControl) {
  switch (control) {
    case "text":
      return "Text"
    case "email":
      return "Email"
    case "textarea":
      return "Long answer"
    case "number":
      return "Number"
    case "checkbox":
      return "Checkbox"
    case "select":
      return "Select"
  }
}
