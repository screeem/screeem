import { Cause, Effect, Either, Option } from "effect"
import {
  ActionExecutionError,
  CompilationError,
  EvaluationError,
  ExecutionLimitError,
  InvalidInputError,
  InvalidActionArgumentsError,
  routingActionFailureOrDefault,
  type RoutingExecutionError,
} from "./errors.js"
import { evaluate } from "./evaluator.js"
import {
  fieldsPresentWhenTrue,
  isOptionalFieldPredicate,
  parseExpression,
  validateExpressionType,
  type ExpressionNode,
} from "./expression.js"
import {
  defaultRoutingLimits,
  type ActionDefinition,
  type ActionOutput,
  type ActionResult,
  type ExpressionFunctionDescription,
  type ExpressionLanguageDescription,
  type ExpressionOperatorDescription,
  type JsonValue,
  type PureFunctionDefinition,
  type RoutingContext,
  type RoutingDefinition,
  type RoutingLimits,
  type RoutingResult,
} from "./model.js"
import {
  describeSchema,
  isPlainObject,
  snapshotRuntimeType,
  snapshotSchema,
  type as runtime,
  validateRuntimeType,
  type FormSchema,
  type InferRuntimeType,
  type RuntimeType,
  type SchemaDescription,
  type SubmissionConstraint,
} from "./schema.js"

type StoredAction = ActionDefinition<RuntimeType, ActionOutput, unknown>
type StoredFunction = PureFunctionDefinition<readonly RuntimeType[], RuntimeType>
const maximumTimerDelayMs = 2_147_483_647

interface CompiledAction {
  readonly definition: StoredAction
  readonly input: ExpressionNode
}
interface CompiledRule {
  readonly id: string
  readonly when: ExpressionNode
  readonly actions: readonly CompiledAction[]
  readonly route: string
}

export interface CompiledRoutingDefinition<S extends FormSchema> {
  runEffect<const Submission extends object>(
    submission: Submission & SubmissionConstraint<S, Submission>,
  ): Effect.Effect<RoutingResult, RoutingExecutionError, never>
  run<const Submission extends object>(
    submission: Submission & SubmissionConstraint<S, Submission>,
  ): Promise<RoutingResult>
  describeSchema(): SchemaDescription
  describeExpressionLanguage(): ExpressionLanguageDescription
}

export class Router {
  private constructor(
    private readonly functions: ReadonlyMap<string, StoredFunction>,
    private readonly actions: ReadonlyMap<string, StoredAction>,
    private readonly limits: RoutingLimits,
  ) {}

  static create(limits: Partial<RoutingLimits> = {}): Router {
    const configuredLimits = { ...defaultRoutingLimits, ...limits }
    validateLimits(configuredLimits)
    return new Router(builtinFunctions(), new Map(), configuredLimits)
  }

  describeExpressionLanguage(): ExpressionLanguageDescription {
    return describeExpressionLanguage(this.functions)
  }

  registerPureFunction<Input extends readonly RuntimeType[], Output extends RuntimeType>(
    definition: PureFunctionDefinition<Input, Output>,
  ): Router {
    assertRegistrationName(definition.name)
    if (
      isOptionalFieldPredicate(definition.name) ||
      this.functions.has(definition.name) ||
      this.actions.has(definition.name)
    ) {
      throw new Error(`A registration named ${definition.name} already exists`)
    }
    const next = new Map(this.functions)
    const snapshot = Object.freeze({
      ...definition,
      input: Object.freeze(
        definition.input.map((input) => snapshotRuntimeType(input)),
      ) as unknown as Input,
      output: snapshotRuntimeType(definition.output),
    })
    next.set(definition.name, snapshot as unknown as StoredFunction)
    return new Router(next, this.actions, this.limits)
  }

  registerAction<Input extends RuntimeType, Output extends ActionOutput, Failure>(
    definition: ActionDefinition<Input, Output, Failure>,
  ): Router {
    assertRegistrationName(definition.name)
    if (
      isOptionalFieldPredicate(definition.name) ||
      this.actions.has(definition.name) ||
      this.functions.has(definition.name)
    ) {
      throw new Error(`A registration named ${definition.name} already exists`)
    }
    if (
      definition.timeoutMs !== undefined &&
      (!Number.isSafeInteger(definition.timeoutMs) ||
        definition.timeoutMs <= 0 ||
        definition.timeoutMs > maximumTimerDelayMs)
    ) {
      throw new Error(`Action ${definition.name} has an invalid timeout`)
    }
    const next = new Map(this.actions)
    const snapshot = Object.freeze({ ...definition, input: snapshotRuntimeType(definition.input) })
    next.set(definition.name, snapshot as unknown as StoredAction)
    return new Router(this.functions, next, this.limits)
  }

