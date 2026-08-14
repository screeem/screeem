import type { SubmissionRoutingResult } from "./model.js"

const maximumRouteLength = 256
const maximumRuleIdLength = 128
const maximumErrorLength = 128

export function notConfiguredSubmissionRouting(): SubmissionRoutingResult {
  return Object.freeze({
    status: "not_configured",
    route: null,
    matchedRule: null,
    error: null,
  })
}

export function matchedSubmissionRouting(
  route: string,
  matchedRule: string,
): SubmissionRoutingResult {
  return snapshotSubmissionRoutingResult({
    status: "matched",
    route,
    matchedRule,
    error: null,
  })
}

export function fallbackSubmissionRouting(route: string): SubmissionRoutingResult {
  return snapshotSubmissionRoutingResult({
    status: "fallback",
    route,
    matchedRule: null,
    error: null,
  })
}

export function failedSubmissionRouting(error: string): SubmissionRoutingResult {
  return snapshotSubmissionRoutingResult({
    status: "failed",
    route: null,
    matchedRule: null,
    error,
  })
}

export function snapshotSubmissionRoutingResult(input: unknown): SubmissionRoutingResult {
  const routing = requireRoutingObject(input)
  const status = readData(routing, "status")
  const route = readData(routing, "route")
  const matchedRule = readData(routing, "matchedRule")
  const error = readData(routing, "error")

  if (
    status !== "not_configured" &&
    status !== "matched" &&
    status !== "fallback" &&
    status !== "failed"
  ) {
    throw new TypeError("Submission routing status is invalid")
  }
  if (
    route !== null &&
    (typeof route !== "string" || route.length === 0 || route.length > maximumRouteLength)
  ) {
    throw new TypeError("Submission route is invalid")
  }
  if (
    matchedRule !== null &&
    (typeof matchedRule !== "string" ||
      matchedRule.length === 0 ||
      matchedRule.length > maximumRuleIdLength)
  ) {
    throw new TypeError("Submission matched rule is invalid")
  }
  if (error !== null && (typeof error !== "string" || !error || error.length > maximumErrorLength)) {
    throw new TypeError("Submission routing error is invalid")
  }

  const valid =
    (status === "not_configured" && route === null && matchedRule === null && error === null) ||
    (status === "matched" &&
      typeof route === "string" &&
      typeof matchedRule === "string" &&
      error === null) ||
    (status === "fallback" && typeof route === "string" && matchedRule === null && error === null) ||
    (status === "failed" && route === null && matchedRule === null && typeof error === "string")
  if (!valid) throw new TypeError("Submission routing fields do not match its status")

  return Object.freeze({ status, route, matchedRule, error })
}

function readData(input: Record<string, unknown>, key: string): unknown {
  let descriptor: PropertyDescriptor | undefined
  try {
    descriptor = Object.getOwnPropertyDescriptor(input, key)
  } catch {
    throw new TypeError(`Submission routing ${key} could not be read safely`)
  }
  if (!descriptor || !("value" in descriptor)) {
    throw new TypeError(`Submission routing ${key} must be a data property`)
  }
  return descriptor.value
}

function requireRoutingObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Submission routing must be a plain object")
  }
  let prototype: object | null
  let keys: string[]
  let symbols: symbol[]
  try {
    prototype = Object.getPrototypeOf(value)
    keys = Object.getOwnPropertyNames(value)
    symbols = Object.getOwnPropertySymbols(value)
  } catch {
    throw new TypeError("Submission routing could not be read safely")
  }
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Submission routing must be a plain object")
  }
  const expected = new Set(["status", "route", "matchedRule", "error"])
  if (symbols.length > 0 || keys.length !== expected.size || keys.some((key) => !expected.has(key))) {
    throw new TypeError("Submission routing contains unexpected fields")
  }
  return value as Record<string, unknown>
}
