import { maximumFormRoutingBytes, type FormRoutingDefinition } from "@screeem/forms"
import { NextRequest, NextResponse } from "next/server"
import { authorizeFormTeam } from "@/lib/forms/authorization"
import { formErrorResponse } from "@/lib/forms/http"
import { createFormDefinitionStore } from "@/lib/forms/server"

type Context = { params: Promise<{ teamId: string; formId: string }> }
// Allow a small envelope around the shared encoded-routing budget.
const MAX_ROUTING_DRAFT_BYTES = maximumFormRoutingBytes + 1_024

export async function PUT(request: NextRequest, context: Context) {
  const { teamId, formId } = await context.params
  const auth = await authorizeFormTeam(teamId, true)
  if (auth.error) return auth.error

  const parsed = await readJsonBody(request)
  if (parsed.response) return parsed.response
  const body = parsed.value as {
    expectedRevision?: number
    routing?: FormRoutingDefinition | null
  } | null
  if (
    body === null ||
    !Object.prototype.hasOwnProperty.call(body, "routing") ||
    !Number.isSafeInteger(body.expectedRevision) ||
    body.expectedRevision! < 0
  ) {
    return NextResponse.json(
      { error: "routing and a non-negative expectedRevision are required" },
      { status: 400 },
    )
  }

  try {
    const store = createFormDefinitionStore(teamId)
    const draft = await store.saveRoutingDraft(
      formId,
      body.expectedRevision!,
      body.routing ?? null,
    )
    return NextResponse.json({ draft })
  } catch (storeError) {
    return formErrorResponse(storeError)
  }
}

async function readJsonBody(
  request: NextRequest,
): Promise<{ value: unknown; response?: never } | { value?: never; response: NextResponse }> {
  const declaredLength = Number(request.headers.get("content-length"))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_ROUTING_DRAFT_BYTES) {
    return { response: tooLarge() }
  }

  if (request.body === null) return { value: null }
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > MAX_ROUTING_DRAFT_BYTES) {
        await reader.cancel().catch(() => undefined)
        return { response: tooLarge() }
      }
      chunks.push(value)
    }
  } catch {
    return { value: null }
  }

  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }

  try {
    return { value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) }
  } catch {
    return { value: null }
  }
}

function tooLarge() {
  return NextResponse.json({ error: "Routing draft is too large" }, { status: 413 })
}
