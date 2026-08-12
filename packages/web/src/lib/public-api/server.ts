import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

const KEY_PREFIX = "screeem_public_";

export function hashPublicApiKey(key: string) {
  return createHash("sha256").update(key).digest("hex");
}

export function generatePublicApiKey() {
  const key = `${KEY_PREFIX}${randomBytes(24).toString("base64url")}`;
  return {
    key,
    keyHash: hashPublicApiKey(key),
    keyPrefix: `${key.slice(0, KEY_PREFIX.length + 8)}…`,
  };
}

export async function authenticatePublicApi(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  const key = authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : "";

  if (!key.startsWith(KEY_PREFIX)) {
    return {
      error: NextResponse.json(
        { error: "A valid public API key is required" },
        { status: 401, headers: { "WWW-Authenticate": "Bearer" } }
      ),
    };
  }

  const admin = createAdminClient();
  const { data } = await admin
    .from("public_api_keys")
    .select("id, team_id")
    .eq("key_hash", hashPublicApiKey(key))
    .maybeSingle();

  if (!data) {
    return {
      error: NextResponse.json(
        { error: "Invalid public API key" },
        { status: 401, headers: { "WWW-Authenticate": "Bearer" } }
      ),
    };
  }

  await admin
    .from("public_api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id);

  return { keyId: data.id as string, teamId: data.team_id as string };
}