  async compile<S extends FormSchema>(
    definition: RoutingDefinition<S>,
  ): Promise<CompiledRoutingDefinition<S>>

  async compile(definition: unknown): Promise<CompiledRoutingDefinition<FormSchema>>

  async compile<S extends FormSchema>(definition: unknown): Promise<CompiledRoutingDefinition<S>> {
    const contract = snapshotRoutingDefinition(definition, this.limits)
    const schema = compileSchemaSnapshot(contract.schema)
    const compiledDefinition = { ...contract, schema }
    validateDefinition(compiledDefinition, this.limits)
    const fallback = compiledDefinition.fallback
    const functions = this.functions
    const limits = this.limits
    const environment = { schema, functions }
    const rules = compiledDefinition.rules.map((rule): CompiledRule => {
      const when = parseExpression(rule.when, this.limits, rule.id)
      validateExpressionType(when, environment, runtime.boolean(), rule.id)
      const actionEnvironment = {
        ...environment,
        presentFields: fieldsPresentWhenTrue(when),
      }
      const actions = (rule.actions ?? []).map((action): CompiledAction => {
        const registered = this.actions.get(action.use)
        if (!registered) {
          throw new CompilationError([
            {
              code: "UnknownAction",
              message: `Unknown action ${action.use}`,
              ruleId: rule.id,
            },
          ])
        }
        const input = parseExpression(action.with ?? "({})", this.limits, rule.id)
        try {
          validateExpressionType(input, actionEnvironment, registered.input, rule.id)
        } catch (error) {
          if (error instanceof CompilationError) {
            throw new CompilationError(
              error.diagnostics.map((diagnostic) => ({
                ...diagnostic,
                code: "InvalidActionArguments",
                message: `Invalid arguments for ${action.use}: ${diagnostic.message}`,
              })),
            )
          }
          throw error
        }
        return { definition: registered, input }
      })
      return { id: rule.id, when, actions, route: rule.route }
    })

    const execute = (
      submission: unknown,
    ): Effect.Effect<RoutingResult, RoutingExecutionError, never> =>
      Effect.gen(function* () {
        const validSubmission = yield* tryExecution(() =>
          validateSubmission(schema, submission, limits),
        )
        const evaluationEnvironment = {
          submission: validSubmission,
          functions,
          limits,
        }

        for (const rule of rules) {
          const matches = yield* tryExecution(
            () => evaluate(rule.when, evaluationEnvironment) === true,
          )

          if (!matches) {
            continue
          }

          const actionResults: ActionResult[] = []

          for (const action of rule.actions) {
            const input = yield* tryExecution(() => evaluate(action.input, evaluationEnvironment))
            const runtimeIssue = validateRuntimeType(
              input,
              action.definition.input,
              `action.${action.definition.name}`,
              limits,
            )

            if (runtimeIssue) {
              return yield* Effect.fail(new InvalidActionArgumentsError(runtimeIssue))
            }

            const context: Omit<RoutingContext, "signal"> = {
              submission: validSubmission,
              ruleId: rule.id,
              route: rule.route,
            }
            const timeoutMs = action.definition.timeoutMs ?? limits.defaultActionTimeoutMs
            const result = yield* executeAction(action, input, context, timeoutMs, limits)

            actionResults.push(result)
          }

          return { route: rule.route, matchedRule: rule.id, actions: actionResults }
        }

        return { route: fallback, matchedRule: null, actions: [] }
      })
    const runEffect = <const Submission extends object>(
      submission: Submission & SubmissionConstraint<S, Submission>,
    ): Effect.Effect<RoutingResult, RoutingExecutionError, never> => execute(submission)

    return Object.freeze({
      describeSchema: () => describeSchema(schema),
      describeExpressionLanguage: () => describeExpressionLanguage(functions),
      runEffect,
      run: <const Submission extends object>(
        submission: Submission & SubmissionConstraint<S, Submission>,
      ): Promise<RoutingResult> => runPromiseAdapter(execute(submission)),
    })
  }
}

