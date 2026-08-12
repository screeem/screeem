import { parse } from "acorn"
import type { Node } from "acorn"
import { CompilationError, RoutingError, type RuleDiagnostic } from "./errors.js"
import type { PureFunctionDefinition, RoutingLimits } from "./model.js"
import { type as runtime, type FormSchema, type RuntimeType } from "./schema.js"

export type ExpressionNode = Node & Record<string, unknown>

const allowedNodes = new Set([
  "Literal",
  "Identifier",
  "MemberExpression",
  "UnaryExpression",
  "BinaryExpression",
  "LogicalExpression",
  "ConditionalExpression",
  "ArrayExpression",
  "ObjectExpression",
  "Property",
  "CallExpression",
  "TemplateLiteral",
  "TemplateElement",
])
const forbiddenProperties = new Set(["__proto__", "prototype", "constructor"])

export function parseExpression(
  source: string,
  limits: RoutingLimits,
  ruleId?: string,
): ExpressionNode {
  if (source.length > limits.maximumSourceLength) {
    throw new CompilationError([
      diagnostic(
        "ExecutionLimitExceeded",
        "Expression exceeds the source length limit",
        undefined,
        ruleId,
      ),
    ])
  }
  try {
    const program = parse(source, { ecmaVersion: "latest" }) as Node & {
      body: Array<Node & { expression?: Node }>
    }
    const statement = program.body[0]
    if (
      program.body.length !== 1 ||
      statement?.type !== "ExpressionStatement" ||
      statement.expression === undefined
    ) {
      throw new CompilationError([
        diagnostic("UnsupportedSyntax", "Only one expression is allowed", undefined, ruleId),
      ])
    }
    const node = statement.expression as ExpressionNode
    validateSyntax(node, limits, ruleId)

    return node
  } catch (error) {
    if (error instanceof RoutingError) {
      throw error
    }

    const positioned = error as { pos?: number; message?: string }
    throw new CompilationError([
      {
        code: "ParseError",
        message: positioned.message ?? "Invalid expression",
        ...(positioned.pos === undefined ? {} : { start: positioned.pos, end: positioned.pos + 1 }),
        ...(ruleId === undefined ? {} : { ruleId }),
      },
    ])
  }
}

function validateSyntax(root: ExpressionNode, limits: RoutingLimits, ruleId?: string): void {
  let count = 0
  const visit = (node: ExpressionNode, depth: number): void => {
    count += 1

    if (count > limits.maximumAstNodes || depth > limits.maximumAstDepth) {
      throw new CompilationError([
        diagnostic("ExecutionLimitExceeded", "Expression exceeds AST limits", node, ruleId),
      ])
    }

    if (!allowedNodes.has(node.type)) {
      throw new CompilationError([
        diagnostic("UnsupportedSyntax", `${node.type} is not allowed`, node, ruleId),
      ])
    }

    for (const [key, value] of Object.entries(node)) {
      if (["start", "end", "type", "loc", "range", "raw"].includes(key)) {
        continue
      }

      if (isNode(value)) {
        visit(value, depth + 1)
      } else if (Array.isArray(value)) {
        for (const child of value) {
          if (isNode(child)) {
            visit(child, depth + 1)
          }
        }
      }
    }
  }

  visit(root, 1)
}

function isNode(value: unknown): value is ExpressionNode {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string"
  )
}

interface StaticType {
  readonly type: RuntimeType
  readonly optional?: boolean
}

export interface TypeEnvironment {
  readonly schema: FormSchema
  readonly functions: ReadonlyMap<string, PureFunctionDefinition>
  readonly presentFields?: ReadonlySet<string>
}

export type OptionalFieldPredicate = "exists" | "isEmpty"

export function isOptionalFieldPredicate(name: unknown): name is OptionalFieldPredicate {
  return name === "exists" || name === "isEmpty"
}

