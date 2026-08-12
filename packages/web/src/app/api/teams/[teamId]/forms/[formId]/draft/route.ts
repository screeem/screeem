import { NextRequest, NextResponse } from "next/server"
import type { FormDefinition } from "@screeem/forms"
import { authorizeFormTeam } from "@/lib/forms/authorization"
import { formErrorResponse } from "@/lib/forms/http"
import { createFormDefinitionStore } from "@/lib/forms/server"
import { createAdminClient } from "@/lib/supabase/admin"

type Context = { params: Promise<{ teamId: string; formId: string }> }

export async function GET(_request: NextRequest, context: Context) {
  const { teamId, formId } = await context.params
  const auth = await authorizeFormTeam(teamId)
  if (auth.error) return auth.error

  const admin = createAdminClient()
  const { data, error } = await admin
    .from("forms")
    .select(
      "id, draft_definition, legacy_unstructured, definition_availability, published_version, last_published_draft_revision",
    )
    .eq("id", formId)
    .eq("team_id", teamId)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: "Form not found" }, { status: 404 })
  if (data.draft_definition === null) {
    return NextResponse.json({
      draft: null,
      legacy: data.legacy_unstructured,
      availability: data.definition_availability,
      publishedVersion: data.published_version,
      lastPublishedDraftRevision: data.last_published_draft_revision,
    })
  }

  try {
    const store = createFormDefinitionStore(teamId)
    const record = await store.get(formId)
    return NextResponse.json({
      draft: record.draft,
      legacy: data.legacy_unstructured,
      availability: record.availability,
      publishedVersion: record.publishedVersion,
      lastPublishedDraftRevision: data.last_published_draft_revision,
    })
  } catch (storeError) {
    return formErrorResponse(storeError)
  }
}

export async function PUT(request: NextRequest, context: Context) {
  const { teamId, formId } = await context.params
  const auth = await authorizeFormTeam(teamId, true)
  if (auth.error) return auth.error
  const body = (await request.json().catch(() => null)) as {
    definition?: FormDefinition
    expectedRevision?: number
  } | null
  if (
    !body?.definition ||
    !Number.isSafeInteger(body.expectedRevision) ||
    body.expectedRevision! < 0
  ) {
    return NextResponse.json(
      { error: "definition and a non-negative expectedRevision are required" },
      { status: 400 },
    )
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from("forms")
    .select("id, draft_definition")
    .eq("id", formId)
    .eq("team_id", teamId)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: "Form not found" }, { status: 404 })
  if (data.draft_definition === null && body.expectedRevision !== 0) {
    return NextResponse.json(
      {
        error: `Form ${formId} draft revision is 0, not ${body.expectedRevision}`,
        currentRevision: 0,
      },
      { status: 409 },
    )
  }

  try {
    const store = createFormDefinitionStore(teamId)
    const draft =
      data.draft_definition === null
        ? (await store.create(formId, body.definition)).draft
        : await store.saveDraft(formId, body.expectedRevision!, body.definition)
    return NextResponse.json({ draft })
  } catch (storeError) {
    return formErrorResponse(storeError)
  }
}
