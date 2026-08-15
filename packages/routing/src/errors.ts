export interface RuleDiagnostic {
  readonly code: string
  readonly message: string
  readonly start?: number
  readonly end?: number
  readonly ruleId?: string
}

export type RoutingErrorCode =
  | "ParseError"
  | "UnsupportedSyntax"
  | "UnknownField"
  | "TypeMismatch"
  | "UnknownFunction"
  | "UnknownAction"
  | "InvalidActionArguments"
  | "InvalidInput"
  | "EvaluationError"
  | "ActionExecutionError"
  | "ExecutionLimitExceeded"

export interface RoutingActionFailure {
  readonly code: string
  readonly retryable: boolean
  readonly retryAfterMs: number | null
}

const genericActionFailure = Object.freeze({
  code: "action_execution_failed",
  retryable: true,
  retryAfterMs: null,
}) satisfies RoutingActionFailure

export function routingActionFailure(input: unknown): RoutingActionFailure {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Invalid routing action failure")
  }
  let descriptors: PropertyDescriptorMap
  let symbols: readonly symbol[]
  try {
    descriptors = Object.getOwnPropertyDescriptors(input)
    symbols = Object.getOwnPropertySymbols(input)
  } catch {
    throw new TypeError("Invalid routing action failure")
  }
  const keys = Object.keys(descriptors)
  if (
    keys.length !== 3 ||
    !keys.includes("code") ||
    !keys.includes("retryable") ||
    !keys.includes("retryAfterMs") ||
    symbols.length > 0
  ) {
    throw new TypeError("Invalid routing action failure")
  }
  const code = dataValue(descriptors.code)
  const retryable = dataValue(descriptors.retryable)
  const retryAfterMs = dataValue(descriptors.retryAfterMs)
  if (
    typeof code !== "string" ||
    !/^[a-z][a-z0-9_]{0,127}$/.test(code) ||
    typeof retryable !== "boolean" ||
    (retryAfterMs !== null &&
      (!Number.isSafeInteger(retryAfterMs) ||
        (retryAfterMs as number) < 0 ||
        (retryAfterMs as number) > 3_600_000))
  ) {
    throw new TypeError("Invalid routing action failure")
  }
  return Object.freeze({ code, retryable, retryAfterMs: retryAfterMs as number | null })
}

export function routingActionFailureOrDefault(input: unknown): RoutingActionFailure {
  try {
    return routingActionFailure(input)
  } catch {
    return genericActionFailure
  }
}

export class RoutingError extends Error {
  readonly name = "RoutingError"
  constructor(
    readonly code: RoutingErrorCode,
    message: string,
    readonly diagnostics: readonly RuleDiagnostic[] = [{ code, message }],
    readonly safeCause?: unknown,
  ) {
    super(message)
  }
}

export class CompilationError extends RoutingError {
  constructor(diagnostics: readonly RuleDiagnostic[]) {
    super(
      (diagnostics[0]?.code as RoutingErrorCode | undefined) ?? "TypeMismatch",
      diagnostics.map((diagnostic) => diagnostic.message).join("; "),
      diagnostics,
    )
  }
}

export class InvalidInputError extends RoutingError {
  readonly _tag = "InvalidInputError"

  constructor(message: string) {
    super("InvalidInput", message)
  }
}

export class EvaluationError extends RoutingError {
  readonly _tag = "EvaluationError"

  constructor(message: string) {
    super("EvaluationError", message)
  }
}

export class ExecutionLimitError extends RoutingError {
  readonly _tag = "ExecutionLimitError"

  constructor(message: string) {
    super("ExecutionLimitExceeded", message)
  }
}

export class InvalidActionArgumentsError extends RoutingError {
  readonly _tag = "InvalidActionArgumentsError"

  constructor(message: string) {
    super("InvalidActionArguments", message)
  }
}

export class ActionExecutionError extends RoutingError {
  readonly _tag = "ActionExecutionError"
  readonly failure: RoutingActionFailure

  constructor(
    readonly ruleId: string,
    readonly actionName: string,
    failure: RoutingActionFailure = genericActionFailure,
  ) {
    const safeFailure = routingActionFailureOrDefault(failure)
    super("ActionExecutionError", `Action ${actionName} failed for rule ${ruleId}`, undefined, safeFailure)
    this.failure = safeFailure
  }
}

export type RoutingExecutionError =
  | InvalidInputError
  | EvaluationError
  | ExecutionLimitError
  | InvalidActionArgumentsError
  | ActionExecutionError

function dataValue(descriptor: PropertyDescriptor | undefined): unknown {
  if (!descriptor || !("value" in descriptor)) {
    throw new TypeError("Invalid routing action failure")
  }
  return descriptor.value
}
