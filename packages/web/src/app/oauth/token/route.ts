import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import crypto from "node:crypto";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store",
  Pragma: "no-cache",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

function verifyPkce(codeVerifier: string, codeChallenge: string): boolean {
  const hash = crypto
    .createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");
  return hash === codeChallenge;
}

function error(status: number, code: string, description: string) {
  return NextResponse.json(
    { error: code, error_description: description },
    { status, headers: CORS_HEADERS }
  );
}

export async function POST(request: NextRequest) {
  let body: Record<string, string>;
  try {
    const ct = request.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      body = await request.json();
    } else {
      const form = await request.formData();
      body = Object.fromEntries(
        [...form.entries()].map(([k, v]) => [k, v.toString()])
      );
    }
  } catch {
    return error(400, "invalid_request", "Could not parse request body");
  }

  const { grant_type, code, redirect_uri, client_id, code_verifier } = body;

  if (grant_type !== "authorization_code") {
    return error(400, "unsupported_grant_type", "Only authorization_code is supported");
  }

  if (!code || !redirect_uri || !client_id || !code_verifier) {
    return error(400, "invalid_request", "Missing required parameters");
  }

  const admin = createAdminClient();

  // Atomically consume the auth code (single-use: delete and return in one step)
  const { data: authCode } = await admin
    .from("oauth_auth_codes")
    .delete()
    .eq("code", code)
    .select("user_id, client_id, redirect_uri, code_challenge, expires_at")
    .single();

  if (!authCode) {
    return error(400, "invalid_grant", "Authorization code not found or already used");
  }

  if (new Date(authCode.expires_at) < new Date()) {
    return error(400, "invalid_grant", "Authorization code has expired");
  }

  if (authCode.client_id !== client_id) {
    return error(400, "invalid_grant", "client_id mismatch");
  }

  if (authCode.redirect_uri !== redirect_uri) {
    return error(400, "invalid_grant", "redirect_uri mismatch");
  }

  if (!verifyPkce(code_verifier, authCode.code_challenge)) {
    return error(400, "invalid_grant", "PKCE verification failed");
  }

  // Get or create the user's API key — that becomes the access token
  const { data: existing } = await admin
    .from("api_keys")
    .select("key")
    .eq("user_id", authCode.user_id)
    .limit(1)
    .single();

  let accessToken: string;
  if (existing) {
    accessToken = existing.key;
  } else {
    const newKey = crypto.randomUUID();
    const { error: insertError } = await admin
      .from("api_keys")
      .insert({ user_id: authCode.user_id, key: newKey });
    if (insertError) {
      console.error("Failed to insert API key for user", authCode.user_id, insertError);
      return error(500, "server_error", "Could not create access token");
    }
    accessToken = newKey;
  }

  return NextResponse.json(
    {
      access_token: accessToken,
      token_type: "Bearer",
    },
    { headers: CORS_HEADERS }
  );
}
