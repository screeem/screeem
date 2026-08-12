type RuntimeTypeShape =
  | { readonly kind: "string" }
  | { readonly kind: "number" }
  | { readonly kind: "boolean" }
  | { readonly kind: "enum"; readonly values: readonly string[] }
  | { readonly kind: "array"; readonly item: RuntimeType }
  | { readonly kind: "object"; readonly properties: Readonly<Record<string, RuntimeType>> }

declare const runtimeTypeBrand: unique symbol
declare const fieldBrand: unique symbol
declare const emptySubmissionBrand: unique symbol
export type RuntimeType<Value = unknown> = RuntimeTypeShape & { readonly [runtimeTypeBrand]: Value }
export type InferRuntimeType<T extends RuntimeType> =
  T extends RuntimeType<infer Value> ? Value : never

export interface Field<T, Required extends boolean> {
  readonly [fieldBrand]: T
  readonly valueType: T
  readonly required: Required
  readonly runtimeType: RuntimeType<T>
}

type FieldOptions<R extends boolean> = { readonly required: R }

function makeField<T, R extends boolean>(
  runtimeType: RuntimeType<T>,
  options: FieldOptions<R>,
): Field<T, R> {
  return { valueType: undefined as T, required: options.required, runtimeType } as unknown as Field<
    T,
    R
  >
}

function stringField(options: FieldOptions<true>): Field<string, true>
function stringField(options: FieldOptions<false>): Field<string, false>
function stringField(options: FieldOptions<boolean>): Field<string, boolean> {
  return makeField(asRuntimeType<string>({ kind: "string" }), options)
}

function numberField(options: FieldOptions<true>): Field<number, true>
function numberField(options: FieldOptions<false>): Field<number, false>
function numberField(options: FieldOptions<boolean>): Field<number, boolean> {
  return makeField(asRuntimeType<number>({ kind: "number" }), options)
}

function booleanField(options: FieldOptions<true>): Field<boolean, true>
function booleanField(options: FieldOptions<false>): Field<boolean, false>
function booleanField(options: FieldOptions<boolean>): Field<boolean, boolean> {
  return makeField(asRuntimeType<boolean>({ kind: "boolean" }), options)
}

function enumField<const Values extends readonly string[]>(
  values: Values,
  options: FieldOptions<true>,
): Field<Values[number], true>

function enumField<const Values extends readonly string[]>(
  values: Values,
  options: FieldOptions<false>,
): Field<Values[number], false>

function enumField(
  values: readonly string[],
  options: FieldOptions<boolean>,
): Field<string, boolean> {
  return makeField(asRuntimeType<string>({ kind: "enum", values }), options)
}

export const field = {
  string: stringField,
  number: numberField,
  boolean: booleanField,
  enum: enumField,
}

export type FieldMap = Readonly<Record<string, Field<unknown, boolean>>>

export interface FormSchema<Fields extends FieldMap = FieldMap> {
  readonly fields: Fields
  readonly closed: true
}

export function defineSchema<const Fields extends FieldMap>(fields: Fields): FormSchema<Fields> {
  return snapshotSchema({ fields, closed: true }) as FormSchema<Fields>
}

export type FormFieldDefinition = (
  | {
      readonly name: string
      readonly type: "string" | "number" | "boolean"
      readonly required: boolean
    }
  | {
      readonly name: string
      readonly type: "enum"
      readonly values: readonly string[]
      readonly required: boolean
    }
) & { readonly [metadata: string]: unknown }

export interface FormDefinition<
  Fields extends readonly FormFieldDefinition[] = readonly FormFieldDefinition[],
> {
  readonly fields: Fields
  readonly [metadata: string]: unknown
}

type FormFieldValue<Definition extends FormFieldDefinition> = Definition extends {
  readonly type: "string"
}
  ? string
  : Definition extends { readonly type: "number" }
    ? number
    : Definition extends { readonly type: "boolean" }
      ? boolean
      : Definition extends {
            readonly type: "enum"
            readonly values: infer Values extends readonly string[]
          }
        ? Values[number]
        : never

