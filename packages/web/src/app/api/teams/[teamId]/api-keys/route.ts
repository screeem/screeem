import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canManage, getMembership } from "@/lib/teams/server";
import { generatePublicApiKey } from "@/lib/public-api/server";

async function authorizeManager(teamId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const membership = await getMembership(user.id, teamId);
  if (!membership || !canManage(membership.role)) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { user };
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ teamId: string }> }
) {
  const { teamId } = await context.params;
  const auth = await authorizeManager(teamId);
  if (auth.error) return auth.error;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("public_api_keys")
    .select("id, name, key_prefix, created_at, last_used_at")
    .eq("team_id", teamId)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ keys: data ?? [] });
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ teamId: string }> }
) {
  const { teamId } = await context.params;
  const auth = await authorizeManager(teamId);
  if (auth.error) return auth.error;

  const body = await request.json().catch(() => null) as { name?: string } | null;
  const name = body?.name?.trim();
  if (!name || name.length > 80) {
    return NextResponse.json(
      { error: "Key name must be between 1 and 80 characters" },
      { status: 400 }
    );
  }

  const generated = generatePublicApiKey();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("public_api_keys")
    .insert({
      team_id: teamId,
      name,
      key_prefix: generated.keyPrefix,
      key_hash: generated.keyHash,
      created_by: auth.user.id,
    })
    .select("id, name, key_prefix, created_at, last_used_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ key: data, secret: generated.key }, { status: 201 });
}
