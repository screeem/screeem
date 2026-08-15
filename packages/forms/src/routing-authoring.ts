import { createRouter, schemaFromForm, type RoutingResult } from "@screeem/routing"
import { InvalidFormRoutingError } from "./errors.js"
import type {
  FormDefinition,
  FormFieldDefinition,
  FormRoutingAuthoring,
  FormRoutingAuthoringIssue,
  FormRoutingCondition,
  FormRoutingDefinition,
  FormRoutingOperator,
} from "./model.js"
import { snapshotFormRoutingAuthoring } from "./routing-authoring-contract.js"
import { snapshotFormRoutingDefinition } from "./routing.js"
import { normalizeSubmission } from "./submission.js"
import {
  snapshotIntegrationActionCatalog,
  type IntegrationActionDefinition,
} from "./integration-actions.js"

export interface FormRoutingOperatorOption {
  readonly value: FormRoutingOperator
  readonly label: string
  readonly needsValue: boolean
}

const equalityOperators: readonly FormRoutingOperatorOption[] = [
  { value: "equals", label: "is", needsValue: true },
  { value: "not_equals", label: "is not", needsValue: true },
]

const numberOperators: readonly FormRoutingOperatorOption[] = [
  ...equalityOperators,
  { value: "greater_than", label: "is greater than", needsValue: true },
  { value: "greater_than_or_equal", label: "is at least", needsValue: true },
  { value: "less_than", label: "is less than", needsValue: true },
  { value: "less_than_or_equal", label: "is at most", needsValue: true },
]

const presenceOperators: readonly FormRoutingOperatorOption[] = [
  { value: "is_empty", label: "is empty", needsValue: false },
  { value: "is_not_empty", label: "is not empty", needsValue: false },
]

export function routingOperatorsForField(
  field: FormFieldDefinition,
): readonly FormRoutingOperatorOption[] {
  const typed = field.type === "number" ? numberOperators : equalityOperators
  return field.required ? typed : [...typed, ...presenceOperators]
}

export function createRoutingCondition(
  field: FormFieldDefinition,
  id: string,
): FormRoutingCondition {
  return Object.freeze({
    id,
    fieldId: field.id,
    operator: "equals",
    value: defaultValueForField(field),
  })
}

export function createEmptyRoutingAuthoring(fallback = "default"): FormRoutingAuthoring {
  return Object.freeze({ version: 1, rules: Object.freeze([]), fallback })
}

/** Checks that editable source describes the runtime rules stored beside it. */
export function routingAuthoringMatchesDefinition(
  form: FormDefinition,
  routing: FormRoutingDefinition,
  integrationActions: readonly IntegrationActionDefinition[] = [],
): boolean {
  if (!routing.authoring) return false
  const generated = generateFormRoutingDefinition(form, routing.authoring, integrationActions)
  if (!generated.ok || generated.routing.fallback !== routing.fallback) return false
  if (generated.routing.rules.length !== routing.rules.length) return false

  return generated.routing.rules.every((expected, index) => {
    const actual = routing.rules[index]
    return (
      actual?.id === expected.id &&
      actual.when === expected.when &&
      actual.route === expected.route &&
      runtimeActionsMatch(actual.actions, expected.actions)
    )
  })
}

