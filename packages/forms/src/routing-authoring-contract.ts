import { InvalidFormRoutingError } from "./errors.js"
import {
  FORM_ROUTING_AUTHORING_FORMAT_VERSION,
  type FormRoutingAuthoring,
  type FormRoutingAuthoringAction,
  type FormRoutingAuthoringIssue,
  type FormRoutingAuthoringRule,
  type FormRoutingActionInputMapping,
  type FormRoutingCondition,
  type FormRoutingOperator,
} from "./model.js"

export const maximumRoutingAuthoringRules = 100
export const maximumRoutingConditionsPerRule = 20
export const maximumRoutingActionsPerRule = 10
export const maximumRoutingActionInputs = 32
export const maximumRoutingConditionValueLength = 1_024

const maximumIdentifierLength = 128
const maximumRouteLength = 256
const operators = new Set<FormRoutingOperator>([
  "equals",
  "not_equals",
  "greater_than",
  "greater_than_or_equal",
  "less_than",
  "less_than_or_equal",
  "is_empty",
  "is_not_empty",
])

/** Defensively copies the editable visual source before persistence. */
export function snapshotFormRoutingAuthoring(input: unknown): FormRoutingAuthoring {
  try {
    const authoring = requireRecord(input, "routing.authoring")
    requireKeys(authoring, ["version", "rules", "fallback"], "routing.authoring")
    const version = readData(authoring, "version", "routing.authoring.version")
    const rules = readData(authoring, "rules", "routing.authoring.rules")
    const fallback = readData(authoring, "fallback", "routing.authoring.fallback")

    if (version !== FORM_ROUTING_AUTHORING_FORMAT_VERSION) {
      fail(
        "unsupported_routing_authoring_version",
        "Only visual routing version 1 is supported",
        "routing.authoring.version",
      )
    }
    if (!Array.isArray(rules)) {
      fail(
        "invalid_routing_authoring_rules",
        "Visual routing rules must be an array",
        "routing.authoring.rules",
      )
    }
    if (rules.length > maximumRoutingAuthoringRules) {
      fail(
        "routing_rule_limit",
        "Routing cannot contain more than 100 rules",
        "routing.authoring.rules",
      )
    }
    assertString(
      fallback,
      "routing.authoring.fallback",
      maximumRouteLength,
      undefined,
      undefined,
      "routing_route_limit",
    )

    const ruleIds = new Set<string>()
    const safeRules = Array.from({ length: rules.length }, (_, index) => {
      const rule = snapshotRule(rules, index)
      if (ruleIds.has(rule.id)) {
        fail(
          "duplicate_rule_id",
          "Rule IDs must be unique",
          `routing.authoring.rules[${index}].id`,
          rule.id,
        )
      }
      ruleIds.add(rule.id)
      return rule
    })

    return Object.freeze({
      version: FORM_ROUTING_AUTHORING_FORMAT_VERSION,
      rules: Object.freeze(safeRules),
      fallback,
    })
  } catch (error) {
    if (error instanceof InvalidFormRoutingError) throw error
    throw new InvalidFormRoutingError([
      Object.freeze({
        code: "invalid_routing_authoring_contract",
        message: "Visual routing data could not be read safely",
      }),
    ])
  }
}

function snapshotRule(rules: readonly unknown[], index: number): FormRoutingAuthoringRule {
  const path = `routing.authoring.rules[${index}]`
  const rule = requireArrayItem(rules, index, path)
  requireKeys(rule, ["id", "combinator", "conditions", "route"], path, ["actions"])
  const id = readData(rule, "id", `${path}.id`)
  const combinator = readData(rule, "combinator", `${path}.combinator`)
  const conditions = readData(rule, "conditions", `${path}.conditions`)
  const route = readData(rule, "route", `${path}.route`)
  const actions = readOptionalData(rule, "actions", `${path}.actions`)

  assertString(id, `${path}.id`, maximumIdentifierLength)
  if (combinator !== "all" && combinator !== "any") {
    fail(
      "invalid_routing_combinator",
      "A rule must match all or any conditions",
      `${path}.combinator`,
      id,
    )
  }
  if (!Array.isArray(conditions)) {
    fail("invalid_routing_conditions", "Rule conditions must be an array", `${path}.conditions`, id)
  }
  if (conditions.length === 0) {
    fail("missing_condition", "Add at least one condition", `${path}.conditions`, id)
  }
  if (conditions.length > maximumRoutingConditionsPerRule) {
    fail(
      "routing_condition_limit",
      "A rule cannot contain more than 20 conditions",
      `${path}.conditions`,
      id,
    )
  }
  assertString(
    route,
    `${path}.route`,
    maximumRouteLength,
    id,
    undefined,
    "routing_route_limit",
  )

  const conditionIds = new Set<string>()
  const safeConditions = Array.from({ length: conditions.length }, (_, conditionIndex) => {
    const condition = snapshotCondition(conditions, conditionIndex, path, id)
    if (conditionIds.has(condition.id)) {
      fail(
        "duplicate_condition_id",
        "Condition IDs must be unique within a rule",
        `${path}.conditions[${conditionIndex}].id`,
        id,
        condition.id,
      )
    }
    conditionIds.add(condition.id)
    return condition
  })

  if (actions.present && !Array.isArray(actions.value)) {
    fail("invalid_routing_actions", "Rule actions must be an array", `${path}.actions`, id)
  }
  if (Array.isArray(actions.value) && actions.value.length > maximumRoutingActionsPerRule) {
    fail(
      "routing_action_limit",
      `A rule cannot contain more than ${maximumRoutingActionsPerRule} actions`,
      `${path}.actions`,
      id,
    )
  }
  const actionIds = new Set<string>()
  const safeActions = actions.present
    ? Object.freeze(
        Array.from(
          { length: (actions.value as readonly unknown[]).length },
          (_, actionIndex) => {
            const action = snapshotAction(
              actions.value as readonly unknown[],
              actionIndex,
              path,
              id,
            )
            if (actionIds.has(action.id)) {
              fail(
                "duplicate_action_id",
                "Action IDs must be unique within a rule",
                `${path}.actions[${actionIndex}].id`,
                id,
              )
            }
            actionIds.add(action.id)
            return action
          },
        ),
      )
    : undefined

  return Object.freeze({
    id,
    combinator,
    conditions: Object.freeze(safeConditions),
    route,
    ...(safeActions === undefined ? {} : { actions: safeActions }),
  })
}