type FieldsFromForm<Fields extends readonly FormFieldDefinition[]> =
  string extends Fields[number]["name"]
    ? FieldMap
    : {
        readonly [Definition in Fields[number] as Definition["name"]]: Field<
          FormFieldValue<Definition>,
          Definition["required"]
        >
      }

export class InvalidFormDefinitionError extends Error {
  readonly name = "InvalidFormDefinitionError"
}

export function schemaFromForm<const Fields extends readonly FormFieldDefinition[]>(
  form: FormDefinition<Fields>,
): FormSchema<FieldsFromForm<Fields>>

export function schemaFromForm(form: unknown): FormSchema

export function schemaFromForm(form: unknown): FormSchema {
  if (!isPlainObject(form)) {
    throw new InvalidFormDefinitionError("Form definition must be a plain object")
  }

  const fieldsValue = readDataProperty(form, "fields", "Form definition")

  if (!Array.isArray(fieldsValue)) {
    throw new InvalidFormDefinitionError("Form definition fields must be an array")
  }

  const fields: Record<string, Field<unknown, boolean>> = Object.create(null) as Record<
    string,
    Field<unknown, boolean>
  >

  for (let index = 0; index < fieldsValue.length; index += 1) {
    const fieldValue = readArrayDataProperty(fieldsValue, index, "Form definition fields")

    if (!isPlainObject(fieldValue)) {
      throw new InvalidFormDefinitionError(`Form field at index ${index} must be a plain object`)
    }

    const name = readDataProperty(fieldValue, "name", `Form field at index ${index}`)

    if (typeof name !== "string" || !isSafeName(name)) {
      throw new InvalidFormDefinitionError(`Form field at index ${index} has an invalid name`)
    }

    const fieldType = readDataProperty(fieldValue, "type", `Form field ${name}`)
    const required = readDataProperty(fieldValue, "required", `Form field ${name}`)

    if (Object.prototype.hasOwnProperty.call(fields, name)) {
      throw new InvalidFormDefinitionError(`Form field name ${name} is duplicated`)
    }

    if (typeof required !== "boolean") {
      throw new InvalidFormDefinitionError(`Form field ${name} must declare required as a boolean`)
    }

    fields[name] = fieldFromFormDefinition(fieldValue, name, fieldType, required)
  }

  return defineSchema(fields)
}

type RequiredKeys<F extends FieldMap> = {
  [K in keyof F]-?: F[K]["required"] extends true ? K : never
}[keyof F]
type OptionalKeys<F extends FieldMap> = Exclude<keyof F, RequiredKeys<F>>
type PrototypeOptionalKeys<F extends FieldMap> = Extract<OptionalKeys<F>, keyof Object>
type EmptySubmissionShape = { readonly [emptySubmissionBrand]?: never }
type PrototypeOptionalFields<F extends FieldMap> =
  | EmptySubmissionShape
  | {
      [K in PrototypeOptionalKeys<F>]: {
        readonly [P in K]: F[P]["valueType"]
      }
    }[PrototypeOptionalKeys<F>]

export type InferSubmission<S extends FormSchema> = {
  readonly [K in RequiredKeys<S["fields"]>]: S["fields"][K]["valueType"]
} & {
  readonly [K in Exclude<OptionalKeys<S["fields"]>, keyof Object>]?: S["fields"][K]["valueType"]
} & PrototypeOptionalFields<S["fields"]>

type InvalidSubmissionKeys<S extends FormSchema, Submission extends object> = {
  [K in keyof Submission]-?: K extends keyof S["fields"]
    ? Submission[K] extends
        | S["fields"][K]["valueType"]
        | (S["fields"][K]["required"] extends false ? undefined : never)
      ? never
      : K
    : K
}[keyof Submission]

export type SubmissionConstraint<S extends FormSchema, Submission extends object> =
  Exclude<RequiredKeys<S["fields"]>, keyof Submission> extends never
    ? InvalidSubmissionKeys<S, Submission> extends never
      ? unknown
      : never
    : never

