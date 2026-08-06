import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ACTIVE_TEAM_COOKIE, getUserTeams } from "@/lib/teams/server";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ teams: await getUserTeams(user.id, user.email) });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null) as { name?: string } | null;
  const name = body?.name?.trim();
  if (!name || name.length > 80) {
    return NextResponse.json({ error: "Team name must be between 1 and 80 characters" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: team, error } = await admin
    .from("teams")
    .insert({ name, created_by: user.id })
    .select("id, name")
    .single();
  if (error || !team) return NextResponse.json({ error: error?.message }, { status: 500 });

  const { error: memberError } = await admin
    .from("team_members")
    .insert({ team_id: team.id, user_id: user.id, role: "owner" });
  if (memberError) {
    await admin.from("teams").delete().eq("id", team.id);
    return NextResponse.json({ error: memberError.message }, { status: 500 });
  }

  const response = NextResponse.json({ team: { ...team, role: "owner" } }, { status: 201 });
  response.cookies.set(ACTIVE_TEAM_COOKIE, team.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return response;
}
