import "server-only"

import { NextRequest, NextResponse } from "next/server"

export async function readIntegrationJson(
  request: NextRequest,
  maximumBytes = 4_096,
  signal?: AbortSignal,
): Promise<{ readonly value: unknown } | { readonly response: NextResponse }> {
  signal?.throwIfAborted()
  const declared = request.headers.get("content-length")
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maximumBytes)) {
    return { response: tooLarge() }
  }
  const reader = request.body?.getReader()
  if (!reader) return { value: {} }
  const chunks: Uint8Array[] = []
  let length = 0
  const onAbort = () => {
    void reader.cancel(signal?.reason).catch(() => undefined)
  }
  signal?.addEventListener("abort", onAbort, { once: true })
  try {
    if (signal?.aborted) {
      await reader.cancel(signal.reason).catch(() => undefined)
      signal.throwIfAborted()
    }
    while (true) {
      const { value, done } = await reader.read()
      signal?.throwIfAborted()
      if (done) break
      length += value.byteLength
      if (length > maximumBytes) {
        await reader.cancel().catch(() => undefined)
        return { response: tooLarge() }
      }
      chunks.push(value)
    }
    const bytes = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    return { value: text.length === 0 ? {} : JSON.parse(text) as unknown }
  } catch (error) {
    signal?.throwIfAborted()
    return {
      response: NextResponse.json(
        { error: "Invalid request body" },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      ),
    }
  } finally {
    signal?.removeEventListener("abort", onAbort)
  }
}

function tooLarge() {
  return NextResponse.json(
    { error: "Request body is too large" },
    { status: 413, headers: { "Cache-Control": "no-store" } },
  )
}
