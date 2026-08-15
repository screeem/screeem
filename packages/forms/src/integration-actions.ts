import type { FieldControl, FormFieldDefinition } from "./model.js"

declare const integrationTypeBrand: unique symbol

const integrationFieldTypes = ["string", "number", "boolean", "enum"] as const
const integrationFieldControls = [
  "text",
  "email",
  "textarea",
  "number",
  "checkbox",
  "select",
] as const

export type IntegrationType = string & { readonly [integrationTypeBrand]: true }

export interface IntegrationActionInputDefinition {
  readonly name: string
  readonly label: string
  readonly required: boolean
  readonly fieldTypes: readonly FormFieldDefinition["type"][]
  readonly fieldControls?: readonly FieldControl[]
  readonly suggestedFieldNames: readonly string[]
}

export interface IntegrationActionDefinition {
  readonly use: string
  readonly runtimeUse?: string
  readonly integrationType: IntegrationType
  readonly capability: string
  readonly label: string
  readonly description: string
  readonly inputs: readonly IntegrationActionInputDefinition[]
}

export function snapshotIntegrationType(input: unknown): IntegrationType {
  if (typeof input !== "string" || !/^[a-z][a-z0-9_-]{0,63}$/.test(input)) {
    throw new TypeError("Invalid integration type")
  }
  return input as IntegrationType
}

export function defineIntegrationAction(
  input: IntegrationActionDefinition,
): IntegrationActionDefinition {
  const use = boundedIdentifier(input.use, 128, true)
  const runtimeUse = input.runtimeUse === undefined
    ? undefined
    : boundedIdentifier(input.runtimeUse, 128, true)
  const integrationType = snapshotIntegrationType(input.integrationType)
  const capability = boundedIdentifier(input.capability, 64)
  if (use !== `${integrationType}.${capability}`) {
    throw new TypeError("Integration action name must match its type and capability")
  }
  const label = boundedText(input.label, 128)
  const description = boundedText(input.description, 512)
  if (!Array.isArray(input.inputs) || input.inputs.length > 32) {
    throw new TypeError("Invalid integration action inputs")
  }
  const names = new Set<string>()
  const inputs = input.inputs.map((entry: IntegrationActionInputDefinition) => {
    const name = boundedIdentifier(entry.name, 128)
    if (names.has(name)) throw new TypeError("Duplicate integration action input")
    names.add(name)
    if (typeof entry.required !== "boolean") {
      throw new TypeError("Invalid integration action input requirement")
    }
    if (!Array.isArray(entry.fieldTypes)) {
      throw new TypeError("Invalid integration action field types")
    }
    const fieldTypes: FormFieldDefinition["type"][] = [
      ...new Set<FormFieldDefinition["type"]>(
        entry.fieldTypes.map(snapshotIntegrationFieldType),
      ),
    ]
    if (fieldTypes.length === 0) {
      throw new TypeError("Invalid integration action field types")
    }
    if (entry.fieldControls !== undefined && !Array.isArray(entry.fieldControls)) {
      throw new TypeError("Invalid integration action field controls")
    }
    const fieldControls: FieldControl[] | undefined =
      entry.fieldControls === undefined
        ? undefined
        : [...new Set<FieldControl>(entry.fieldControls.map(snapshotIntegrationFieldControl))]
    if (fieldControls?.length === 0) {
      throw new TypeError("Invalid integration action field controls")
    }
    if (!Array.isArray(entry.suggestedFieldNames)) {
      throw new TypeError("Invalid suggested integration action fields")
    }
    const suggestedFieldNames = [...new Set(entry.suggestedFieldNames)].map((value) =>
      boundedIdentifier(value, 128),
    )
    return Object.freeze({
      name,
      label: boundedText(entry.label, 128),
      required: entry.required,
      fieldTypes: Object.freeze(fieldTypes),
      ...(fieldControls === undefined ? {} : { fieldControls: Object.freeze(fieldControls) }),
      suggestedFieldNames: Object.freeze(suggestedFieldNames),
    })
  })
  return Object.freeze({
    use,
    ...(runtimeUse === undefined ? {} : { runtimeUse }),
    integrationType,
    capability,
    label,
    description,
    inputs: Object.freeze(inputs),
  })
}

export function snapshotIntegrationActionCatalog(
  input: readonly IntegrationActionDefinition[],
): readonly IntegrationActionDefinition[] {
  if (!Array.isArray(input) || input.length > 32) {
    throw new TypeError("Invalid integration action catalog")
  }
  const uses = new Set<string>()
  const actions = input.map((entry) => {
    const action = defineIntegrationAction(entry)
    if (uses.has(action.use)) throw new TypeError("Duplicate integration action")
    uses.add(action.use)
    return action
  })
  return Object.freeze(actions)
}

function snapshotIntegrationFieldType(input: unknown): FormFieldDefinition["type"] {
  if (!integrationFieldTypes.some((value) => value === input)) {
    throw new TypeError("Invalid integration action field type")
  }
  return input as FormFieldDefinition["type"]
}

function snapshotIntegrationFieldControl(input: unknown): FieldControl {
  if (!integrationFieldControls.some((value) => value === input)) {
    throw new TypeError("Invalid integration action field control")
  }
  return input as FieldControl
}

function boundedIdentifier(input: unknown, maximum: number, allowDots = false): string {
  const pattern = allowDots ? /^[A-Za-z][A-Za-z0-9_.-]*$/ : /^[A-Za-z][A-Za-z0-9_]*$/
  if (typeof input !== "string" || input.length === 0 || input.length > maximum || !pattern.test(input)) {
    throw new TypeError("Invalid integration action identifier")
  }
  return input
}

function boundedText(input: unknown, maximum: number): string {
  if (typeof input !== "string" || input.length === 0 || input.length > maximum) {
    throw new TypeError("Invalid integration action text")
  }
  return input
}
