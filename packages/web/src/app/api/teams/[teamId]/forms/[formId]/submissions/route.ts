import { NextRequest, NextResponse } from "next/server"
import { snapshotFormSubmissionsApiResponse } from "../../../../../../../lib/forms/submission-contract"
import { createFormRoutingPersistence } from "../../../../../../../lib/forms/routing-persistence"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getMembership } from "@/lib/teams/server"

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ teamId: string; formId: string }> },
) {
  const { teamId, formId } = await context.params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!(await getMembership(user.id, teamId)))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get("limit")) || 50, 1), 100)
  const route = request.nextUrl.searchParams.get("route")
  if (route !== null && route.length > 256) {
    return NextResponse.json({ error: "Route filter is too long" }, { status: 400 })
  }
  const admin = createAdminClient()
  const { data: form } = await admin
    .from("forms")
    .select("id")
    .eq("id", formId)
    .eq("team_id", teamId)
    .maybeSingle()
  if (!form) return NextResponse.json({ error: "Form not found" }, { status: 404 })
  let submissionsQuery = admin
    .from("form_submissions")
    .select(
      "id, payload, publication_version, routing_status, routing_route, " +
        "matched_rule_id, routing_error, origin, created_at",
    )
    .eq("team_id", teamId)
    .eq("form_id", formId)
    .order("created_at", { ascending: false })
    .limit(limit)
  if (route !== null) submissionsQuery = submissionsQuery.eq("routing_route", route)

  const loaded = await Promise.all([
      submissionsQuery,
      createFormRoutingPersistence().listRecentRoutes(teamId, formId),
    ]).catch(() => null)
  if (!loaded) {
    return NextResponse.json({ error: "Could not load submissions" }, { status: 500 })
  }
  const [submissionsResult, routes] = loaded
  if (submissionsResult.error) {
    return NextResponse.json({ error: submissionsResult.error.message }, { status: 500 })
  }
  try {
    const submissionData: unknown = submissionsResult.data
    if (!Array.isArray(submissionData)) {
      throw new TypeError("Invalid submission query result")
    }
    const submissionIds = submissionData.map((row) => {
      if (!isRecord(row) || typeof row.id !== "string") {
        throw new TypeError("Invalid submission query result")
      }
      return row.id
    })
    const actionsBySubmission = new Map<string, unknown[]>()
    if (submissionIds.length > 0) {
      const actionResult = await admin
        .from("form_submission_action_executions")
        .select("submission_id, action_key, action_name, status, attempt_count, last_error")
        .eq("team_id", teamId)
        .eq("form_id", formId)
        .in("submission_id", submissionIds)
        .order("action_index", { ascending: true })
      if (actionResult.error && !missingActionExecutionTable(actionResult.error)) {
        return NextResponse.json({ error: actionResult.error.message }, { status: 500 })
      }
      const actionData: unknown = actionResult.error ? [] : actionResult.data
      if (!Array.isArray(actionData)) throw new TypeError("Invalid action query result")
      const knownSubmissionIds = new Set(submissionIds)
      for (const row of actionData) {
        if (
          !isRecord(row) ||
          typeof row.submission_id !== "string" ||
          !knownSubmissionIds.has(row.submission_id)
        ) {
          throw new TypeError("Invalid action query result")
        }
        const existing = actionsBySubmission.get(row.submission_id)
        if (existing) existing.push(row)
        else actionsBySubmission.set(row.submission_id, [row])
      }
    }
    const response = snapshotFormSubmissionsApiResponse({
      submissions: submissionData.map((submission) => ({
        ...submission,
        action_executions:
          isRecord(submission) && typeof submission.id === "string"
            ? (actionsBySubmission.get(submission.id) ?? [])
            : [],
      })),
      routes,
    })
    return NextResponse.json(response)
  } catch {
    return NextResponse.json({ error: "Stored submission data is invalid" }, { status: 500 })
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function missingActionExecutionTable(error: { readonly code?: string; readonly message: string }) {
  return (
    (error.code === "PGRST205" || error.code === "42P01") &&
    error.message.includes("form_submission_action_executions")
  )
}
