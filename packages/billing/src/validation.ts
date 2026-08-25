import { BillingConfigurationError, InvalidBillingRequestError } from "./errors.js"

const safeIdentifier = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/
const safeOfferIdentifier = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const controlCharacters = /[\u0000-\u001F\u007F-\u009F]/

export function configurationString(value: unknown, label: string, maximum = 512): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    value.trim() !== value ||
    controlCharacters.test(value)
  ) {
    throw new BillingConfigurationError({
      reason: `${label} must be a non-empty safe string`,
    })
  }
  return value
}

export function providerName(value: unknown): string {
  const name = configurationString(value, "provider name", 64)
  if (!/^[a-z][a-z0-9_-]*$/.test(name)) {
    throw new BillingConfigurationError({
      reason: "provider name has an unsupported format",
    })
  }
  return name
}

export function offerId(value: unknown, error: "configuration" | "request"): string {
  const invalid = () => {
    if (error === "configuration") {
      throw new BillingConfigurationError({ reason: "offer ID has an unsupported format" })
    }
    throw new InvalidBillingRequestError({ reason: "offer ID has an unsupported format" })
  }

  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 200 ||
    !safeOfferIdentifier.test(value)
  ) {
    return invalid()
  }
  return value
}

export function requestIdentifier(value: unknown, label: string, maximum = 255): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    !safeIdentifier.test(value)
  ) {
    throw new InvalidBillingRequestError({ reason: `${label} has an unsupported format` })
  }
  return value
}

export function requestEmail(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 254 ||
    value.trim() !== value ||
    controlCharacters.test(value) ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
  ) {
    throw new InvalidBillingRequestError({ reason: "subject email is invalid" })
  }
  return value
}

export function requestUrl(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 2_048) {
    throw new InvalidBillingRequestError({ reason: `${label} is invalid` })
  }

  try {
    const parsed = new URL(value)
    if (
      (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
      parsed.username !== "" ||
      parsed.password !== ""
    ) {
      throw new Error("unsupported URL")
    }
    return parsed.toString()
  } catch {
    throw new InvalidBillingRequestError({
      reason: `${label} must be an HTTP or HTTPS URL without credentials`,
    })
  }
}

export function positiveInteger(value: unknown, label: string, maximum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new InvalidBillingRequestError({
      reason: `${label} must be an integer from 1 to ${maximum}`,
    })
  }
  return value
}

export function requestBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new InvalidBillingRequestError({ reason: `${label} must be a boolean` })
  }
  return value
}

export function requestSignature(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 8_192 ||
    controlCharacters.test(value)
  ) {
    throw new InvalidBillingRequestError({ reason: "webhook signature is invalid" })
  }
  return value
}

export function outputIdentifier(value: unknown, provider: string, label: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 512 ||
    controlCharacters.test(value)
  ) {
    throw new BillingConfigurationError({
      reason: `${provider} returned an invalid ${label}`,
    })
  }
  return value
}

export function outputUrl(value: unknown, provider: string, label: string): string {
  if (typeof value !== "string") {
    throw new BillingConfigurationError({
      reason: `${provider} returned an invalid ${label}`,
    })
  }
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("protocol")
    return parsed.toString()
  } catch {
    throw new BillingConfigurationError({
      reason: `${provider} returned an invalid ${label}`,
    })
  }
}

export function outputTimestamp(value: unknown, provider: string): string | null {
  if (value === null) return null
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new BillingConfigurationError({
      reason: `${provider} returned an invalid expiry timestamp`,
    })
  }
  return new Date(value).toISOString()
}

export function outputPositiveInteger(
  value: unknown,
  provider: string,
  label: string,
  maximum = 999_999,
): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new BillingConfigurationError({
      reason: `${provider} returned an invalid ${label}`,
    })
  }
  return value
}