export function validateExpressionType(
  node: ExpressionNode,
  environment: TypeEnvironment,
  expected: RuntimeType,
  ruleId?: string,
): void {
  const actual = inferType(node, environment, ruleId)

  if (actual.optional) {
    fail("TypeMismatch", "Optional field must be handled before use", node, ruleId)
  }

  if (!isAssignable(actual.type, expected)) {
    fail(
      "TypeMismatch",
      `Expression produces ${displayType(actual.type)}; expected ${displayType(expected)}`,
      node,
      ruleId,
    )
  }
}

function inferType(
  node: ExpressionNode,
  environment: TypeEnvironment,
  ruleId?: string,
): StaticType {
  switch (node.type) {
    case "Literal": {
      const value = node.value

      if (typeof value === "string") {
        return { type: runtime.enum([value]) }
      }

      if (typeof value === "number") {
        if (!Number.isFinite(value)) {
          return fail("TypeMismatch", "Number literals must be finite", node, ruleId)
        }

        return { type: runtime.number() }
      }

      if (typeof value === "boolean") {
        return { type: runtime.boolean() }
      }

      return fail(
        "TypeMismatch",
        "Only string, number and boolean literals are supported",
        node,
        ruleId,
      )
    }

    case "Identifier": {
      if (node.name === "submission") {
        const hasOptionalFields = Object.values(environment.schema.fields).some(
          (fieldDefinition) => !fieldDefinition.required,
        )
        return {
          type: schemaObjectType(environment.schema),
          ...(hasOptionalFields ? { optional: true } : {}),
        }
      }

      return fail("UnknownFunction", `Unknown identifier ${String(node.name)}`, node, ruleId)
    }

    case "MemberExpression":
      return inferMember(node, environment, ruleId)

    case "UnaryExpression": {
      if (node.operator === "-") {
        const argument = node.argument as ExpressionNode

        if (
          argument.type !== "Literal" ||
          typeof argument.value !== "number" ||
          !Number.isFinite(argument.value)
        ) {
          return fail("TypeMismatch", "Only finite numeric literals may be negated", node, ruleId)
        }

        return { type: runtime.number() }
      }

      if (node.operator !== "!") {
        return fail(
          "UnsupportedSyntax",
          `Unary operator ${String(node.operator)} is not allowed`,
          node,
          ruleId,
        )
      }

      requireType(
        inferType(node.argument as ExpressionNode, environment, ruleId),
        runtime.boolean(),
        node,
        ruleId,
      )

      return { type: runtime.boolean() }
    }

    case "BinaryExpression":
      return inferBinary(node, environment, ruleId)

    case "LogicalExpression": {
      if (node.operator !== "&&" && node.operator !== "||") {
        fail(
          "UnsupportedSyntax",
          `Logical operator ${String(node.operator)} is not allowed`,
          node,
          ruleId,
        )
      }

      requireType(
        inferType(node.left as ExpressionNode, environment, ruleId),
        runtime.boolean(),
        node,
        ruleId,
      )

      const rightEnvironment =
        node.operator === "&&"
          ? withPresentFields(environment, fieldsPresentWhenTrue(node.left as ExpressionNode))
          : withPresentFields(environment, fieldsPresentWhenFalse(node.left as ExpressionNode))

      requireType(
        inferType(node.right as ExpressionNode, rightEnvironment, ruleId),
        runtime.boolean(),
        node,
        ruleId,
      )

      return { type: runtime.boolean() }
    }

    case "ConditionalExpression": {
      requireType(
        inferType(node.test as ExpressionNode, environment, ruleId),
        runtime.boolean(),
        node,
        ruleId,
      )

      const test = node.test as ExpressionNode
      const consequent = inferType(
        node.consequent as ExpressionNode,
        withPresentFields(environment, fieldsPresentWhenTrue(test)),
        ruleId,
      )
      const alternate = inferType(
        node.alternate as ExpressionNode,
        withPresentFields(environment, fieldsPresentWhenFalse(test)),
        ruleId,
      )
      const consequentType = consequent.type
      const alternateType = alternate.type

      if (!areConditionalTypesCompatible(consequentType, alternateType)) {
        return fail("TypeMismatch", "Conditional branches must have compatible types", node, ruleId)
      }

      const optional = consequent.optional === true || alternate.optional === true

      return {
        type: mergeConditionalTypes(consequentType, alternateType),
        ...(optional ? { optional: true } : {}),
      }
    }

    case "ArrayExpression": {
      const elements = node.elements as Array<ExpressionNode | null>

      if (elements.length === 0) {
        return fail("TypeMismatch", "Empty arrays cannot be typed", node, ruleId)
      }

      if (elements.some((element) => element === null)) {
        return fail("UnsupportedSyntax", "Array holes are not allowed", node, ruleId)
      }

      const first = inferType(elements[0] as ExpressionNode, environment, ruleId)
      let itemType = first.type
      let optional = first.optional === true

      for (const element of elements.slice(1)) {
        const inferred = inferType(element as ExpressionNode, environment, ruleId)

        if (itemType.kind === "enum" && inferred.type.kind === "enum") {
          itemType = mergeConditionalTypes(itemType, inferred.type)
        } else if (itemType.kind === "enum" && inferred.type.kind === "string") {
          itemType = inferred.type
        } else if (!isAssignable(inferred.type, widenLiteralType(itemType))) {
          fail(
            "TypeMismatch",
            `Array values must have compatible types`,
            element as ExpressionNode,
            ruleId,
          )
        }

        optional ||= inferred.optional === true
      }

      return { type: runtime.array(itemType), ...(optional ? { optional: true } : {}) }
    }

    case "ObjectExpression": {
      const properties: Record<string, RuntimeType> = {}
      let optional = false

      for (const property of node.properties as ExpressionNode[]) {
        if (
          property.type !== "Property" ||
          property.computed ||
          property.method ||
          property.kind !== "init"
        ) {
          return fail(
            "UnsupportedSyntax",
            "Only ordinary object properties are allowed",
            property,
            ruleId,
          )
        }

        const key = propertyKey(property.key as ExpressionNode, ruleId)
        assertSafeProperty(key, property, ruleId)
        const inferred = inferType(property.value as ExpressionNode, environment, ruleId)

        properties[key] = inferred.type
        optional ||= inferred.optional === true
      }

      return { type: runtime.object(properties), ...(optional ? { optional: true } : {}) }
    }

    case "CallExpression": {
      const callee = node.callee as ExpressionNode

      if (callee.type !== "Identifier") {
        return fail("UnsupportedSyntax", "Only registered function calls are allowed", node, ruleId)
      }

      const functionName = String(callee.name)
      const args = node.arguments as ExpressionNode[]

      if (isOptionalFieldPredicate(functionName)) {
        if (args.length !== 1) {
          return fail("TypeMismatch", `${functionName} expects 1 argument`, node, ruleId)
        }

        const argument = args[0]!

        if (argument.type !== "MemberExpression") {
          return fail(
            "TypeMismatch",
            `${functionName} expects a submission field`,
            argument,
            ruleId,
          )
        }

        inferMember(argument, environment, ruleId)

        return { type: runtime.boolean() }
      }

      const definition = environment.functions.get(functionName)

      if (!definition) {
        return fail("UnknownFunction", `Unknown function ${String(callee.name)}`, callee, ruleId)
      }

      if (args.length !== definition.input.length) {
        return fail(
          "TypeMismatch",
          `${definition.name} expects ${definition.input.length} arguments`,
          node,
          ruleId,
        )
      }

      args.forEach((argument, index) =>
        requireType(
          inferType(argument, environment, ruleId),
          definition.input[index]!,
          argument,
          ruleId,
        ),
      )

      return { type: definition.output }
    }

    case "TemplateLiteral": {
      let optional = false

      for (const expression of node.expressions as ExpressionNode[]) {
        const inferred = inferType(expression, environment, ruleId)
        const expressionType = inferred.type

        optional ||= inferred.optional === true

        if (!["string", "enum", "number", "boolean"].includes(expressionType.kind)) {
          fail("TypeMismatch", "Template values must be primitive", expression, ruleId)
        }
      }

      return { type: runtime.string(), ...(optional ? { optional: true } : {}) }
    }

    default:
      return fail("UnsupportedSyntax", `${node.type} is not supported`, node, ruleId)
  }
}