export const type = {
  string: (): RuntimeType<string> => asRuntimeType({ kind: "string" }),
  number: (): RuntimeType<number> => asRuntimeType({ kind: "number" }),
  boolean: (): RuntimeType<boolean> => asRuntimeType({ kind: "boolean" }),
  enum: <const Values extends readonly string[]>(values: Values): RuntimeType<Values[number]> =>
    snapshotRuntimeType(
      asRuntimeType<Values[number]>({ kind: "enum", values: Object.freeze([...values]) }),
    ),
  array: <Item extends RuntimeType>(item: Item): RuntimeType<readonly InferRuntimeType<Item>[]> =>
    snapshotRuntimeType(asRuntimeType<readonly InferRuntimeType<Item>[]>({ kind: "array", item })),
  object: <const Properties extends Readonly<Record<string, RuntimeType>>>(
    properties: Properties,
  ): RuntimeType<{ readonly [Key in keyof Properties]: InferRuntimeType<Properties[Key]> }> =>
    snapshotRuntimeType(
      asRuntimeType<{ readonly [Key in keyof Properties]: InferRuntimeType<Properties[Key]> }>({
        kind: "object",
        properties,
      }),
    ),
}

export interface SchemaFieldDescription {
  readonly path: string
  readonly type: RuntimeType["kind"]
  readonly required: boolean
  readonly values?: readonly string[]
}

export interface SchemaDescription {
  readonly fields: readonly SchemaFieldDescription[]
}

export function describeSchema(schema: FormSchema): SchemaDescription {
  return {
    fields: Object.entries(schema.fields).map(([name, definition]) => ({
      path: `submission.${name}`,
      type: definition.runtimeType.kind,
      required: definition.required,
      ...(definition.runtimeType.kind === "enum" ? { values: definition.runtimeType.values } : {}),
    })),
  }
}

export interface RuntimeValueLimits {
  readonly maximumStringLength: number
  readonly maximumCollectionSize: number
  readonly maximumValueDepth: number
}

export function validateRuntimeType(
  value: unknown,
  expected: RuntimeType,
  path: string,
  limits?: RuntimeValueLimits,
  depth = 0,
): string | undefined {
  if (limits && depth > limits.maximumValueDepth) {
    return `${path} exceeds the value depth limit`
  }

  switch (expected.kind) {
    case "string":
      return typeof value === "string"
        ? limits && value.length > limits.maximumStringLength
          ? `${path} exceeds the string length limit`
          : undefined
        : `${path} must be a string`

    case "number":
      return typeof value === "number" && Number.isFinite(value)
        ? undefined
        : `${path} must be a finite number`

    case "boolean":
      return typeof value === "boolean" ? undefined : `${path} must be a boolean`

    case "enum":
      return typeof value === "string" && expected.values.includes(value)
        ? limits && value.length > limits.maximumStringLength
          ? `${path} exceeds the string length limit`
          : undefined
        : `${path} must be one of: ${expected.values.join(", ")}`

    case "array": {
      if (!Array.isArray(value)) {
        return `${path} must be an array`
      }

      if (limits && value.length > limits.maximumCollectionSize) {
        return `${path} exceeds the collection size limit`
      }

      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index))

        if (!descriptor) {
          return `${path}[${index}] is required`
        }

        if (!("value" in descriptor)) {
          return `${path}[${index}] must be a data property`
        }

        const issue = validateRuntimeType(
          descriptor.value,
          expected.item,
          `${path}[${index}]`,
          limits,
          depth + 1,
        )

        if (issue) {
          return issue
        }
      }

      return undefined
    }

    case "object": {
      if (!isPlainObject(value)) {
        return `${path} must be an object`
      }

      const keys = Object.keys(value)

      if (limits && keys.length > limits.maximumCollectionSize) {
        return `${path} exceeds the collection size limit`
      }

      const expectedKeys = new Set(Object.keys(expected.properties))

      for (const key of keys) {
        if (!expectedKeys.has(key)) {
          return `${path}.${key} is not allowed`
        }
      }

      const descriptors = Object.getOwnPropertyDescriptors(value)

      for (const [key, childType] of Object.entries(expected.properties)) {
        const descriptor = Object.prototype.hasOwnProperty.call(descriptors, key)
          ? descriptors[key]
          : undefined

        if (!descriptor) {
          return `${path}.${key} is required`
        }

        if (!("value" in descriptor)) {
          return `${path}.${key} must be a data property`
        }

        const issue = validateRuntimeType(
          descriptor.value,
          childType,
          `${path}.${key}`,
          limits,
          depth + 1,
        )

        if (issue) {
          return issue
        }
      }

      return undefined
    }

    default:
      return `${path} uses an unsupported runtime type`
  }
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false
  }

  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

