import { NextRequest, NextResponse } from "next/server"
import { authorizeFormTeam } from "@/lib/forms/authorization"
import { formErrorResponse } from "@/lib/forms/http"
import { createFormDefinitionStore } from "@/lib/forms/server"

type Context = { params: Promise<{ teamId: string; formId: string }> }

export async function POST(request: NextRequest, context: Context) {
  const { teamId, formId } = await context.params
  const auth = await authorizeFormTeam(teamId, true)
  if (auth.error) return auth.error
  const body = (await request.json().catch(() => null)) as {
    expectedRevision?: number
  } | null
  if (!Number.isSafeInteger(body?.expectedRevision) || body!.expectedRevision! < 0) {
    return NextResponse.json(
      { error: "A non-negative expectedRevision is required" },
      { status: 400 },
    )
  }

  try {
    const store = createFormDefinitionStore(teamId)
    const published = await store.publish(formId, body!.expectedRevision!, new Date().toISOString())
    const record = await store.get(formId)
    return NextResponse.json({ published, availability: record.availability })
  } catch (storeError) {
    return formErrorResponse(storeError)
  }
}
