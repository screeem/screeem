import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { authenticatePublicApi } from "@/lib/public-api/server";

export async function GET(request: NextRequest) {
  const auth = await authenticatePublicApi(request);
  if (auth.error) return auth.error;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("forms")
    .select("id, name, endpoint_key, allowed_origin, success_url, is_active, created_at, updated_at")
    .eq("team_id", auth.teamId)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data: data ?? [] });
}