async function runPromiseAdapter<Value>(
  effect: Effect.Effect<Value, RoutingExecutionError>,
): Promise<Value> {
  const result = await Effect.runPromise(Effect.either(effect))

  if (Either.isLeft(result)) {
    throw result.left
  }

  return result.right
}

function tryExecution<Value>(
  evaluateValue: () => Value,
): Effect.Effect<Value, RoutingExecutionError> {
  return Effect.try({
    try: evaluateValue,
    catch: (error) =>
      isRoutingExecutionError(error) ? error : new EvaluationError("Routing evaluation failed"),
  })
}

function isRoutingExecutionError(error: unknown): error is RoutingExecutionError {
  return (
    error instanceof InvalidInputError ||
    error instanceof EvaluationError ||
    error instanceof ExecutionLimitError ||
    error instanceof InvalidActionArgumentsError ||
    error instanceof ActionExecutionError
  )
}

function executeAction(
  action: CompiledAction,
  input: unknown,
  context: Omit<RoutingContext, "signal">,
  timeoutMs: number,
  limits: RoutingLimits,
): Effect.Effect<ActionResult, ActionExecutionError> {
  return Effect.suspend(() => {
    const abortController = new AbortController()
    const actionContext = { ...context, signal: abortController.signal }
    const failure = (error?: unknown) => new ActionExecutionError(
      context.ruleId,
      action.definition.name,
      routingActionFailureOrDefault(error),
    )
    let implementation: Effect.Effect<ActionOutput, unknown, never>

    try {
      implementation = action.definition.run({ input, context: actionContext })
    } catch (error) {
      return Effect.fail(failure(error))
    }

    if (!Effect.isEffect(implementation)) {
      return Effect.fail(failure())
    }

    const actionEffect = implementation.pipe(
      Effect.catchAllCause((cause) => {
        const expected = Cause.failureOption(cause)
        return Effect.fail(failure(Option.isSome(expected) ? expected.value : undefined))
      }),
      Effect.disconnect,
    )
    const timeout = Effect.sleep(timeoutMs).pipe(
      Effect.tap(() => Effect.sync(() => abortController.abort())),
      Effect.flatMap(() => Effect.fail(failure())),
    )

    return Effect.raceFirst(actionEffect, timeout).pipe(
      Effect.flatMap((output) =>
        Effect.try({
          try: () => validateJsonOutput(output, limits),
          catch: failure,
        }),
      ),
      Effect.map((output) => ({
        action: action.definition.name,
        status: "success" as const,
        ...(output === undefined ? {} : { output }),
      })),
      Effect.tapError(() => Effect.sync(() => abortController.abort())),
      Effect.onInterrupt(() => Effect.sync(() => abortController.abort())),
    )
  })
}

export function createRouter(options: { readonly limits?: Partial<RoutingLimits> } = {}): Router {
  return Router.create(options.limits)
}

function validateSubmission(
  schema: FormSchema,
  input: unknown,
  limits: RoutingLimits,
): Readonly<Record<string, unknown>> {
  if (!isPlainObject(input)) throw new InvalidInputError("Submission must be a plain object")
  const inputKeys = Object.keys(input)
  if (inputKeys.length > limits.maximumCollectionSize)
    throw new InvalidInputError("Submission exceeds the collection size limit")
  const knownFields = new Set(Object.keys(schema.fields))
  for (const key of inputKeys)
    if (!knownFields.has(key)) throw new InvalidInputError(`Unknown submission field ${key}`)
  const descriptors = Object.getOwnPropertyDescriptors(input)
  const snapshot: Record<string, unknown> = Object.create(null) as Record<string, unknown>
  for (const [name, fieldDefinition] of Object.entries(schema.fields)) {
    const descriptor = Object.prototype.hasOwnProperty.call(descriptors, name)
      ? descriptors[name]
      : undefined
    if (!descriptor) {
      if (fieldDefinition.required)
        throw new InvalidInputError(`Required submission field ${name} is missing`)
      continue
    }
    if (!("value" in descriptor))
      throw new InvalidInputError(`Submission field ${name} must be a data property`)
    const value = descriptor.value
    if (value === undefined && !fieldDefinition.required) continue
    const issue = validateRuntimeType(
      value,
      fieldDefinition.runtimeType,
      `submission.${name}`,
      limits,
    )
    if (issue) throw new InvalidInputError(issue)
    snapshot[name] = value
  }
  return Object.freeze({ ...snapshot })
}

