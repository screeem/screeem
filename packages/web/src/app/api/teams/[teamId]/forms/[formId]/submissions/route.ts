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
  const admin = createAdminClient()
  const { data: form } = await admin
    .from("forms")
    .select("id")
    .eq("id", formId)
    .eq("team_id", teamId)
    .maybeSingle()
  if (!form) return NextResponse.json({ error: "Form not found" }, { status: 404 })
  const { data, error } = await admin
    .from("form_submissions")
    .select("id, payload, publication_version, origin, created_at")
    .eq("team_id", teamId)
    .eq("form_id", formId)
    .order("created_at", { ascending: false })
    .limit(limit)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ submissions: data ?? [] })
}
