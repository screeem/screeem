import {
  CompilationError,
  Router,
  createRouter,
  schemaFromForm,
  type CompiledRoutingDefinition,
  type FormSchema,
  type Action,
  type Rule,
  type RoutingResult,
} from "@screeem/routing"
import { snapshotFormDefinition } from "./definition.js"
import { InvalidFormRoutingError } from "./errors.js"
import {
  FORM_ROUTING_FORMAT_VERSION,
  type FormDefinition,
  type FormRoutingAuthoring,
  type FormRoutingDefinition,
  type FormRoutingIssue,
} from "./model.js"
import { snapshotFormRoutingAuthoring } from "./routing-authoring-contract.js"

const maximumStoredRules = 100
const maximumStoredActionsPerRule = 10
const maximumRuleIdLength = 128
const maximumRouteLength = 256
const maximumActionNameLength = 128
const maximumExpressionSourceLength = 4_096
export const maximumFormRoutingBytes = 3 * 1024 * 1024

export type FormRoutingCompiler = (
  form: FormDefinition,
  routing: FormRoutingDefinition,
) => Promise<FormRoutingDefinition>

/** Defensively copies routing data before it crosses a persistence boundary. */
export function snapshotFormRoutingDefinition(input: unknown): FormRoutingDefinition {
  try {
    const routing = requireRecord(input, "routing")
    requireKeys(routing, ["version", "rules", "fallback"], "routing", ["authoring"])
    const version = readData(routing, "version", "routing.version")
    const rules = readData(routing, "rules", "routing.rules")
    const fallback = readData(routing, "fallback", "routing.fallback")
    const authoring = readOptionalData(routing, "authoring", "routing.authoring")

    if (version !== FORM_ROUTING_FORMAT_VERSION) {
      fail("unsupported_routing_version", "Only routing version 1 is supported", "version")
    }
    if (!Array.isArray(rules)) {
      fail("invalid_routing_rules", "Routing rules must be an array", "rules")
    }
    if (rules.length > maximumStoredRules) {
      fail("routing_rule_limit", "Routing cannot contain more than 100 rules", "rules")
    }
    if (typeof fallback !== "string") {
      fail("invalid_fallback_route", "The fallback route must be a string", "fallback")
    }
    assertMaximumLength(
      fallback,
      maximumRouteLength,
      "routing_route_limit",
      "The fallback route cannot exceed 256 characters",
      "fallback",
    )

    const safeRouting = Object.freeze({
      version: FORM_ROUTING_FORMAT_VERSION,
      rules: Object.freeze(
        Array.from({ length: rules.length }, (_, index) => snapshotRule(rules, index)),
      ),
      fallback,
      ...(authoring.present
        ? { authoring: snapshotFormRoutingAuthoring(authoring.value) as FormRoutingAuthoring }
        : {}),
    })
    if (new TextEncoder().encode(JSON.stringify(safeRouting)).byteLength > maximumFormRoutingBytes) {
      fail("routing_size_limit", "Routing cannot exceed 3 MiB when encoded", "routing")
    }
    return safeRouting
  } catch (error) {
    if (error instanceof InvalidFormRoutingError) throw error
    throw new InvalidFormRoutingError([
      Object.freeze({
        code: "invalid_routing_contract",
        message: "Routing data could not be read safely",
      }),
    ])
  }
}

/** Compiles routing against the exact form definition that will be published. */
export async function compileFormRoutingDefinition(
  form: FormDefinition,
  routing: FormRoutingDefinition,
  router: Router = createRouter(),
): Promise<FormRoutingDefinition> {
  const safeForm = snapshotFormDefinition(form, { publishable: true })
  const safeRouting = snapshotFormRoutingDefinition(routing)

  try {
    await router.compile({
      version: FORM_ROUTING_FORMAT_VERSION,
      schema: schemaFromForm(safeForm),
      rules: safeRouting.rules,
      fallback: safeRouting.fallback,
    })
    return safeRouting
  } catch (error) {
    if (!(error instanceof CompilationError)) throw error
    throw new InvalidFormRoutingError(
      Object.freeze(
        error.diagnostics.map((diagnostic) =>
          Object.freeze({
            code: diagnostic.code,
            message: diagnostic.message,
            ...(diagnostic.ruleId === undefined ? {} : { ruleId: diagnostic.ruleId }),
            ...(diagnostic.start === undefined ? {} : { start: diagnostic.start }),
            ...(diagnostic.end === undefined ? {} : { end: diagnostic.end }),
          }),
        ),
      ),
    )
  }
}

export async function evaluateFormRoutingDefinition(
  form: FormDefinition,
  routing: FormRoutingDefinition,
  submission: Readonly<Record<string, string | number | boolean>>,
  router: Router = createRouter(),
): Promise<RoutingResult> {
  const compiled = await compileFormRoutingSelector(form, routing, router)
  return compiled.run(submission)
}

export async function compileFormRoutingSelector(
  form: FormDefinition,
  routing: FormRoutingDefinition,
  router: Router = createRouter(),
): Promise<CompiledRoutingDefinition<FormSchema>> {
  const safeForm = snapshotFormDefinition(form, { publishable: true })
  const safeRouting = snapshotFormRoutingDefinition(routing)
  return router.compile({
    version: FORM_ROUTING_FORMAT_VERSION,
    schema: schemaFromForm(safeForm),
    rules: safeRouting.rules.map(({ id, when, route }) => ({ id, when, route })),
    fallback: safeRouting.fallback,
  })
}

