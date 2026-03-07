"use server";

import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import crypto from "node:crypto";

export async function approveAuthorization(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const userId = formData.get("userId") as string;
  if (user.id !== userId) throw new Error("User mismatch");

  const clientId = formData.get("clientId") as string;
  const redirectUri = formData.get("redirectUri") as string;
  const state = formData.get("state") as string;
  const codeChallenge = formData.get("codeChallenge") as string;

  const admin = createAdminClient();

  const { data: client } = await admin
    .from("oauth_clients")
    .select("redirect_uris")
    .eq("client_id", clientId)
    .single();

  if (!client || !client.redirect_uris.includes(redirectUri)) {
    throw new Error("Invalid client or redirect_uri");
  }

  const code = crypto.randomBytes(32).toString("base64url");

  const { error } = await admin.from("oauth_auth_codes").insert({
    code,
    user_id: userId,
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: codeChallenge,
  });

  if (error) throw new Error("Failed to create authorization code");

  const url = new URL(redirectUri);
  url.searchParams.set("code", code);
  if (state) url.searchParams.set("state", state);

  redirect(url.toString());
}

export async function denyAuthorization(formData: FormData) {
  const redirectUri = formData.get("redirectUri") as string;
  const state = formData.get("state") as string;

  const url = new URL(redirectUri);
  url.searchParams.set("error", "access_denied");
  if (state) url.searchParams.set("state", state);

  redirect(url.toString());
}
