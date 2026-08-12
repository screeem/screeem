import type { PureFunctionDefinition, RoutingLimits } from "./model.js"
import { EvaluationError, ExecutionLimitError, RoutingError } from "./errors.js"
import { isOptionalFieldPredicate, type ExpressionNode } from "./expression.js"
import { validateRuntimeType } from "./schema.js"

const forbiddenProperties = new Set(["__proto__", "prototype", "constructor"])

export interface EvaluationEnvironment {
  readonly submission: Readonly<Record<string, unknown>>
  readonly functions: ReadonlyMap<string, PureFunctionDefinition>
  readonly limits: RoutingLimits
}

export function evaluate(node: ExpressionNode, environment: EvaluationEnvironment): unknown {
  switch (node.type) {
    case "Literal": {
      if (
        typeof node.value === "string" &&
        node.value.length > environment.limits.maximumStringLength
      ) {
        throw limitFailure()
      }

      return node.value
    }

    case "Identifier": {
      if (node.name === "submission") {
        return environment.submission
      }

      throw evaluationFailure(`Unknown identifier ${String(node.name)}`)
    }

    case "MemberExpression": {
      const object = evaluate(node.object as ExpressionNode, environment)

      if (!isRecord(object)) {
        throw evaluationFailure("Cannot read a property from a non-object")
      }

      const property = node.computed
        ? evaluate(node.property as ExpressionNode, environment)
        : (node.property as ExpressionNode).name

      if (typeof property !== "string" || forbiddenProperties.has(property)) {
        throw evaluationFailure("Unsafe property access")
      }

      const descriptor = Object.getOwnPropertyDescriptor(object, property)

      if (!descriptor) {
        return undefined
      }

      if (!("value" in descriptor)) {
        throw evaluationFailure("Properties must be data properties")
      }

      return descriptor.value
    }

    case "UnaryExpression": {
      const value = evaluate(node.argument as ExpressionNode, environment)

      if (node.operator === "!") {
        return !value
      }

      if (node.operator === "-" && typeof value === "number" && Number.isFinite(value)) {
        return -value
      }

      throw evaluationFailure(`Unsupported unary operator ${String(node.operator)}`)
    }

    case "BinaryExpression":
      return evaluateBinary(node, environment)

    case "LogicalExpression": {
      const left = evaluate(node.left as ExpressionNode, environment)

      return node.operator === "&&"
        ? Boolean(left) && Boolean(evaluate(node.right as ExpressionNode, environment))
        : Boolean(left) || Boolean(evaluate(node.right as ExpressionNode, environment))
    }

    case "ConditionalExpression":
      return evaluate(node.test as ExpressionNode, environment)
        ? evaluate(node.consequent as ExpressionNode, environment)
        : evaluate(node.alternate as ExpressionNode, environment)

    case "ArrayExpression": {
      const elements = (node.elements as ExpressionNode[]).map((element) =>
        evaluate(element, environment),
      )

      if (elements.length > environment.limits.maximumCollectionSize) {
        throw limitFailure()
      }

      return elements
    }

    case "ObjectExpression": {
      if ((node.properties as ExpressionNode[]).length > environment.limits.maximumCollectionSize) {
        throw limitFailure()
      }

      const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>

      for (const property of node.properties as ExpressionNode[]) {
        const keyNode = property.key as ExpressionNode
        const key = keyNode.type === "Identifier" ? String(keyNode.name) : String(keyNode.value)

        if (forbiddenProperties.has(key)) {
          throw evaluationFailure("Unsafe property access")
        }

        output[key] = evaluate(property.value as ExpressionNode, environment)
      }

      return { ...output }
    }

    case "CallExpression": {
      const callee = node.callee as ExpressionNode
      const functionName = String(callee.name)
      const args = (node.arguments as ExpressionNode[]).map((argument) =>
        evaluate(argument, environment),
      )

      if (isOptionalFieldPredicate(functionName)) {
        const value = args[0]

        return functionName === "exists" ? value !== undefined : value === undefined || value === ""
      }

      const definition = environment.functions.get(functionName)

      if (!definition) {
        throw evaluationFailure(`Unknown function ${String(callee.name)}`)
      }

      try {
        args.forEach((argument, index) => {
          const issue = validateRuntimeType(
            argument,
            definition.input[index]!,
            `function.${definition.name}.input[${index}]`,
            environment.limits,
          )

          if (issue) {
            throw evaluationFailure(issue)
          }
        })

        const output = definition.run(args)
        const issue = validateRuntimeType(
          output,
          definition.output,
          `function.${definition.name}.output`,
          environment.limits,
        )

        if (issue) {
          throw evaluationFailure(issue)
        }

        return output
      } catch (error) {
        if (error instanceof RoutingError) {
          throw error
        }

        throw evaluationFailure(`Function ${definition.name} failed`)
      }
    }

    case "TemplateLiteral": {
      const quasis = node.quasis as ExpressionNode[]
      const expressions = node.expressions as ExpressionNode[]
      let output = String((quasis[0]?.value as { cooked?: string } | undefined)?.cooked ?? "")

      expressions.forEach((expression, index) => {
        output += String(evaluate(expression, environment))
        output += String(
          (quasis[index + 1]?.value as { cooked?: string } | undefined)?.cooked ?? "",
        )
      })

      if (output.length > environment.limits.maximumStringLength) {
        throw limitFailure()
      }

      return output
    }

    default:
      throw evaluationFailure(`Unsupported node ${node.type}`)
  }
}

function evaluateBinary(node: ExpressionNode, environment: EvaluationEnvironment): boolean {
  const left = evaluate(node.left as ExpressionNode, environment)
  const right = evaluate(node.right as ExpressionNode, environment)

  switch (node.operator) {
    case "===":
      return left === right

    case "!==":
      return left !== right

    case ">":
      return (left as number) > (right as number)

    case ">=":
      return (left as number) >= (right as number)

    case "<":
      return (left as number) < (right as number)

    case "<=":
      return (left as number) <= (right as number)

    default:
      throw evaluationFailure(`Unsupported binary operator ${String(node.operator)}`)
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null
}

function evaluationFailure(message: string): EvaluationError {
  return new EvaluationError(message)
}

function limitFailure(): ExecutionLimitError {
  return new ExecutionLimitError("Evaluation exceeded configured limits")
}