function inferMember(
  node: ExpressionNode,
  environment: TypeEnvironment,
  ruleId?: string,
): StaticType {
  const object = node.object as ExpressionNode

  if (object.type !== "Identifier" || object.name !== "submission") {
    return fail(
      "UnknownField",
      "Properties may only be read directly from submission",
      node,
      ruleId,
    )
  }
  const property = node.computed
    ? literalProperty(node.property as ExpressionNode, ruleId)
    : String((node.property as ExpressionNode).name)

  assertSafeProperty(property, node, ruleId)

  if (!Object.prototype.hasOwnProperty.call(environment.schema.fields, property)) {
    return fail("UnknownField", `Unknown field submission.${property}`, node, ruleId)
  }

  const field = environment.schema.fields[property]!
  const optional = !field.required && !environment.presentFields?.has(property)

  return { type: field.runtimeType, ...(optional ? { optional: true } : {}) }
}

function withPresentFields(
  environment: TypeEnvironment,
  fields: ReadonlySet<string>,
): TypeEnvironment {
  if (fields.size === 0) {
    return environment
  }

  return {
    ...environment,
    presentFields: new Set([...(environment.presentFields ?? []), ...fields]),
  }
}

export function fieldsPresentWhenTrue(node: ExpressionNode): ReadonlySet<string> {
  if (node.type === "LogicalExpression" && node.operator === "&&") {
    return new Set([
      ...fieldsPresentWhenTrue(node.left as ExpressionNode),
      ...fieldsPresentWhenTrue(node.right as ExpressionNode),
    ])
  }

  if (node.type === "CallExpression") {
    const callee = node.callee as ExpressionNode

    if (callee.type === "Identifier" && callee.name === "exists") {
      return fieldNameFromPredicate(node)
    }
  }

  if (node.type === "UnaryExpression" && node.operator === "!") {
    return fieldsPresentWhenFalse(node.argument as ExpressionNode)
  }

  return new Set()
}

