import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canManage, getMembership } from "@/lib/teams/server";

async function manager(teamId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const membership = await getMembership(user.id, teamId);
  if (!membership || !canManage(membership.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ teamId: string; formId: string }> }) {
  const { teamId, formId } = await context.params;
  const denied = await manager(teamId); if (denied) return denied;
  const body = await request.json().catch(() => null) as { isActive?: boolean } | null;
  if (typeof body?.isActive !== "boolean") return NextResponse.json({ error: "isActive must be a boolean" }, { status: 400 });
  const admin = createAdminClient();
  const { data, error } = await admin.from("forms").update({ is_active: body.isActive, updated_at: new Date().toISOString() })
    .eq("id", formId).eq("team_id", teamId).select("id, is_active").maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Form not found" }, { status: 404 });
  return NextResponse.json({ form: data });
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ teamId: string; formId: string }> }) {
  const { teamId, formId } = await context.params;
  const denied = await manager(teamId); if (denied) return denied;
  const admin = createAdminClient();
  const { error, count } = await admin.from("forms").delete({ count: "exact" }).eq("id", formId).eq("team_id", teamId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!count) return NextResponse.json({ error: "Form not found" }, { status: 404 });
  return new NextResponse(null, { status: 204 });
}
