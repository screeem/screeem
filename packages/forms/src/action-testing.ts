import type {
  FormDefinition,
  FormRoutingActionInputMapping,
  SubmissionRoutingResult,
} from "./model.js"
import { snapshotFormDefinition } from "./definition.js"
import { snapshotSubmissionRoutingResult } from "./routing-result.js"

export interface FormActionTestContext {
  readonly definition: FormDefinition
  readonly submission: Readonly<Record<string, string | number | boolean>>
  readonly routing: SubmissionRoutingResult
  readonly action: FormActionTestOccurrence
  readonly signal: AbortSignal
}

export interface FormActionTestOccurrence {
  readonly id: string
  readonly use: string
  readonly inputs: readonly FormRoutingActionInputMapping[]
  readonly input: Readonly<Record<string, string | number | boolean>>
}

export interface FormActionTestDetail {
  readonly label: string
  readonly value: string
}

export interface FormActionTestResult {
  readonly status: "success" | "warning"
  readonly summary: string
  readonly details?: readonly FormActionTestDetail[]
}

export interface FormActionTester {
  readonly actionName: string
  readonly label: string
  readonly description?: string
  readonly timeoutMs?: number
  readonly test: (context: FormActionTestContext) => Promise<FormActionTestResult>
}

export const maximumFormActionTesters = 10
export const maximumFormActionTesterTimeoutMs = 15_000

export function snapshotFormActionTesters(input: unknown): readonly FormActionTester[] {
  if (!Array.isArray(input)) throw new TypeError("Form action testers must be an array")
  const length = readArrayLength(input)
  if (length > maximumFormActionTesters) {
    throw new TypeError(`A form cannot expose more than ${maximumFormActionTesters} action testers`)
  }
  const names = new Set<string>()
  const testers = Array.from({ length }, (_, index) => {
    const tester = requireRecord(readArrayItem(input, index), "Form action tester")
    requireKeys(tester, ["actionName", "label", "test"], ["description", "timeoutMs"])
    const actionName = readData(tester, "actionName")
    const label = readData(tester, "label")
    const description = readOptionalData(tester, "description")
    const timeoutMs = readOptionalData(tester, "timeoutMs")
    const test = readData(tester, "test")
    assertString(actionName, "Form action tester name", 128)
    assertString(label, "Form action tester label", 128)
    if (description !== undefined) assertString(description, "Form action tester description", 512)
    if (
      timeoutMs !== undefined &&
      (typeof timeoutMs !== "number" ||
        !Number.isSafeInteger(timeoutMs) ||
        timeoutMs < 1 ||
        timeoutMs > maximumFormActionTesterTimeoutMs)
    ) {
      throw new TypeError("Form action tester timeout is invalid")
    }
    if (typeof test !== "function") throw new TypeError("Form action tester must provide a test function")
    if (names.has(actionName)) throw new TypeError(`Duplicate form action tester: ${actionName}`)
    names.add(actionName)
    return Object.freeze({
      actionName,
      label,
      ...(description === undefined ? {} : { description }),
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
      test,
    }) as FormActionTester
  })
  return Object.freeze(testers)
}

export function snapshotFormActionTestContext(
  input: unknown,
  signal: AbortSignal,
): FormActionTestContext {
  const context = requireRecord(input, "Action test context")
  requireKeys(context, ["definition", "submission", "routing", "action"])
  const definition = snapshotFormDefinition(readData(context, "definition"))
  const routing = snapshotSubmissionRoutingResult(readData(context, "routing"))
  const submission = snapshotSubmission(readData(context, "submission"))
  const action = snapshotActionOccurrence(
    readData(context, "action"),
    definition,
    submission,
  )
  return Object.freeze({ definition, submission, routing, action, signal })
}

function snapshotActionOccurrence(
  input: unknown,
  definition: FormDefinition,
  submission: Readonly<Record<string, string | number | boolean>>,
): FormActionTestOccurrence {
  const action = requireRecord(input, "Action test occurrence")
  requireKeys(action, ["id", "use", "inputs"], ["input"])
  const id = readData(action, "id")
  const use = readData(action, "use")
  const rawInputs = readData(action, "inputs")
  assertString(id, "Action test occurrence ID", 128)
  assertString(use, "Action test occurrence name", 128)
  if (!Array.isArray(rawInputs) || rawInputs.length > 32) {
    throw new TypeError("Action test occurrence mappings are invalid")
  }
  const names = new Set<string>()
  const inputs = rawInputs.map((rawInput) => {
    const mapping = requireRecord(rawInput, "Action test occurrence mapping")
    requireKeys(mapping, ["input", "fieldId"])
    const inputName = readData(mapping, "input")
    const fieldId = readData(mapping, "fieldId")
    assertString(inputName, "Action test occurrence input", 128)
    assertString(fieldId, "Action test occurrence field", 128)
    if (names.has(inputName)) throw new TypeError("Action test occurrence inputs must be unique")
    names.add(inputName)
    return Object.freeze({ input: inputName, fieldId })
  })
  const evaluated: Record<string, string | number | boolean> = Object.create(null)
  for (const mapping of inputs) {
    const field = definition.fields.find((candidate) => candidate.id === mapping.fieldId)
    if (!field || !Object.prototype.hasOwnProperty.call(submission, field.name)) {
      throw new TypeError("Action test occurrence mapping is invalid")
    }
    evaluated[mapping.input] = submission[field.name]!
  }
  const safeInput = Object.freeze(evaluated)
  const suppliedInput = readOptionalData(action, "input")
  if (suppliedInput !== undefined) {
    const supplied = snapshotSubmission(suppliedInput)
    if (!scalarRecordsEqual(supplied, safeInput)) {
      throw new TypeError("Action test occurrence input does not match its mappings")
    }
  }
  return Object.freeze({
    id,
    use,
    inputs: Object.freeze(inputs),
    input: safeInput,
  })
}