function snapshotRule(rules: readonly unknown[], index: number): Rule {
  const path = `rules[${index}]`
  const rule = requireArrayItem(rules, index, path)
  requireKeys(rule, ["id", "when", "route"], path, ["actions"])
  const id = readData(rule, "id", `${path}.id`)
  const when = readData(rule, "when", `${path}.when`)
  const route = readData(rule, "route", `${path}.route`)
  const actions = readOptionalData(rule, "actions", `${path}.actions`)

  if (typeof id !== "string" || typeof when !== "string" || typeof route !== "string") {
    fail("invalid_routing_rule", "A routing rule requires string id, when and route values", path)
  }
  assertMaximumLength(
    id,
    maximumRuleIdLength,
    "routing_rule_id_limit",
    "A routing rule ID cannot exceed 128 characters",
    `${path}.id`,
    id,
  )
  assertMaximumLength(
    when,
    maximumExpressionSourceLength,
    "routing_expression_limit",
    `Rule ${id} cannot exceed 4096 expression characters`,
    `${path}.when`,
    id,
  )
  assertMaximumLength(
    route,
    maximumRouteLength,
    "routing_route_limit",
    `Rule ${id} route cannot exceed 256 characters`,
    `${path}.route`,
    id,
  )
  if (actions.present && !Array.isArray(actions.value)) {
    fail("invalid_routing_actions", "Rule actions must be an array", `${path}.actions`, id)
  }
  if (Array.isArray(actions.value) && actions.value.length > maximumStoredActionsPerRule) {
    fail(
      "routing_action_limit",
      `Rule ${id} cannot contain more than 10 actions`,
      `${path}.actions`,
      id,
    )
  }

  const safeActions = actions.present
    ? Object.freeze(
        Array.from({ length: (actions.value as readonly unknown[]).length }, (_, actionIndex) =>
          snapshotAction(actions.value as readonly unknown[], actionIndex, path, id),
        ),
      )
    : undefined

  return Object.freeze({
    id,
    when,
    route,
    ...(safeActions === undefined ? {} : { actions: safeActions }),
  })
}

function snapshotAction(
  actions: readonly unknown[],
  index: number,
  rulePath: string,
  ruleId: string,
): Action {
  const path = `${rulePath}.actions[${index}]`
  const action = requireArrayItem(actions, index, path)
  requireKeys(action, ["use"], path, ["with"])
  const use = readData(action, "use", `${path}.use`)
  const input = readOptionalData(action, "with", `${path}.with`)

  if (typeof use !== "string" || (input.present && typeof input.value !== "string")) {
    fail("invalid_routing_action", "A routing action requires string use and with values", path, ruleId)
  }
  assertMaximumLength(
    use,
    maximumActionNameLength,
    "routing_action_name_limit",
    `An action name cannot exceed 128 characters`,
    `${path}.use`,
    ruleId,
  )
  if (input.present) {
    assertMaximumLength(
      input.value as string,
      maximumExpressionSourceLength,
      "routing_expression_limit",
      `An action input cannot exceed 4096 expression characters`,
      `${path}.with`,
      ruleId,
    )
  }
  return Object.freeze({
    use,
    ...(input.present ? { with: input.value as string } : {}),
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
    fail("invalid_routing_contract", `${path} could not be read safely`, path)
  }
  if (!descriptor || !("value" in descriptor)) {
    fail("invalid_routing_contract", `${path} must be a data value`, path)
  }
  return requireRecord(descriptor.value, path)
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail("invalid_routing_contract", `${path} must be a plain object`, path)
  }
  let prototype: object | null
  try {
    prototype = Object.getPrototypeOf(value)
  } catch {
    fail("invalid_routing_contract", `${path} could not be read safely`, path)
  }
  if (prototype !== Object.prototype && prototype !== null) {
    fail("invalid_routing_contract", `${path} must be a plain object`, path)
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
    fail("invalid_routing_contract", `${path} could not be inspected safely`, path)
  }
  if (symbols.length > 0) {
    fail("invalid_routing_contract", `${path} cannot contain symbol properties`, path)
  }
  const allowed = new Set([...required, ...optional])
  const unknown = keys.find((key) => !allowed.has(key))
  if (unknown !== undefined) {
    fail("unknown_routing_property", `${path}.${unknown} is not supported`, `${path}.${unknown}`)
  }
  const missing = required.find((key) => !keys.includes(key))
  if (missing !== undefined) {
    fail("missing_routing_property", `${path}.${missing} is required`, `${path}.${missing}`)
  }
}

function readData(value: Record<string, unknown>, key: string, path: string): unknown {
  let descriptor: PropertyDescriptor | undefined
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key)
  } catch {
    fail("invalid_routing_contract", `${path} could not be read safely`, path)
  }
  if (!descriptor || !("value" in descriptor)) {
    fail("invalid_routing_contract", `${path} must be a data value`, path)
  }
  return descriptor.value
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
    fail("invalid_routing_contract", `${path} could not be read safely`, path)
  }
  if (descriptor === undefined) return { present: false }
  if (!("value" in descriptor)) {
    fail("invalid_routing_contract", `${path} must be a data value`, path)
  }
  return { present: true, value: descriptor.value }
}

function fail(
  code: string,
  message: string,
  path?: string,
  ruleId?: string,
): never {
  const issue: FormRoutingIssue = Object.freeze({
    code,
    message,
    ...(path === undefined ? {} : { path }),
    ...(ruleId === undefined ? {} : { ruleId }),
  })
  throw new InvalidFormRoutingError([issue])
}

function assertMaximumLength(
  value: string,
  maximum: number,
  code: string,
  message: string,
  path: string,
  ruleId?: string,
): void {
  if (value.length > maximum) fail(code, message, path, ruleId)
}