function snapshotRoutingDefinition(definition: unknown, limits: RoutingLimits): RoutingDefinition {
  if (!isPlainObject(definition)) {
    throw invalidRoutingContract()
  }

  const version = readContractDataProperty(definition, "version")
  const schema = readContractDataProperty(definition, "schema")
  const ruleValues = readContractDataProperty(definition, "rules")
  const fallback = readContractDataProperty(definition, "fallback")

  if (version !== 1 || !Array.isArray(ruleValues) || typeof fallback !== "string") {
    throw invalidRoutingContract()
  }

  if (ruleValues.length > limits.maximumRules) {
    throw new CompilationError([
      { code: "ExecutionLimitExceeded", message: "Definition exceeds the rule limit" },
    ])
  }

  const rules = Array.from({ length: ruleValues.length }, (_, index) =>
    snapshotRule(ruleValues, index, limits),
  )

  return Object.freeze({
    version: 1,
    schema: schema as FormSchema,
    rules: Object.freeze(rules),
    fallback,
  })
}

function snapshotRule(
  rules: readonly unknown[],
  index: number,
  limits: RoutingLimits,
): RoutingDefinition["rules"][number] {
  const descriptor = Object.getOwnPropertyDescriptor(rules, String(index))

  if (!descriptor || !("value" in descriptor) || !isPlainObject(descriptor.value)) {
    throw invalidRuleContract()
  }

  const rule = descriptor.value
  const id = readContractDataProperty(rule, "id")
  const when = readContractDataProperty(rule, "when")
  const route = readContractDataProperty(rule, "route")
  const actionsProperty = readOptionalContractDataProperty(rule, "actions")

  if (typeof id !== "string" || typeof when !== "string" || typeof route !== "string") {
    throw invalidRuleContract()
  }

  const actionValues = actionsProperty.present ? actionsProperty.value : undefined

  if (actionValues !== undefined && !Array.isArray(actionValues)) {
    throw invalidRuleContract()
  }

  if ((actionValues?.length ?? 0) > limits.maximumActionsPerRule) {
    throw new CompilationError([
      {
        code: "ExecutionLimitExceeded",
        message: `Rule ${id} exceeds the action limit`,
        ruleId: id,
      },
    ])
  }

  const actions = Array.from({ length: actionValues?.length ?? 0 }, (_, actionIndex) =>
    snapshotAction(actionValues!, actionIndex, id),
  )

  return Object.freeze({
    id,
    when,
    route,
    ...(actions.length === 0 ? {} : { actions: Object.freeze(actions) }),
  })
}

function snapshotAction(
  actions: readonly unknown[],
  index: number,
  ruleId: string,
): NonNullable<RoutingDefinition["rules"][number]["actions"]>[number] {
  const descriptor = Object.getOwnPropertyDescriptor(actions, String(index))

  if (!descriptor || !("value" in descriptor) || !isPlainObject(descriptor.value)) {
    throw invalidActionContract(ruleId)
  }

  const action = descriptor.value
  const use = readContractDataProperty(action, "use")
  const withProperty = readOptionalContractDataProperty(action, "with")

  if (
    typeof use !== "string" ||
    (withProperty.present &&
      withProperty.value !== undefined &&
      typeof withProperty.value !== "string")
  ) {
    throw invalidActionContract(ruleId)
  }

  return Object.freeze({
    use,
    ...(typeof withProperty.value === "string" ? { with: withProperty.value } : {}),
  })
}

function readContractDataProperty(object: Record<string, unknown>, property: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(object, property)

  if (!descriptor || !("value" in descriptor)) {
    throw invalidRoutingContract()
  }

  return descriptor.value
}

function readOptionalContractDataProperty(
  object: Record<string, unknown>,
  property: string,
): { readonly present: boolean; readonly value?: unknown } {
  const descriptor = Object.getOwnPropertyDescriptor(object, property)

  if (!descriptor) {
    return { present: false }
  }

  if (!("value" in descriptor)) {
    throw invalidRoutingContract()
  }

  return { present: true, value: descriptor.value }
}