/** Generates runtime expressions while retaining the editable visual source. */
export function generateFormRoutingDefinition(
  form: FormDefinition,
  draft: FormRoutingAuthoring,
  integrationActions: readonly IntegrationActionDefinition[] = [],
):
  | { readonly ok: true; readonly routing: FormRoutingDefinition }
  | { readonly ok: false; readonly issues: readonly FormRoutingAuthoringIssue[] } {
  let source: FormRoutingAuthoring
  try {
    source = snapshotFormRoutingAuthoring(draft)
  } catch (error) {
    if (error instanceof InvalidFormRoutingError) {
      return { ok: false, issues: Object.freeze(error.issues) }
    }
    throw error
  }

  const fields = new Map(form.fields.map((field) => [field.id, field]))
  const actionCatalog = new Map(
    snapshotIntegrationActionCatalog(integrationActions).map((action) => [action.use, action]),
  )
  const issues: FormRoutingAuthoringIssue[] = []
  const ruleIds = new Set<string>()
  const rules = source.rules.map((rule) => {
    if (ruleIds.has(rule.id)) {
      issues.push({
        code: "duplicate_rule_id",
        message: "Rule IDs must be unique.",
        ruleId: rule.id,
      })
    }
    ruleIds.add(rule.id)

    if (rule.conditions.length === 0) {
      issues.push({
        code: "missing_condition",
        message: "Add at least one condition.",
        ruleId: rule.id,
      })
    }
    if (!rule.route.trim()) {
      issues.push({
        code: "missing_route",
        message: "Choose a destination for this rule.",
        ruleId: rule.id,
      })
    }

    const conditionIds = new Set<string>()
    const expressions = rule.conditions.map((condition) => {
      if (conditionIds.has(condition.id)) {
        issues.push({
          code: "duplicate_condition_id",
          message: "Condition IDs must be unique within a rule.",
          ruleId: rule.id,
          conditionId: condition.id,
        })
      }
      conditionIds.add(condition.id)

      const field = fields.get(condition.fieldId)
      if (!field) {
        issues.push({
          code: "missing_field",
          message: "This field no longer exists in the form.",
          ruleId: rule.id,
          conditionId: condition.id,
        })
        return "false"
      }

      const supported = routingOperatorsForField(field).some(
        (operator) => operator.value === condition.operator,
      )
      if (!supported) {
        issues.push({
          code: "invalid_operator",
          message: `${field.label} does not support this operator.`,
          ruleId: rule.id,
          conditionId: condition.id,
        })
        return "false"
      }

      const expression = conditionExpression(field, condition)
      if (expression === null) {
        issues.push({
          code: "invalid_value",
          message: `Enter a valid value for ${field.label}.`,
          ruleId: rule.id,
          conditionId: condition.id,
        })
        return "false"
      }
      return expression
    })

    const joiner = rule.combinator === "all" ? " && " : " || "
    const actions = (rule.actions ?? []).map((action) => {
      const actionDefinition = actionCatalog.get(action.use)
      if (!actionDefinition) {
        issues.push({
          code: "unknown_integration_action",
          message: "This integration action is not available.",
          ruleId: rule.id,
          actionId: action.id,
        })
      }
      if (!action.use.trim()) {
        issues.push({
          code: "missing_action",
          message: "Choose an action.",
          ruleId: rule.id,
          actionId: action.id,
        })
      }
      if (actionDefinition) {
        for (const input of actionDefinition.inputs) {
          const mapping = action.inputs.find((candidate) => candidate.input === input.name)
          if (!mapping && input.required) {
            issues.push({
              code: "missing_action_input",
              message: `Choose a form field for ${input.label}.`,
              ruleId: rule.id,
              actionId: action.id,
              inputName: input.name,
            })
            continue
          }
          if (mapping) {
            const field = fields.get(mapping.fieldId)
            if (
              field &&
              (!input.fieldTypes.includes(field.type) ||
                (input.fieldControls && !input.fieldControls.includes(field.control)) ||
                (input.required && !field.required))
            ) {
              issues.push({
                code: "incompatible_action_field",
                message: `${field.label} is not compatible with ${input.label}.`,
                ruleId: rule.id,
                actionId: action.id,
                inputName: input.name,
              })
            }
          }
        }
        for (const mapping of action.inputs) {
          if (!actionDefinition.inputs.some((input) => input.name === mapping.input)) {
            issues.push({
              code: "unexpected_action_input",
              message: `${mapping.input} is not accepted by this action.`,
              ruleId: rule.id,
              actionId: action.id,
              inputName: mapping.input,
            })
          }
        }
      }
      const inputs = action.inputs.map((input) => {
        const field = fields.get(input.fieldId)
        if (!field) {
          issues.push({
            code: "missing_action_field",
            message: `Choose a form field for ${input.input}.`,
            ruleId: rule.id,
            actionId: action.id,
            inputName: input.input,
          })
          return `${JSON.stringify(input.input)}: undefined`
        }
        return `${JSON.stringify(input.input)}: submission.${field.name}`
      })
      return Object.freeze({
        use: actionDefinition?.runtimeUse ?? action.use.trim(),
        ...(inputs.length === 0 ? {} : { with: `({ ${inputs.join(", ")} })` }),
      })
    })
    return Object.freeze({
      id: rule.id,
      when: expressions.map((expression) => `(${expression})`).join(joiner) || "false",
      route: rule.route.trim(),
      ...(actions.length === 0 ? {} : { actions: Object.freeze(actions) }),
    })
  })

  if (!source.fallback.trim()) {
    issues.push({ code: "missing_fallback", message: "Choose a fallback destination." })
  }
  if (issues.length > 0) return { ok: false, issues: Object.freeze(issues) }

  try {
    const authoring = snapshotFormRoutingAuthoring({
      ...source,
      fallback: source.fallback.trim(),
      rules: source.rules.map((rule) => ({ ...rule, route: rule.route.trim() })),
    })
    const routing = snapshotFormRoutingDefinition({
      version: 1,
      rules,
      fallback: source.fallback.trim(),
      authoring,
    })
    return { ok: true, routing }
  } catch (error) {
    if (error instanceof InvalidFormRoutingError) {
      return { ok: false, issues: Object.freeze(error.issues) }
    }
    throw error
  }
}

