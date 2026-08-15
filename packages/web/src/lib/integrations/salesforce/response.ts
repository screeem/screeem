import "server-only"

import { SalesforceError } from "./contract"

export function throwIfSalesforceAborted(signal?: AbortSignal, error?: unknown) {
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError")
  if (
    error instanceof DOMException &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  ) {
    throw error
  }
}

export async function readBoundedSalesforceResponse(
  response: Response,
  maximumBytes: number,
  signal?: AbortSignal,
) {
  throwIfSalesforceAborted(signal)
  const declared = response.headers.get("content-length")
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maximumBytes)) {
    await response.body?.cancel().catch(() => undefined)
    throw new SalesforceError("invalid_provider_response", true)
  }
  const reader = response.body?.getReader()
  if (!reader) return ""
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      throwIfSalesforceAborted(signal)
      if (done) break
      length += value.byteLength
      if (length > maximumBytes) {
        await reader.cancel().catch(() => undefined)
        throw new SalesforceError("invalid_provider_response", true)
      }
      chunks.push(value)
    }
    const bytes = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch (error) {
    throwIfSalesforceAborted(signal, error)
    if (error instanceof SalesforceError) throw error
    throw new SalesforceError("invalid_provider_response", true)
  }
}
