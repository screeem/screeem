import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canManage, getMembership } from "@/lib/teams/server";
import { normalizeSubmissionSchema } from "@/lib/forms/schema";

function optionalUrl(value: unknown, originOnly = false) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 2048) throw new Error("Invalid URL");
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error("Invalid URL");
  return originOnly ? url.origin : url.toString();
}

async function authorize(teamId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const membership = await getMembership(user.id, teamId);
  if (!membership) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { user, membership };
}

export async function GET(_request: NextRequest, context: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await context.params;
  const auth = await authorize(teamId);
  if (auth.error) return auth.error;
  const admin = createAdminClient();
  const { data, error } = await admin.from("forms")
    .select("id, name, endpoint_key, allowed_origin, success_url, is_active, requires_turnstile, submission_schema, created_at")
    .eq("team_id", teamId).order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ forms: data ?? [] });
}

export async function POST(request: NextRequest, context: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await context.params;
  const auth = await authorize(teamId);
  if (auth.error) return auth.error;
  if (!canManage(auth.membership.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await request.json().catch(() => null) as { name?: string; allowedOrigin?: string; successUrl?: string; requiresTurnstile?: boolean; submissionSchema?: unknown } | null;
  const name = body?.name?.trim();
  if (!name || name.length > 80) return NextResponse.json({ error: "Form name must be between 1 and 80 characters" }, { status: 400 });
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.from("forms").insert({
      team_id: teamId, name, created_by: auth.user.id,
      allowed_origin: optionalUrl(body?.allowedOrigin, true),
      success_url: optionalUrl(body?.successUrl),
      requires_turnstile: body?.requiresTurnstile === true,
      submission_schema: normalizeSubmissionSchema(body?.submissionSchema),
    }).select("id, name, endpoint_key, allowed_origin, success_url, is_active, requires_turnstile, submission_schema, created_at").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ form: data }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid form configuration" },
      { status: 400 }
    );
  }
}
