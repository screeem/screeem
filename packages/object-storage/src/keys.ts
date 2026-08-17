import { InvalidObjectKeyError } from "./errors.js"

/**
 * A tenant-bound location. Keys carry the owning team rather than leaving
 * tenancy to string concatenation at each call site, so no caller can address
 * another team's objects by accident.
 */
export interface ObjectKey {
  readonly teamId: string
  readonly scope: string
  readonly path: readonly string[]
}

/** A tenant-bound location prefix. An absent path lists the whole scope. */
export interface ObjectPrefix {
  readonly teamId: string
  readonly scope: string
  readonly path?: readonly string[]
}

export interface ObjectKeyLimits {
  readonly maximumPathSegments: number
  readonly maximumSegmentLength: number
  readonly maximumCanonicalKeyLength: number
}

export const defaultObjectKeyLimits: ObjectKeyLimits = Object.freeze({
  maximumPathSegments: 8,
  maximumSegmentLength: 128,
  maximumCanonicalKeyLength: 512,
})

/** Reserved first segment so canonical keys are self-describing in a bucket. */
const tenantRoot = "teams"

/**
 * Segments are deliberately narrow. Traversal, absolute paths, control
 * characters, percent encoding, and provider-specific delimiters are all
 * unrepresentable rather than escaped later.
 */
const safeSegment = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export function objectKey(
  input: ObjectKey,
  limits: ObjectKeyLimits = defaultObjectKeyLimits,
): ObjectKey {
  validateKeyLimits(limits)
  const teamId = validatedSegment(input.teamId, "team id", limits)
  const scope = validatedSegment(input.scope, "scope", limits)
  const path = validatedPath(input.path, limits)

  if (path.length === 0) {
    throw new InvalidObjectKeyError("a key needs at least one path segment")
  }

  const key: ObjectKey = Object.freeze({ teamId, scope, path: Object.freeze(path) })
  assertCanonicalLength(canonicalKeyString(key), limits)
  return key
}

export function objectPrefix(
  input: ObjectPrefix,
  limits: ObjectKeyLimits = defaultObjectKeyLimits,
): ObjectPrefix {
  validateKeyLimits(limits)
  const teamId = validatedSegment(input.teamId, "team id", limits)
  const scope = validatedSegment(input.scope, "scope", limits)
  const path = validatedPath(input.path ?? [], limits)
  const prefix: ObjectPrefix =
    path.length === 0
      ? Object.freeze({ teamId, scope })
      : Object.freeze({ teamId, scope, path: Object.freeze(path) })

  assertCanonicalLength(canonicalPrefixString(prefix), limits)
  return prefix
}

/** Renders the single storage path an adapter uses for this key. */
export function canonicalObjectKey(
  key: ObjectKey,
  limits: ObjectKeyLimits = defaultObjectKeyLimits,
): string {
  return canonicalKeyString(objectKey(key, limits))
}

/** Renders a listing prefix, always delimiter-terminated so scopes cannot bleed. */
export function canonicalObjectPrefix(
  prefix: ObjectPrefix,
  limits: ObjectKeyLimits = defaultObjectKeyLimits,
): string {
  return canonicalPrefixString(objectPrefix(prefix, limits))
}

/** Rebuilds a tenant-bound key from the canonical path an adapter reported. */
export function parseCanonicalObjectKey(
  canonical: string,
  limits: ObjectKeyLimits = defaultObjectKeyLimits,
): ObjectKey {
  if (typeof canonical !== "string") {
    throw new InvalidObjectKeyError("a canonical key must be a string")
  }

  const segments = canonical.split("/")
  const [root, teamId, scope, ...path] = segments

  if (root !== tenantRoot || teamId === undefined || scope === undefined) {
    throw new InvalidObjectKeyError(`${canonical} is not a tenant-scoped object path`)
  }

  return objectKey({ teamId, scope, path }, limits)
}

export function objectKeysEqual(left: ObjectKey, right: ObjectKey): boolean {
  return canonicalKeyString(left) === canonicalKeyString(right)
}

function canonicalKeyString(key: ObjectKey): string {
  return [tenantRoot, key.teamId, key.scope, ...key.path].join("/")
}

function canonicalPrefixString(prefix: ObjectPrefix): string {
  return `${[tenantRoot, prefix.teamId, prefix.scope, ...(prefix.path ?? [])].join("/")}/`
}

function validatedPath(path: unknown, limits: ObjectKeyLimits): string[] {
  if (!Array.isArray(path)) {
    throw new InvalidObjectKeyError("a path must be an array of segments")
  }

  if (path.length > limits.maximumPathSegments) {
    throw new InvalidObjectKeyError(`a path allows at most ${limits.maximumPathSegments} segments`)
  }

  return Array.from({ length: path.length }, (_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(path, String(index))

    if (!descriptor || !("value" in descriptor)) {
      throw new InvalidObjectKeyError("a path must contain data properties")
    }

    return validatedSegment(descriptor.value, `path segment ${index}`, limits)
  })
}

function validatedSegment(value: unknown, label: string, limits: ObjectKeyLimits): string {
  if (typeof value !== "string") {
    throw new InvalidObjectKeyError(`${label} must be a string`)
  }

  if (value.length === 0) {
    throw new InvalidObjectKeyError(`${label} must not be empty`)
  }

  if (value.length > limits.maximumSegmentLength) {
    throw new InvalidObjectKeyError(
      `${label} is longer than ${limits.maximumSegmentLength} characters`,
    )
  }

  if (!safeSegment.test(value) || value.includes("..") || value.endsWith(".")) {
    throw new InvalidObjectKeyError(`${label} contains characters that are not allowed`)
  }

  return value
}

function assertCanonicalLength(canonical: string, limits: ObjectKeyLimits): void {
  if (canonical.length > limits.maximumCanonicalKeyLength) {
    throw new InvalidObjectKeyError(
      `the canonical path is longer than ${limits.maximumCanonicalKeyLength} characters`,
    )
  }
}

function validateKeyLimits(limits: ObjectKeyLimits): void {
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new InvalidObjectKeyError(`limit ${name} must be a positive integer`)
    }
  }
}