function snapshotAction(
  actions: readonly unknown[],
  index: number,
  rulePath: string,
  ruleId: string,
): FormRoutingAuthoringAction {
  const path = `${rulePath}.actions[${index}]`
  const action = requireArrayItem(actions, index, path)
  requireKeys(action, ["id", "use", "inputs"], path)
  const id = readData(action, "id", `${path}.id`)
  const use = readData(action, "use", `${path}.use`)
  const inputs = readData(action, "inputs", `${path}.inputs`)
  assertString(id, `${path}.id`, maximumIdentifierLength, ruleId)
  assertString(use, `${path}.use`, maximumIdentifierLength, ruleId)
  if (!Array.isArray(inputs)) {
    fail("invalid_routing_action_inputs", "Action inputs must be an array", `${path}.inputs`, ruleId)
  }
  if (inputs.length > maximumRoutingActionInputs) {
    fail(
      "routing_action_input_limit",
      `An action cannot contain more than ${maximumRoutingActionInputs} inputs`,
      `${path}.inputs`,
      ruleId,
    )
  }
  const names = new Set<string>()
  const safeInputs = Array.from({ length: inputs.length }, (_, inputIndex) => {
    const input = snapshotActionInput(inputs, inputIndex, path, ruleId)
    if (names.has(input.input)) {
      fail(
        "duplicate_action_input",
        "Action input names must be unique",
        `${path}.inputs[${inputIndex}].input`,
        ruleId,
      )
    }
    names.add(input.input)
    return input
  })
  return Object.freeze({ id, use, inputs: Object.freeze(safeInputs) })
}

function snapshotActionInput(
  inputs: readonly unknown[],
  index: number,
  actionPath: string,
  ruleId: string,
): FormRoutingActionInputMapping {
  const path = `${actionPath}.inputs[${index}]`
  const input = requireArrayItem(inputs, index, path)
  requireKeys(input, ["input", "fieldId"], path)
  const inputName = readData(input, "input", `${path}.input`)
  const fieldId = readData(input, "fieldId", `${path}.fieldId`)
  assertString(inputName, `${path}.input`, maximumIdentifierLength, ruleId)
  assertString(fieldId, `${path}.fieldId`, maximumIdentifierLength, ruleId)
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(inputName)) {
    fail(
      "invalid_action_input_name",
      "Action input names must be identifiers",
      `${path}.input`,
      ruleId,
    )
  }
  return Object.freeze({ input: inputName, fieldId })
}

