import { NextRequest, NextResponse } from "next/server"
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

  const [submissionsResult, routesResult] = await Promise.all([
    submissionsQuery,
    admin.rpc("list_form_submission_routes", {
      target_team_id: teamId,
      target_form_id: formId,
    }),
  ])
  if (submissionsResult.error || routesResult.error) {
    return NextResponse.json(
      { error: submissionsResult.error?.message ?? routesResult.error?.message },
      { status: 500 },
    )
  }
  const routeRows = (routesResult.data ?? []) as Array<{ route: unknown }>
  const routes = routeRows.flatMap(({ route }) =>
    typeof route === "string" ? [route] : [],
  )
  return NextResponse.json({ submissions: submissionsResult.data ?? [], routes })
}
