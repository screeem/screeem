import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ACTIVE_TEAM_COOKIE, getMembership } from "@/lib/teams/server";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null) as { teamId?: string } | null;
  if (!body?.teamId || !(await getMembership(user.id, body.teamId))) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set(ACTIVE_TEAM_COOKIE, body.teamId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return response;
}