function invalidRoutingContract(): CompilationError {
  return new CompilationError([
    { code: "TypeMismatch", message: "Routing definition contract is invalid" },
  ])
}

function invalidRuleContract(): CompilationError {
  return new CompilationError([
    { code: "TypeMismatch", message: "Routing rule contract is invalid" },
  ])
}

function invalidActionContract(ruleId: string): CompilationError {
  return new CompilationError([
    {
      code: "TypeMismatch",
      message: `Action contract is invalid for rule ${ruleId}`,
      ruleId,
    },
  ])
}

function validateDefinition(definition: RoutingDefinition, limits: RoutingLimits): void {
  if (definition.version !== 1)
    throw new CompilationError([
      { code: "TypeMismatch", message: "Only definition version 1 is supported" },
    ])
  if (!definition.fallback)
    throw new CompilationError([{ code: "TypeMismatch", message: "A fallback route is required" }])
  if (definition.rules.length > limits.maximumRules)
    throw new CompilationError([
      { code: "ExecutionLimitExceeded", message: "Definition exceeds the rule limit" },
    ])
  const ruleIds = new Set<string>()
  for (const rule of definition.rules) {
    if (!rule.id || ruleIds.has(rule.id))
      throw new CompilationError([
        { code: "TypeMismatch", message: `Rule IDs must be unique and non-empty: ${rule.id}` },
      ])
    ruleIds.add(rule.id)
    if (!rule.route)
      throw new CompilationError([
        { code: "TypeMismatch", message: `Rule ${rule.id} requires a route`, ruleId: rule.id },
      ])
    if ((rule.actions?.length ?? 0) > limits.maximumActionsPerRule)
      throw new CompilationError([
        {
          code: "ExecutionLimitExceeded",
          message: `Rule ${rule.id} exceeds the action limit`,
          ruleId: rule.id,
        },
      ])
  }
  for (const name of Object.keys(definition.schema.fields)) {
    if (
      !/^[A-Za-z_$][\w$]*$/.test(name) ||
      ["__proto__", "prototype", "constructor"].includes(name)
    ) {
      throw new CompilationError([
        { code: "UnknownField", message: `Unsafe schema field name ${name}` },
      ])
    }
  }
}

function assertRegistrationName(name: string): void {
  if (
    !/^[A-Za-z_$][\w$]*$/.test(name) ||
    ["submission", "__proto__", "prototype", "constructor"].includes(name)
  ) {
    throw new Error(`Invalid registration name ${name}`)
  }
}

function validateLimits(limits: RoutingLimits): void {
  for (const [name, value] of Object.entries(limits)) {
    if (
      !Number.isSafeInteger(value) ||
      value < 0 ||
      (name === "defaultActionTimeoutMs" && (value === 0 || value > maximumTimerDelayMs))
    ) {
      throw new Error(`Routing limit ${name} must be a finite non-negative integer`)
    }
  }
}

function compileSchemaSnapshot<S extends FormSchema>(schema: S): S {
  try {
    return snapshotSchema(schema)
  } catch {
    throw new CompilationError([{ code: "TypeMismatch", message: "Schema contract is invalid" }])
  }
}

function builtinFunctions(): ReadonlyMap<string, StoredFunction> {
  const string = runtime.string()
  const number = runtime.number()
  const boolean = runtime.boolean()
  const definitions: StoredFunction[] = [
    {
      name: "lower",
      input: [string],
      output: string,
      run: ([value]) => String(value).toLowerCase(),
    },
    {
      name: "upper",
      input: [string],
      output: string,
      run: ([value]) => String(value).toUpperCase(),
    },
    {
      name: "contains",
      input: [string, string],
      output: boolean,
      run: ([value, search]) => String(value).includes(String(search)),
    },
    {
      name: "startsWith",
      input: [string, string],
      output: boolean,
      run: ([value, search]) => String(value).startsWith(String(search)),
    },
    {
      name: "endsWith",
      input: [string, string],
      output: boolean,
      run: ([value, search]) => String(value).endsWith(String(search)),
    },
    { name: "length", input: [string], output: number, run: ([value]) => String(value).length },
  ]
  return new Map(definitions.map((definition) => [definition.name, Object.freeze(definition)]))
}