function fieldsPresentWhenFalse(node: ExpressionNode): ReadonlySet<string> {
  if (node.type === "LogicalExpression" && node.operator === "||") {
    return new Set([
      ...fieldsPresentWhenFalse(node.left as ExpressionNode),
      ...fieldsPresentWhenFalse(node.right as ExpressionNode),
    ])
  }

  if (node.type === "CallExpression") {
    const callee = node.callee as ExpressionNode

    if (callee.type === "Identifier" && callee.name === "isEmpty") {
      return fieldNameFromPredicate(node)
    }
  }

  if (node.type === "UnaryExpression" && node.operator === "!") {
    return fieldsPresentWhenTrue(node.argument as ExpressionNode)
  }

  return new Set()
}

function fieldNameFromPredicate(node: ExpressionNode): ReadonlySet<string> {
  const argument = (node.arguments as ExpressionNode[])[0]

  if (!argument || argument.type !== "MemberExpression") {
    return new Set()
  }

  const object = argument.object as ExpressionNode

  if (object.type !== "Identifier" || object.name !== "submission") {
    return new Set()
  }

  const property = argument.computed
    ? (argument.property as ExpressionNode).value
    : (argument.property as ExpressionNode).name

  return typeof property === "string" ? new Set([property]) : new Set()
}

function inferBinary(
  node: ExpressionNode,
  environment: TypeEnvironment,
  ruleId?: string,
): StaticType {
  const operator = String(node.operator)
  const left = inferType(node.left as ExpressionNode, environment, ruleId)
  const right = inferType(node.right as ExpressionNode, environment, ruleId)

  if (left.optional || right.optional) {
    fail(
      "TypeMismatch",
      "Optional fields cannot be compared without an explicit value",
      node,
      ruleId,
    )
  }

  if ([">", ">=", "<", "<="].includes(operator)) {
    requireType(left, runtime.number(), node, ruleId)
    requireType(right, runtime.number(), node, ruleId)
  } else if (["===", "!=="].includes(operator)) {
    if (!areComparable(left.type, right.type)) {
      fail(
        "TypeMismatch",
        `Cannot compare ${displayType(left.type)} with ${displayType(right.type)}`,
        node,
        ruleId,
      )
    }
  } else {
    fail("UnsupportedSyntax", `Binary operator ${operator} is not allowed`, node, ruleId)
  }

  return { type: runtime.boolean() }
}