function runtimeActionsMatch(
  actual: FormRoutingDefinition["rules"][number]["actions"],
  expected: FormRoutingDefinition["rules"][number]["actions"],
) {
  const left = actual ?? []
  const right = expected ?? []
  return left.length === right.length && left.every((action, index) => {
    const other = right[index]
    return other !== undefined && action.use === other.use && action.with === other.with
  })
}

export async function testFormRouting(
  form: FormDefinition,
  draft: FormRoutingAuthoring,
  submission: Readonly<Record<string, string | number | boolean>>,
  integrationActions: readonly IntegrationActionDefinition[] = [],
): Promise<RoutingResult> {
  const generated = generateFormRoutingDefinition(form, draft, integrationActions)
  if (!generated.ok) {
    throw new InvalidFormRoutingError(generated.issues)
  }
  const normalized = normalizeSubmission(form, submission, { mode: "json" })
  const compiled = await createRouter().compile({
    version: 1,
    schema: schemaFromForm(form),
    rules: generated.routing.rules.map(({ id, when, route }) => ({ id, when, route })),
    fallback: generated.routing.fallback,
  })
  return (compiled as unknown as { run(input: object): Promise<RoutingResult> }).run(normalized)
}

export function createRoutingSample(
  form: FormDefinition,
): Readonly<Record<string, string | number | boolean>> {
  return Object.freeze(
    Object.fromEntries(form.fields.map((field) => [field.name, defaultValueForField(field)])),
  )
}

function conditionExpression(
  field: FormFieldDefinition,
  condition: FormRoutingCondition,
): string | null {
  const fieldExpression = `submission.${field.name}`
  if (condition.operator === "is_empty") return `isEmpty(${fieldExpression})`
  if (condition.operator === "is_not_empty") return `!isEmpty(${fieldExpression})`

  const value = conditionValue(field, condition.value)
  if (value === null) return null
  const operator = expressionOperator(condition.operator)
  if (operator === null) return null
  const comparison = `${fieldExpression} ${operator} ${JSON.stringify(value)}`
  return field.required ? comparison : `exists(${fieldExpression}) && ${comparison}`
}

function conditionValue(
  field: FormFieldDefinition,
  value: FormRoutingCondition["value"],
): string | number | boolean | null {
  switch (field.type) {
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? value : null
    case "boolean":
      return typeof value === "boolean" ? value : null
    case "enum":
      return typeof value === "string" && field.values.includes(value) ? value : null
    case "string":
      return typeof value === "string" ? value : null
  }
}

function expressionOperator(operator: FormRoutingOperator): string | null {
  switch (operator) {
    case "equals":
      return "==="
    case "not_equals":
      return "!=="
    case "greater_than":
      return ">"
    case "greater_than_or_equal":
      return ">="
    case "less_than":
      return "<"
    case "less_than_or_equal":
      return "<="
    case "is_empty":
    case "is_not_empty":
      return null
  }
}

function defaultValueForField(field: FormFieldDefinition): string | number | boolean {
  switch (field.type) {
    case "number":
      return field.validation?.min ?? field.validation?.max ?? 1
    case "boolean":
      return true
    case "enum":
      return field.values[0] ?? ""
    case "string":
      return field.control === "email" ? "ada@example.com" : "Example response"
  }
}