function snapshotCondition(
  conditions: readonly unknown[],
  index: number,
  rulePath: string,
  ruleId: string,
): FormRoutingCondition {
  const path = `${rulePath}.conditions[${index}]`
  const condition = requireArrayItem(conditions, index, path)
  requireKeys(condition, ["id", "fieldId", "operator"], path, ["value"])
  const id = readData(condition, "id", `${path}.id`)
  const fieldId = readData(condition, "fieldId", `${path}.fieldId`)
  const operator = readData(condition, "operator", `${path}.operator`)
  const value = readOptionalData(condition, "value", `${path}.value`)

  assertString(id, `${path}.id`, maximumIdentifierLength, ruleId)
  assertString(fieldId, `${path}.fieldId`, maximumIdentifierLength, ruleId, id)
  if (typeof operator !== "string" || !operators.has(operator as FormRoutingOperator)) {
    fail(
      "invalid_operator",
      "The routing operator is not supported",
      `${path}.operator`,
      ruleId,
      id,
    )
  }
  const presenceOperator = operator === "is_empty" || operator === "is_not_empty"
  if (presenceOperator && value.present) {
    fail(
      "unexpected_value",
      "Empty checks cannot include a comparison value",
      `${path}.value`,
      ruleId,
      id,
    )
  }
  if (!presenceOperator && !value.present) {
    fail("invalid_value", "A comparison value is required", `${path}.value`, ruleId, id)
  }
  if (value.present && !isConditionValue(value.value)) {
    fail(
      "invalid_value",
      "A comparison value must be a string, boolean or finite number",
      `${path}.value`,
      ruleId,
      id,
    )
  }
  if (
    value.present &&
    typeof value.value === "string" &&
    value.value.length > maximumRoutingConditionValueLength
  ) {
    fail(
      "routing_condition_value_limit",
      `A routing comparison value cannot exceed ${maximumRoutingConditionValueLength} characters`,
      `${path}.value`,
      ruleId,
      id,
    )
  }

  return Object.freeze({
    id,
    fieldId,
    operator: operator as FormRoutingOperator,
    ...(value.present ? { value: value.value as string | number | boolean } : {}),
  })
}

function requireArrayItem(
  values: readonly unknown[],
  index: number,
  path: string,
): Record<string, unknown> {
  let descriptor: PropertyDescriptor | undefined
  try {
    descriptor = Object.getOwnPropertyDescriptor(values, String(index))
  } catch {
    fail("invalid_routing_authoring_contract", `${path} could not be read safely`, path)
  }
  if (!descriptor || !("value" in descriptor)) {
    fail("invalid_routing_authoring_contract", `${path} must be a data value`, path)
  }
  return requireRecord(descriptor.value, path)
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail("invalid_routing_authoring_contract", `${path} must be a plain object`, path)
  }
  let prototype: object | null
  try {
    prototype = Object.getPrototypeOf(value)
  } catch {
    fail("invalid_routing_authoring_contract", `${path} could not be read safely`, path)
  }
  if (prototype !== Object.prototype && prototype !== null) {
    fail("invalid_routing_authoring_contract", `${path} must be a plain object`, path)
  }
  return value as Record<string, unknown>
}

function requireKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  path: string,
  optional: readonly string[] = [],
): void {
  let keys: string[]
  let symbols: symbol[]
  try {
    keys = Object.getOwnPropertyNames(value)
    symbols = Object.getOwnPropertySymbols(value)
  } catch {
    fail("invalid_routing_authoring_contract", `${path} could not be inspected safely`, path)
  }
  if (symbols.length > 0) {
    fail("invalid_routing_authoring_contract", `${path} cannot contain symbol properties`, path)
  }
  const allowed = new Set([...required, ...optional])
  const unknown = keys.find((key) => !allowed.has(key))
  if (unknown !== undefined) {
    fail(
      "unknown_routing_authoring_property",
      `${path}.${unknown} is not supported`,
      `${path}.${unknown}`,
    )
  }
  const missing = required.find((key) => !keys.includes(key))
  if (missing !== undefined) {
    fail("missing_routing_authoring_property", `${path}.${missing} is required`, `${path}.${missing}`)
  }
}

function readData(value: Record<string, unknown>, key: string, path: string): unknown {
  const result = readOptionalData(value, key, path)
  if (!result.present) fail("missing_routing_authoring_property", `${path} is required`, path)
  return result.value
}

function readOptionalData(
  value: Record<string, unknown>,
  key: string,
  path: string,
): { readonly present: boolean; readonly value?: unknown } {
  let descriptor: PropertyDescriptor | undefined
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key)
  } catch {
    fail("invalid_routing_authoring_contract", `${path} could not be read safely`, path)
  }
  if (descriptor === undefined) return { present: false }
  if (!("value" in descriptor)) {
    fail("invalid_routing_authoring_contract", `${path} must be a data value`, path)
  }
  return { present: true, value: descriptor.value }
}

function assertString(
  value: unknown,
  path: string,
  maximum: number,
  ruleId?: string,
  conditionId?: string,
  limitCode = "routing_authoring_string_limit",
): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    fail("invalid_routing_authoring_string", `${path} must be a non-empty string`, path, ruleId, conditionId)
  }
  if (value.length > maximum) {
    fail(limitCode, `${path} cannot exceed ${maximum} characters`, path, ruleId, conditionId)
  }
}

function isConditionValue(value: unknown): value is string | number | boolean {
  return (
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  )
}

function fail(
  code: string,
  message: string,
  path?: string,
  ruleId?: string,
  conditionId?: string,
): never {
  const issue: FormRoutingAuthoringIssue = Object.freeze({
    code,
    message,
    ...(path === undefined ? {} : { path }),
    ...(ruleId === undefined ? {} : { ruleId }),
    ...(conditionId === undefined ? {} : { conditionId }),
  })
  throw new InvalidFormRoutingError([issue])
}