function scalarRecordsEqual(
  left: Readonly<Record<string, string | number | boolean>>,
  right: Readonly<Record<string, string | number | boolean>>,
) {
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  return leftKeys.length === rightKeys.length && leftKeys.every(
    (key) => Object.prototype.hasOwnProperty.call(right, key) && left[key] === right[key],
  )
}

export function snapshotFormActionTestResult(input: unknown): FormActionTestResult {
  const result = requireRecord(input, "Action test result")
  requireKeys(result, ["status", "summary"], ["details"])
  const status = readData(result, "status")
  const summary = readData(result, "summary")
  const details = readOptionalData(result, "details")

  if (status !== "success" && status !== "warning") {
    throw new TypeError("Action test status is invalid")
  }
  assertString(summary, "Action test summary", 512)
  if (details !== undefined && !Array.isArray(details)) {
    throw new TypeError("Action test details must be an array")
  }
  const detailCount = details === undefined ? 0 : readArrayLength(details)
  if (detailCount > 20) {
    throw new TypeError("Action test details cannot contain more than 20 items")
  }

  const safeDetails =
    details === undefined
      ? undefined
      : Array.from({ length: detailCount }, (_, index) => {
          const detail = requireRecord(readArrayItem(details, index), "Action test detail")
          requireKeys(detail, ["label", "value"])
          const label = readData(detail, "label")
          const value = readData(detail, "value")
          assertString(label, "Action test detail label", 128)
          assertString(value, "Action test detail value", 1_024)
          return Object.freeze({ label, value })
        })

  return Object.freeze({
    status,
    summary,
    ...(safeDetails === undefined ? {} : { details: Object.freeze(safeDetails) }),
  })
}

function snapshotSubmission(
  input: unknown,
): Readonly<Record<string, string | number | boolean>> {
  const submission = requireRecord(input, "Action test submission")
  const safe: Record<string, string | number | boolean> = Object.create(null)
  let keys: string[]
  try {
    keys = Object.keys(submission)
  } catch {
    throw new TypeError("Action test submission could not be read safely")
  }
  for (const key of keys) {
    const value = readData(submission, key)
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
      throw new TypeError("Action test submission values must be strings, numbers or booleans")
    }
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new TypeError("Action test submission numbers must be finite")
    }
    safe[key] = value
  }
  return Object.freeze(safe)
}

function requireKeys(
  input: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
) {
  let keys: (string | symbol)[]
  try {
    keys = Reflect.ownKeys(input)
  } catch {
    throw new TypeError("Action test data could not be read safely")
  }
  const allowed = new Set([...required, ...optional])
  if (
    required.some((key) => !keys.includes(key)) ||
    keys.some((key) => typeof key !== "string" || !allowed.has(key))
  ) {
    throw new TypeError("Action test data contains unexpected properties")
  }
}

function requireRecord(input: unknown, label: string): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new TypeError(`${label} must be an object`)
  }
  let prototype: object | null
  try {
    prototype = Object.getPrototypeOf(input)
  } catch {
    throw new TypeError(`${label} could not be read safely`)
  }
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain object`)
  }
  return input as Record<string, unknown>
}

function readData(input: Record<string, unknown>, key: string): unknown {
  let descriptor: PropertyDescriptor | undefined
  try {
    descriptor = Object.getOwnPropertyDescriptor(input, key)
  } catch {
    throw new TypeError(`${key} could not be read safely`)
  }
  if (!descriptor || !("value" in descriptor)) {
    throw new TypeError(`${key} must be a data property`)
  }
  return descriptor.value
}

function readOptionalData(input: Record<string, unknown>, key: string): unknown {
  let descriptor: PropertyDescriptor | undefined
  try {
    descriptor = Object.getOwnPropertyDescriptor(input, key)
  } catch {
    throw new TypeError(`${key} could not be read safely`)
  }
  if (!descriptor) return undefined
  if (!("value" in descriptor)) throw new TypeError(`${key} must be a data property`)
  return descriptor.value
}

function readArrayItem(input: readonly unknown[], index: number): unknown {
  let descriptor: PropertyDescriptor | undefined
  try {
    descriptor = Object.getOwnPropertyDescriptor(input, String(index))
  } catch {
    throw new TypeError("Action test detail could not be read safely")
  }
  if (!descriptor || !("value" in descriptor)) {
    throw new TypeError("Action test detail must be a data property")
  }
  return descriptor.value
}

function readArrayLength(input: readonly unknown[]): number {
  let descriptor: PropertyDescriptor | undefined
  try {
    descriptor = Object.getOwnPropertyDescriptor(input, "length")
  } catch {
    throw new TypeError("Action test array could not be read safely")
  }
  if (!descriptor || !("value" in descriptor) || !Number.isSafeInteger(descriptor.value)) {
    throw new TypeError("Action test array length is invalid")
  }
  return descriptor.value as number
}

function assertString(value: unknown, label: string, maximumLength: number): asserts value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximumLength) {
    throw new TypeError(`${label} is invalid`)
  }
}
