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

  constructor(
    readonly ruleId: string,
    readonly actionName: string,
  ) {
    super("ActionExecutionError", `Action ${actionName} failed for rule ${ruleId}`, undefined, {
      name: "ActionFailure",
    })
  }
}

export type RoutingExecutionError =
  | InvalidInputError
  | EvaluationError
  | ExecutionLimitError
  | InvalidActionArgumentsError
  | ActionExecutionError
