import {
  InvalidFormRoutingError,
  normalizeSubmission,
  snapshotFormRoutingDefinition,
  type FormDefinition,
  type FormFieldDefinition,
  type FormRoutingDefinition,
  type FormRoutingIssue,
} from "@screeem/forms"
import {
  createRouter,
  schemaFromForm,
  type RoutingResult,
} from "@screeem/routing"

export type VisualRoutingCombinator = "all" | "any"

export type VisualRoutingOperator =
  | "equals"
  | "not_equals"
  | "greater_than"
  | "greater_than_or_equal"
  | "less_than"
  | "less_than_or_equal"
  | "is_empty"
  | "is_not_empty"

export interface VisualRoutingCondition {
  readonly id: string
  readonly fieldId: string
  readonly operator: VisualRoutingOperator
  readonly value?: string | number | boolean
}

export interface VisualRoutingRule {
  readonly id: string
  readonly combinator: VisualRoutingCombinator
  readonly conditions: readonly VisualRoutingCondition[]
  readonly route: string
}

export interface VisualRoutingDraft {
  readonly rules: readonly VisualRoutingRule[]
  readonly fallback: string
}

export interface VisualRoutingIssue extends FormRoutingIssue {
  readonly conditionId?: string
}

export interface VisualRoutingOperatorOption {
  readonly value: VisualRoutingOperator
  readonly label: string
  readonly needsValue: boolean
}

const equalityOperators: readonly VisualRoutingOperatorOption[] = [
  { value: "equals", label: "is", needsValue: true },
  { value: "not_equals", label: "is not", needsValue: true },
]

const numberOperators: readonly VisualRoutingOperatorOption[] = [
  ...equalityOperators,
  { value: "greater_than", label: "is greater than", needsValue: true },
  { value: "greater_than_or_equal", label: "is at least", needsValue: true },
  { value: "less_than", label: "is less than", needsValue: true },
  { value: "less_than_or_equal", label: "is at most", needsValue: true },
]

const presenceOperators: readonly VisualRoutingOperatorOption[] = [
  { value: "is_empty", label: "is empty", needsValue: false },
  { value: "is_not_empty", label: "is not empty", needsValue: false },
]

export function routingOperatorsForField(
  field: FormFieldDefinition,
): readonly VisualRoutingOperatorOption[] {
  const typed = field.type === "number" ? numberOperators : equalityOperators
  return field.required ? typed : [...typed, ...presenceOperators]
}

export function defaultRoutingCondition(
  field: FormFieldDefinition,
  id: string,
): VisualRoutingCondition {
  return Object.freeze({
    id,
    fieldId: field.id,
    operator: "equals",
    value: defaultValueForField(field),
  })
}

export function serializeVisualRouting(
  form: FormDefinition,
  draft: VisualRoutingDraft,
):
  | { readonly ok: true; readonly routing: FormRoutingDefinition }
  | { readonly ok: false; readonly issues: readonly VisualRoutingIssue[] } {
  const fields = new Map(form.fields.map((field) => [field.id, field]))
  const issues: VisualRoutingIssue[] = []
  const ruleIds = new Set<string>()
  const rules = draft.rules.map((rule) => {
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

    const expressions = rule.conditions.map((condition) => {
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
    return Object.freeze({
      id: rule.id,
      when: expressions.map((expression) => `(${expression})`).join(joiner) || "false",
      route: rule.route.trim(),
    })
  })

  if (!draft.fallback.trim()) {
    issues.push({ code: "missing_fallback", message: "Choose a fallback destination." })
  }
  if (issues.length > 0) return { ok: false, issues: Object.freeze(issues) }

  try {
    const routing = snapshotFormRoutingDefinition({
      version: 1,
      rules,
      fallback: draft.fallback.trim(),
    })
    return { ok: true, routing }
  } catch (error) {
    if (error instanceof InvalidFormRoutingError) {
      return { ok: false, issues: Object.freeze(error.issues) }
    }
    throw error
  }
}

export async function testVisualRouting(
  form: FormDefinition,
  draft: VisualRoutingDraft,
  submission: Readonly<Record<string, string | number | boolean>>,
): Promise<RoutingResult> {
  const serialized = serializeVisualRouting(form, draft)
  if (!serialized.ok) {
    throw new Error(serialized.issues[0]?.message ?? "Routing is incomplete.")
  }
  const normalized = normalizeSubmission(form, submission, { mode: "json" })
  const compiled = await createRouter().compile({
    version: 1,
    schema: schemaFromForm(form),
    rules: serialized.routing.rules,
    fallback: serialized.routing.fallback,
  })
  return (compiled as unknown as { run(input: object): Promise<RoutingResult> }).run(normalized)
}

export function sampleSubmissionForForm(
  form: FormDefinition,
): Readonly<Record<string, string | number | boolean>> {
  return Object.freeze(
    Object.fromEntries(form.fields.map((field) => [field.name, defaultValueForField(field)])),
  )
}

function conditionExpression(
  field: FormFieldDefinition,
  condition: VisualRoutingCondition,
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
  value: VisualRoutingCondition["value"],
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

function expressionOperator(operator: VisualRoutingOperator): string | null {
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
      return field.validation?.min ?? 1
    case "boolean":
      return true
    case "enum":
      return field.values[0] ?? ""
    case "string":
      return field.control === "email" ? "ada@example.com" : "Example response"
  }
}
