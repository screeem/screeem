import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveTeam } from "@/lib/teams/server";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { activeTeam } = await getActiveTeam(user.id, user.email);
  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("api_keys")
    .select("key")
    .eq("team_id", activeTeam.id)
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (existing) {
    return NextResponse.json({ key: existing.key });
  }

  // Auto-generate one
  const newKey = crypto.randomUUID();
  const { data: created, error } = await admin
    .from("api_keys")
    .insert({ user_id: user.id, team_id: activeTeam.id, key: newKey })
    .select("key")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ key: created.key });
}

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { activeTeam } = await getActiveTeam(user.id, user.email);
  const admin = createAdminClient();
  await admin.from("api_keys").delete().eq("team_id", activeTeam.id).eq("user_id", user.id);

  // Insert new key
  const newKey = crypto.randomUUID();
  const { data, error } = await admin
    .from("api_keys")
    .insert({ user_id: user.id, team_id: activeTeam.id, key: newKey })
    .select("key")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ key: data.key });
}
