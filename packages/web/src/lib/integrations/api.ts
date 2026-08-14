import "server-only"

import { NextRequest, NextResponse } from "next/server"

export async function readIntegrationJson(
  request: NextRequest,
  maximumBytes = 4_096,
): Promise<{ readonly value: unknown } | { readonly response: NextResponse }> {
  const declared = request.headers.get("content-length")
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maximumBytes)) {
    return { response: tooLarge() }
  }
  const reader = request.body?.getReader()
  if (!reader) return { value: {} }
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
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
  } catch {
    return {
      response: NextResponse.json(
        { error: "Invalid request body" },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      ),
    }
  }
}

function tooLarge() {
  return NextResponse.json(
    { error: "Request body is too large" },
    { status: 413, headers: { "Cache-Control": "no-store" } },
  )
}