function requireType(
  actual: StaticType,
  expected: RuntimeType,
  node: ExpressionNode,
  ruleId?: string,
): void {
  if (actual.optional || !isAssignable(actual.type, expected)) {
    fail(
      "TypeMismatch",
      `Expected ${displayType(expected)}, received ${displayType(actual.type)}`,
      node,
      ruleId,
    )
  }
}

function isAssignable(actual: RuntimeType, expected: RuntimeType): boolean {
  if (expected.kind === "string") {
    return actual.kind === "string" || actual.kind === "enum"
  }

  if (expected.kind === "enum") {
    return actual.kind === "enum" && actual.values.every((value) => expected.values.includes(value))
  }

  if (actual.kind !== expected.kind) {
    return false
  }

  if (actual.kind === "array" && expected.kind === "array") {
    return isAssignable(actual.item, expected.item)
  }

  if (actual.kind === "object" && expected.kind === "object") {
    const actualKeys = Object.keys(actual.properties)
    const expectedKeys = Object.keys(expected.properties)
    return (
      actualKeys.length === expectedKeys.length &&
      expectedKeys.every(
        (key) =>
          actual.properties[key] !== undefined &&
          isAssignable(actual.properties[key], expected.properties[key]!),
      )
    )
  }

  return true
}

function areComparable(left: RuntimeType, right: RuntimeType): boolean {
  return isAssignable(left, right) || isAssignable(right, left)
}

function widenLiteralType(value: RuntimeType): RuntimeType {
  return value.kind === "enum" ? runtime.string() : value
}

function mergeConditionalTypes(left: RuntimeType, right: RuntimeType): RuntimeType {
  if (left.kind === "enum" && right.kind === "enum") {
    return runtime.enum([...new Set([...left.values, ...right.values])])
  }
  return widenLiteralType(left)
}

function areConditionalTypesCompatible(left: RuntimeType, right: RuntimeType): boolean {
  if (left.kind === "enum" && right.kind === "enum") {
    return true
  }

  return isAssignable(left, right) || isAssignable(right, left)
}

function schemaObjectType(schema: FormSchema): RuntimeType {
  return runtime.object(
    Object.fromEntries(
      Object.entries(schema.fields).map(([key, value]) => [key, value.runtimeType]),
    ),
  )
}

function displayType(value: RuntimeType): string {
  return value.kind === "enum"
    ? value.values.map((item) => JSON.stringify(item)).join(" | ")
    : value.kind
}

function literalProperty(node: ExpressionNode, ruleId?: string): string {
  if (node.type !== "Literal" || typeof node.value !== "string") {
    fail("UnsupportedSyntax", "Computed properties must use a string literal", node, ruleId)
  }

  return node.value as string
}

function propertyKey(node: ExpressionNode, ruleId?: string): string {
  if (node.type === "Identifier") {
    return String(node.name)
  }

  return literalProperty(node, ruleId)
}

function assertSafeProperty(property: string, node: ExpressionNode, ruleId?: string): void {
  if (!/^[A-Za-z_$][\w$]*$/.test(property) || forbiddenProperties.has(property)) {
    fail("UnsupportedSyntax", `Property ${property} is not allowed`, node, ruleId)
  }
}

function diagnostic(
  code: string,
  message: string,
  node?: ExpressionNode,
  ruleId?: string,
): RuleDiagnostic {
  return {
    code,
    message,
    ...(node === undefined ? {} : { start: node.start, end: node.end }),
    ...(ruleId === undefined ? {} : { ruleId }),
  }
}

function fail(code: string, message: string, node: ExpressionNode, ruleId?: string): never {
  throw new CompilationError([diagnostic(code, message, node, ruleId)])
}
