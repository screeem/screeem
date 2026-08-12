import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { authenticatePublicApi } from "@/lib/public-api/server";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ formId: string }> }
) {
  const auth = await authenticatePublicApi(request);
  if (auth.error) return auth.error;
  const { formId } = await context.params;
  const limit = Math.min(
    Math.max(Number(request.nextUrl.searchParams.get("limit")) || 50, 1),
    100
  );

  const admin = createAdminClient();
  const { data: form } = await admin
    .from("forms")
    .select("id")
    .eq("id", formId)
    .eq("team_id", auth.teamId)
    .maybeSingle();
  if (!form) return NextResponse.json({ error: "Form not found" }, { status: 404 });

  const { data, error } = await admin
    .from("form_submissions")
    .select("id, payload, origin, user_agent, created_at")
    .eq("team_id", auth.teamId)
    .eq("form_id", formId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data: data ?? [] });
}
