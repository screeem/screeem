import type { IntegrationErrorCode } from "./contract"

export class IntegrationOperationError extends Error {
  constructor(
    readonly code: IntegrationErrorCode,
    readonly retryable: boolean,
    readonly retryAfterMs: number | null = null,
  ) {
    super(`Integration operation failed: ${code}`)
    this.name = "IntegrationOperationError"
  }
}