export function snapshotSchema<S extends FormSchema>(schema: S): S {
  if (!isPlainObject(schema)) {
    throw new Error("Schema must be a closed object with fields")
  }

  const closed = readSchemaDataProperty(schema, "closed", "Schema")
  const schemaFields = readSchemaDataProperty(schema, "fields", "Schema")

  if (closed !== true || !isPlainObject(schemaFields)) {
    throw new Error("Schema must be a closed object with fields")
  }

  const fields: Record<string, Field<unknown, boolean>> = Object.create(null) as Record<
    string,
    Field<unknown, boolean>
  >
  const fieldDescriptors = Object.getOwnPropertyDescriptors(schemaFields)

  for (const name of Object.keys(schemaFields)) {
    const fieldDescriptor = fieldDescriptors[name]

    if (
      !fieldDescriptor ||
      !("value" in fieldDescriptor) ||
      !isPlainObject(fieldDescriptor.value)
    ) {
      throw new Error(`Invalid schema field ${name}`)
    }

    const definition = fieldDescriptor.value
    const required = readSchemaDataProperty(definition, "required", `Schema field ${name}`)
    const runtimeType = readSchemaDataProperty(definition, "runtimeType", `Schema field ${name}`)

    if (typeof required !== "boolean") {
      throw new Error(`Invalid schema field ${name}`)
    }

    fields[name] = Object.freeze({
      valueType: undefined,
      required,
      runtimeType: snapshotRuntimeType(runtimeType as RuntimeType),
    }) as unknown as Field<unknown, boolean>
  }
  return Object.freeze({ fields: Object.freeze(fields), closed: true }) as S
}

export function validateRuntimeTypeDescriptor(
  value: unknown,
  path = "type",
  depth = 0,
): asserts value is RuntimeType {
  snapshotRuntimeTypeValue(value, path, depth, new WeakSet())
}

export function snapshotRuntimeType<T extends RuntimeType>(runtimeType: T): T {
  return snapshotRuntimeTypeValue(runtimeType, "type", 0, new WeakSet()) as T
}

function isSafeName(name: string): boolean {
  return (
    /^[A-Za-z_$][\w$]*$/.test(name) && !["__proto__", "prototype", "constructor"].includes(name)
  )
}

function snapshotRuntimeTypeValue(
  value: unknown,
  path: string,
  depth: number,
  ancestors: WeakSet<object>,
): RuntimeType {
  if (!isPlainObject(value) || depth > 32 || ancestors.has(value)) {
    throw new Error(`${path} is invalid`)
  }

  ancestors.add(value)

  try {
    const kind = readSchemaDataProperty(value, "kind", path)

    switch (kind) {
      case "string":
        return Object.freeze(asRuntimeType<string>({ kind: "string" }))

      case "number":
        return Object.freeze(asRuntimeType<number>({ kind: "number" }))

      case "boolean":
        return Object.freeze(asRuntimeType<boolean>({ kind: "boolean" }))

      case "enum": {
        const values = readSchemaDataProperty(value, "values", path)

        if (!Array.isArray(values) || values.length === 0) {
          throw new Error(`${path} must contain unique enum strings`)
        }

        const snapshot: string[] = []

        for (let index = 0; index < values.length; index += 1) {
          const descriptor = Object.getOwnPropertyDescriptor(values, String(index))

          if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "string") {
            throw new Error(`${path} must contain unique enum strings`)
          }

          snapshot.push(descriptor.value)
        }

        if (new Set(snapshot).size !== snapshot.length) {
          throw new Error(`${path} must contain unique enum strings`)
        }

        return Object.freeze(
          asRuntimeType<string>({ kind: "enum", values: Object.freeze(snapshot) }),
        )
      }

      case "array": {
        const item = readSchemaDataProperty(value, "item", path)

        return Object.freeze(
          asRuntimeType<readonly unknown[]>({
            kind: "array",
            item: snapshotRuntimeTypeValue(item, `${path}.item`, depth + 1, ancestors),
          }),
        )
      }

      case "object": {
        const propertyValues = readSchemaDataProperty(value, "properties", path)

        if (!isPlainObject(propertyValues)) {
          throw new Error(`${path}.properties is invalid`)
        }

        const descriptors = Object.getOwnPropertyDescriptors(propertyValues)
        const properties: Record<string, RuntimeType> = Object.create(null) as Record<
          string,
          RuntimeType
        >

        for (const key of Object.keys(propertyValues)) {
          if (!isSafeName(key)) {
            throw new Error(`${path}.${key} has an unsafe property name`)
          }

          const descriptor = descriptors[key]

          if (!descriptor || !("value" in descriptor)) {
            throw new Error(`${path}.${key} must be a data property`)
          }

          properties[key] = snapshotRuntimeTypeValue(
            descriptor.value,
            `${path}.${key}`,
            depth + 1,
            ancestors,
          )
        }

        return Object.freeze(
          asRuntimeType<Record<string, unknown>>({
            kind: "object",
            properties: Object.freeze({ ...properties }),
          }),
        )
      }

      default:
        throw new Error(
          `${path} has unsupported kind ${typeof kind === "string" ? kind : typeof kind}`,
        )
    }
  } finally {
    ancestors.delete(value)
  }
}

