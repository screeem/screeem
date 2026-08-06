import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canManage, getMembership } from "@/lib/teams/server";

async function authorize(teamId: string, actorId: string, targetId: string) {
  const actor = await getMembership(actorId, teamId);
  const target = await getMembership(targetId, teamId);
  if (!actor || !target || !canManage(actor.role)) return null;
  if (target.role === "owner" || (actor.role === "admin" && target.role === "admin")) return null;
  return { actor, target };
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ teamId: string; userId: string }> }) {
  const { teamId, userId } = await context.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const allowed = await authorize(teamId, user.id, userId);
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await request.json().catch(() => null) as { role?: string } | null;
  if (body?.role !== "admin" && body?.role !== "member") return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  if (body.role === "admin" && allowed.actor.role !== "owner") return NextResponse.json({ error: "Only owners can promote admins" }, { status: 403 });
  const admin = createAdminClient();
  const { error } = await admin.from("team_members").update({ role: body.role }).eq("team_id", teamId).eq("user_id", userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ teamId: string; userId: string }> }) {
  const { teamId, userId } = await context.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const selfLeave = user.id === userId;
  const ownMembership = await getMembership(user.id, teamId);
  if (!ownMembership || ownMembership.role === "owner") return NextResponse.json({ error: "Owners cannot leave or be removed" }, { status: 403 });
  if (!selfLeave && !(await authorize(teamId, user.id, userId))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const admin = createAdminClient();
  await admin.from("api_keys").delete().eq("team_id", teamId).eq("user_id", userId);
  const { error } = await admin.from("team_members").delete().eq("team_id", teamId).eq("user_id", userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
