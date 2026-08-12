import type { Effect } from "effect"
import type { FormSchema, InferRuntimeType, RuntimeType } from "./schema.js"

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue }
export type ActionOutput = JsonValue | undefined

export type RouteID = string

export interface Action {
  readonly use: string
  readonly with?: string
}

export interface Rule {
  readonly id: string
  readonly when: string
  readonly actions?: readonly Action[]
  readonly route: RouteID
}

export interface RoutingDefinition<S extends FormSchema = FormSchema> {
  readonly version: 1
  readonly schema: S
  readonly rules: readonly Rule[]
  readonly fallback: RouteID
}

export interface ActionResult {
  readonly action: string
  readonly status: "success"
  readonly output?: JsonValue
}

export interface RoutingResult {
  readonly route: RouteID
  readonly matchedRule: string | null
  readonly actions: readonly ActionResult[]
}

export interface RoutingContext<Submission = Readonly<Record<string, unknown>>> {
  readonly submission: Submission
  readonly ruleId: string
  readonly route: RouteID
  readonly signal: AbortSignal
}

export interface PureFunctionDefinition<
  Input extends readonly RuntimeType[] = readonly RuntimeType[],
  Output extends RuntimeType = RuntimeType,
> {
  readonly name: string
  readonly input: Input
  readonly output: Output
  readonly run: (args: {
    readonly [Index in keyof Input]: InferRuntimeType<Input[Index]>
  }) => InferRuntimeType<Output>
}

export interface ActionDefinition<
  Input extends RuntimeType = RuntimeType,
  Output extends ActionOutput = ActionOutput,
  Failure = unknown,
> {
  readonly name: string
  readonly input: Input
  readonly timeoutMs?: number
  readonly run: (options: {
    readonly input: InferRuntimeType<Input>
    readonly context: RoutingContext
  }) => Effect.Effect<Output, Failure, never>
}

export interface RoutingLimits {
  readonly maximumSourceLength: number
  readonly maximumAstNodes: number
  readonly maximumAstDepth: number
  readonly maximumRules: number
  readonly maximumActionsPerRule: number
  readonly maximumCollectionSize: number
  readonly maximumStringLength: number
  readonly maximumValueDepth: number
  readonly maximumOutputNodes: number
  readonly defaultActionTimeoutMs: number
}

export type ExpressionValueType = RuntimeType["kind"] | "field"

export interface ExpressionParameterDescription {
  readonly type: ExpressionValueType
  readonly acceptsOptional: boolean
  readonly values?: readonly string[]
}

export interface ExpressionResultDescription {
  readonly type: RuntimeType["kind"]
  readonly values?: readonly string[]
}

export interface ExpressionFunctionDescription {
  readonly name: string
  readonly parameters: readonly ExpressionParameterDescription[]
  readonly result: ExpressionResultDescription
  readonly description?: string
}

export interface ExpressionOperatorDescription {
  readonly symbol: string
  readonly category: "comparison" | "logical" | "unary" | "conditional"
  readonly description: string
}

export interface ExpressionLanguageDescription {
  readonly functions: readonly ExpressionFunctionDescription[]
  readonly operators: readonly ExpressionOperatorDescription[]
}

export const defaultRoutingLimits: RoutingLimits = {
  maximumSourceLength: 4_096,
  maximumAstNodes: 256,
  maximumAstDepth: 32,
  maximumRules: 100,
  maximumActionsPerRule: 10,
  maximumCollectionSize: 100,
  maximumStringLength: 16_384,
  maximumValueDepth: 16,
  maximumOutputNodes: 1_000,
  defaultActionTimeoutMs: 10_000,
}