function fieldFromFormDefinition(
  definition: Record<string, unknown>,
  name: string,
  fieldType: unknown,
  required: boolean,
): Field<unknown, boolean> {
  switch (fieldType) {
    case "string":
      return required ? field.string({ required: true }) : field.string({ required: false })

    case "number":
      return required ? field.number({ required: true }) : field.number({ required: false })

    case "boolean":
      return required ? field.boolean({ required: true }) : field.boolean({ required: false })

    case "enum": {
      const values = readDataProperty(definition, "values", `Form field ${name}`)

      if (!Array.isArray(values) || values.length === 0) {
        throw new InvalidFormDefinitionError(
          `Enum form field ${name} must contain at least one value`,
        )
      }

      const snapshot: string[] = []

      for (let index = 0; index < values.length; index += 1) {
        const value = readArrayDataProperty(values, index, `Enum form field ${name} values`)

        if (typeof value !== "string") {
          throw new InvalidFormDefinitionError(`Enum form field ${name} values must be strings`)
        }

        snapshot.push(value)
      }

      if (new Set(snapshot).size !== snapshot.length) {
        throw new InvalidFormDefinitionError(`Enum form field ${name} values must be unique`)
      }

      const enumValues = snapshot as [string, ...string[]]

      return required
        ? field.enum(enumValues, { required: true })
        : field.enum(enumValues, { required: false })
    }

    default:
      throw new InvalidFormDefinitionError(
        `Form field ${name} has unsupported type ${
          typeof fieldType === "string" ? fieldType : typeof fieldType
        }`,
      )
  }
}

function readSchemaDataProperty(
  object: Record<string, unknown>,
  property: string,
  subject: string,
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(object, property)

  if (!descriptor || !("value" in descriptor)) {
    throw new Error(`${subject} ${property} must be a data property`)
  }

  return descriptor.value
}

function readDataProperty(
  object: Record<string, unknown>,
  property: string,
  subject: string,
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(object, property)

  if (!descriptor) {
    throw new InvalidFormDefinitionError(`${subject} is missing ${property}`)
  }

  if (!("value" in descriptor)) {
    throw new InvalidFormDefinitionError(`${subject} ${property} must be a data property`)
  }

  return descriptor.value
}

function readArrayDataProperty(array: readonly unknown[], index: number, subject: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(array, String(index))

  if (!descriptor || !("value" in descriptor)) {
    throw new InvalidFormDefinitionError(`${subject}[${index}] must be a data property`)
  }

  return descriptor.value
}

function asRuntimeType<Value>(shape: RuntimeTypeShape): RuntimeType<Value> {
  return shape as RuntimeType<Value>
}