const expressionOperators: readonly ExpressionOperatorDescription[] = Object.freeze(
  [
    ["===", "comparison", "Equals"],
    ["!==", "comparison", "Does not equal"],
    [">", "comparison", "Greater than"],
    [">=", "comparison", "Greater than or equal to"],
    ["<", "comparison", "Less than"],
    ["<=", "comparison", "Less than or equal to"],
    ["&&", "logical", "Both conditions are true"],
    ["||", "logical", "Either condition is true"],
    ["!", "unary", "Negates a condition"],
    ["-", "unary", "Creates a negative numeric literal"],
    ["?:", "conditional", "Selects one of two values"],
  ].map(([symbol, category, description]) =>
    Object.freeze({ symbol, category, description }),
  ) as ExpressionOperatorDescription[],
)

function describeExpressionLanguage(
  functions: ReadonlyMap<string, StoredFunction>,
): ExpressionLanguageDescription {
  const optionalPredicates: readonly ExpressionFunctionDescription[] = Object.freeze([
    Object.freeze({
      name: "exists",
      parameters: Object.freeze([{ type: "field" as const, acceptsOptional: true }]),
      result: Object.freeze({ type: "boolean" as const }),
      description: "Whether the field has a submitted value",
    }),
    Object.freeze({
      name: "isEmpty",
      parameters: Object.freeze([{ type: "field" as const, acceptsOptional: true }]),
      result: Object.freeze({ type: "boolean" as const }),
      description: "Whether the field is absent or an empty string",
    }),
  ])
  const describedFunctions = [...functions.values()].map((definition) =>
    Object.freeze({
      name: definition.name,
      parameters: Object.freeze(
        definition.input.map((input) =>
          Object.freeze({
            type: input.kind,
            acceptsOptional: false,
            ...(input.kind === "enum" ? { values: input.values } : {}),
          }),
        ),
      ),
      result: Object.freeze({
        type: definition.output.kind,
        ...(definition.output.kind === "enum" ? { values: definition.output.values } : {}),
      }),
    }),
  )

  return Object.freeze({
    functions: Object.freeze([...optionalPredicates, ...describedFunctions]),
    operators: expressionOperators,
  })
}

function validateJsonOutput(value: unknown, limits: RoutingLimits): ActionOutput {
  if (value === undefined) return undefined
  const ancestors = new WeakSet<object>()
  let visitedNodes = 0
  const visit = (current: unknown, depth: number): JsonValue => {
    visitedNodes += 1
    if (visitedNodes > limits.maximumOutputNodes) throw new Error("output node limit")
    if (depth > limits.maximumValueDepth) throw new Error("output depth limit")
    if (current === null || typeof current === "boolean" || typeof current === "string") {
      if (typeof current === "string" && current.length > limits.maximumStringLength)
        throw new Error("output string limit")
      return current
    }
    if (typeof current === "number" && Number.isFinite(current)) return current
    if (typeof current !== "object" || current === null || ancestors.has(current)) {
      throw new Error("output is not serialisable")
    }
    ancestors.add(current)
    try {
      if (Array.isArray(current)) {
        if (current.length > limits.maximumCollectionSize)
          throw new Error("output collection limit")
        return Array.from({ length: current.length }, (_, index) => {
          const descriptor = Object.getOwnPropertyDescriptor(current, String(index))
          if (!descriptor || !("value" in descriptor))
            throw new Error("output array must contain data properties")
          return visit(descriptor.value, depth + 1)
        })
      }
      if (!isPlainObject(current)) throw new Error("output must be plain data")
      const entries = Object.entries(Object.getOwnPropertyDescriptors(current)).filter(
        ([, descriptor]) => descriptor.enumerable,
      )
      if (entries.length > limits.maximumCollectionSize) throw new Error("output collection limit")
      if (entries.some(([key]) => key.length > limits.maximumStringLength))
        throw new Error("output key length limit")
      return Object.fromEntries(
        entries.map(([key, descriptor]) => {
          if (!("value" in descriptor))
            throw new Error("output object must contain data properties")
          return [key, visit(descriptor.value, depth + 1)]
        }),
      )
    } finally {
      ancestors.delete(current)
    }
  }
  try {
    return visit(value, 0)
  } catch {
    throw new Error("Action returned invalid result metadata")
  }
}
