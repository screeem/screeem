import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { canManage, getMembership } from "@/lib/teams/server"
import { createFormDefinitionStore } from "@/lib/forms/server"
import { formErrorResponse } from "@/lib/forms/http"
import { normalizeSubmissionSchema, type SubmissionSchema } from "@/lib/forms/schema"

async function manager(teamId: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const membership = await getMembership(user.id, teamId)
  if (!membership || !canManage(membership.role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
}

async function member(teamId: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!(await getMembership(user.id, teamId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ teamId: string; formId: string }> },
) {
  const { teamId, formId } = await context.params
  const denied = await member(teamId)
  if (denied) return denied
  const admin = createAdminClient()
  const { data, error } = await admin
    .from("forms")
    .select(
      "id, name, endpoint_key, allowed_origin, success_url, is_active, requires_turnstile, submission_schema, legacy_unstructured, availability:definition_availability, draft_revision, published_version, created_at, updated_at",
    )
    .eq("id", formId)
    .eq("team_id", teamId)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: "Form not found" }, { status: 404 })
  return NextResponse.json({ form: data })
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ teamId: string; formId: string }> },
) {
  const { teamId, formId } = await context.params
  const denied = await manager(teamId)
  if (denied) return denied
  const body = (await request.json().catch(() => null)) as {
    isActive?: boolean
    availability?: "active" | "paused"
    requiresTurnstile?: boolean
    submissionSchema?: unknown
  } | null
  if (!body) return NextResponse.json({ error: "Provide a form setting to update" }, { status: 400 })
  if (
    body?.availability !== undefined &&
    body.isActive !== undefined &&
    (body.availability === "active") !== body.isActive
  ) {
    return NextResponse.json(
      { error: "availability and isActive must describe the same state" },
      { status: 400 },
    )
  }
  const hasSchema = Object.prototype.hasOwnProperty.call(body, "submissionSchema")
  const hasTurnstile = typeof body.requiresTurnstile === "boolean"
  if (
    body.availability === undefined &&
    body.isActive === undefined &&
    !hasSchema &&
    !hasTurnstile
  ) {
    return NextResponse.json({ error: "Provide a form setting to update" }, { status: 400 })
  }

  let submissionSchema: SubmissionSchema | null | undefined
  try {
    if (hasSchema) submissionSchema = normalizeSubmissionSchema(body.submissionSchema)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid JSON Schema" },
      { status: 400 },
    )
  }

  if (body.availability !== undefined) {
    if (body.availability !== "active" && body.availability !== "paused") {
      return NextResponse.json({ error: "availability must be active or paused" }, { status: 400 })
    }
    try {
      await createFormDefinitionStore(teamId).setAvailability(formId, body.availability)
    } catch (error) {
      return formErrorResponse(error)
    }
  }
  const admin = createAdminClient()
  const { data: current, error: currentError } = await admin
    .from("forms")
    .select("legacy_unstructured")
    .eq("id", formId)
    .eq("team_id", teamId)
    .maybeSingle()
  if (currentError) return NextResponse.json({ error: currentError.message }, { status: 500 })
  if (!current) return NextResponse.json({ error: "Form not found" }, { status: 404 })
  if (
    body.availability === undefined &&
    typeof body.isActive === "boolean" &&
    !current.legacy_unstructured
  ) {
    try {
      await createFormDefinitionStore(teamId).setAvailability(
        formId,
        body.isActive ? "active" : "paused",
      )
    } catch (error) {
      return formErrorResponse(error)
    }
  } else if (body.availability === undefined && typeof body.isActive === "boolean") {
    const { error } = await admin
      .from("forms")
      .update({ is_active: body.isActive, updated_at: new Date().toISOString() })
      .eq("id", formId)
      .eq("team_id", teamId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (hasTurnstile || hasSchema) {
    const update: {
      requires_turnstile?: boolean
      submission_schema?: SubmissionSchema | null
      updated_at: string
    } = { updated_at: new Date().toISOString() }
    if (hasTurnstile) update.requires_turnstile = body.requiresTurnstile
    if (hasSchema) update.submission_schema = submissionSchema
    const { error } = await admin
      .from("forms")
      .update(update)
      .eq("id", formId)
      .eq("team_id", teamId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const { data, error } = await admin
    .from("forms")
    .select(
      "id, is_active, requires_turnstile, submission_schema, availability:definition_availability, draft_revision, published_version",
    )
    .eq("id", formId)
    .eq("team_id", teamId)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: "Form not found" }, { status: 404 })
  return NextResponse.json({ form: data })
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ teamId: string; formId: string }> },
) {
  const { teamId, formId } = await context.params
  const denied = await manager(teamId)
  if (denied) return denied
  const admin = createAdminClient()
  const { error, count } = await admin
    .from("forms")
    .delete({ count: "exact" })
    .eq("id", formId)
    .eq("team_id", teamId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!count) return NextResponse.json({ error: "Form not found" }, { status: 404 })
  return new NextResponse(null, { status: 204 })
}
