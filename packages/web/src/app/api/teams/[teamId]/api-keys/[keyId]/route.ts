import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canManage, getMembership } from "@/lib/teams/server";

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ teamId: string; keyId: string }> }
) {
  const { teamId, keyId } = await context.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const membership = await getMembership(user.id, teamId);
  if (!membership || !canManage(membership.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();
  const { error, count } = await admin
    .from("public_api_keys")
    .delete({ count: "exact" })
    .eq("id", keyId)
    .eq("team_id", teamId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!count) return NextResponse.json({ error: "API key not found" }, { status: 404 });
  return new NextResponse(null, { status: 204 });
}
