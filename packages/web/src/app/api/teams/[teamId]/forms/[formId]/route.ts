import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canManage, getMembership } from "@/lib/teams/server";
import { normalizeSubmissionSchema, type SubmissionSchema } from "@/lib/forms/schema";

async function manager(teamId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const membership = await getMembership(user.id, teamId);
  if (!membership || !canManage(membership.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ teamId: string; formId: string }> }) {
  const { teamId, formId } = await context.params;
  const denied = await manager(teamId); if (denied) return denied;
  const body = await request.json().catch(() => null) as { isActive?: boolean; requiresTurnstile?: boolean; submissionSchema?: unknown } | null;
  const update: { is_active?: boolean; requires_turnstile?: boolean; submission_schema?: SubmissionSchema | null; updated_at: string } = {
    updated_at: new Date().toISOString(),
  };
  if (typeof body?.isActive === "boolean") update.is_active = body.isActive;
  if (typeof body?.requiresTurnstile === "boolean") update.requires_turnstile = body.requiresTurnstile;
  try {
    if (body && Object.prototype.hasOwnProperty.call(body, "submissionSchema")) {
      update.submission_schema = normalizeSubmissionSchema(body.submissionSchema);
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid JSON Schema" }, { status: 400 });
  }
  if (update.is_active === undefined && update.requires_turnstile === undefined && update.submission_schema === undefined) {
    return NextResponse.json({ error: "Provide a form setting to update" }, { status: 400 });
  }
  const admin = createAdminClient();
  const { data, error } = await admin.from("forms").update(update)
    .eq("id", formId).eq("team_id", teamId).select("id, is_active, requires_turnstile, submission_schema").maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Form not found" }, { status: 404 });
  return NextResponse.json({ form: data });
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ teamId: string; formId: string }> }) {
  const { teamId, formId } = await context.params;
  const denied = await manager(teamId); if (denied) return denied;
  const admin = createAdminClient();
  const { error, count } = await admin.from("forms").delete({ count: "exact" }).eq("id", formId).eq("team_id", teamId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!count) return NextResponse.json({ error: "Form not found" }, { status: 404 });
  return new NextResponse(null, { status: 204 });
}
