import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

const MAX_BYTES = 64 * 1024;

function cors(origin: string | null, allowed: string | null): Record<string, string> {
  if (!allowed) return { "Access-Control-Allow-Origin": "*" };
  return origin === allowed ? { "Access-Control-Allow-Origin": allowed, Vary: "Origin" } : {};
}

export async function OPTIONS(request: NextRequest, context: { params: Promise<{ endpointKey: string }> }) {
  const { endpointKey } = await context.params;
  const origin = request.headers.get("origin");
  const admin = createAdminClient();
  const { data } = await admin.from("forms").select("allowed_origin, is_active").eq("endpoint_key", endpointKey).maybeSingle();
  if (!data?.is_active) return new NextResponse(null, { status: 404 });
  if (data.allowed_origin && origin !== data.allowed_origin) return new NextResponse(null, { status: 403 });
  return new NextResponse(null, { status: 204, headers: {
    ...cors(origin, data.allowed_origin), "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400",
  }});
}

export async function POST(request: NextRequest, context: { params: Promise<{ endpointKey: string }> }) {
  const { endpointKey } = await context.params;
  const origin = request.headers.get("origin");
  const length = Number(request.headers.get("content-length"));
  if (length > MAX_BYTES) return NextResponse.json({ error: "Submission is too large" }, { status: 413 });
  const admin = createAdminClient();
  const { data: form } = await admin.from("forms").select("id, allowed_origin, success_url, is_active").eq("endpoint_key", endpointKey).maybeSingle();
  if (!form?.is_active) return NextResponse.json({ error: "Form not found" }, { status: 404 });
  if (form.allowed_origin && origin !== form.allowed_origin) return NextResponse.json({ error: "Origin is not allowed" }, { status: 403 });

  let payload: Record<string, unknown>;
  try {
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const value = await request.json();
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
      payload = value as Record<string, unknown>;
    } else {
      const formData = await request.formData();
      payload = {};
      for (const [key, value] of formData.entries()) {
        const cleanValue = typeof value === "string" ? value : { name: value.name, size: value.size, type: value.type };
        const previous = payload[key];
        payload[key] = previous === undefined ? cleanValue : Array.isArray(previous) ? [...previous, cleanValue] : [previous, cleanValue];
      }
    }
  } catch {
    return NextResponse.json({ error: "Send a JSON object or form fields" }, { status: 400 });
  }
  if (new TextEncoder().encode(JSON.stringify(payload)).byteLength > MAX_BYTES) {
    return NextResponse.json({ error: "Submission is too large" }, { status: 413 });
  }
  const headers = cors(origin, form.allowed_origin);
  if (payload._gotcha) return NextResponse.json({ ok: true }, { status: 202, headers });
  delete payload._gotcha;
  const { error } = await admin.from("form_submissions").insert({
    form_id: form.id, payload, origin, user_agent: request.headers.get("user-agent")?.slice(0, 500),
  });
  if (error) return NextResponse.json({ error: "Could not save submission" }, { status: 500, headers });
  if (form.success_url && !request.headers.get("accept")?.includes("application/json")) return NextResponse.redirect(form.success_url, 303);
  return NextResponse.json({ ok: true }, { status: 201, headers });
}
