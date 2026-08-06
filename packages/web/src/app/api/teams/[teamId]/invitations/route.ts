import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canManage, getMembership, type TeamRole } from "@/lib/teams/server";

export async function POST(request: NextRequest, context: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await context.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const membership = await getMembership(user.id, teamId);
  if (!membership || !canManage(membership.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => null) as { email?: string; role?: TeamRole } | null;
  const email = body?.email?.trim().toLowerCase();
  const role = body?.role === "admin" ? "admin" : "member";
  if (role === "admin" && membership.role !== "owner") {
    return NextResponse.json({ error: "Only owners can invite admins" }, { status: 403 });
  }
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
  }

  const admin = createAdminClient();
  const token = crypto.randomBytes(32).toString("base64url");
  const { data, error } = await admin.from("team_invitations").upsert(
    { team_id: teamId, email, role, token, invited_by: user.id, expires_at: new Date(Date.now() + 7 * 86400000).toISOString() },
    { onConflict: "team_id,email" }
  ).select("id, email, role, token, expires_at").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ invitation: data, inviteUrl: `${request.nextUrl.origin}/invite/${token}` }, { status: 201 });
}
