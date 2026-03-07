import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import crypto from "node:crypto";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(request: NextRequest) {
  let body: { client_name?: string; redirect_uris?: string[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "invalid_request", error_description: "Invalid JSON body" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const { client_name, redirect_uris } = body;

  if (
    !Array.isArray(redirect_uris) ||
    redirect_uris.length === 0 ||
    redirect_uris.some((u) => typeof u !== "string")
  ) {
    return NextResponse.json(
      {
        error: "invalid_client_metadata",
        error_description: "redirect_uris must be a non-empty array of strings",
      },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  // Validate all redirect URIs are HTTPS or localhost
  for (const uri of redirect_uris) {
    try {
      const url = new URL(uri);
      if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
        throw new Error();
      }
    } catch {
      return NextResponse.json(
        {
          error: "invalid_client_metadata",
          error_description: `Invalid redirect_uri: ${uri}`,
        },
        { status: 400, headers: CORS_HEADERS }
      );
    }
  }

  const clientId = crypto.randomUUID();
  const admin = createAdminClient();

  const { error } = await admin.from("oauth_clients").insert({
    client_id: clientId,
    client_name: client_name ?? null,
    redirect_uris,
  });

  if (error) {
    return NextResponse.json(
      { error: "server_error", error_description: error.message },
      { status: 500, headers: CORS_HEADERS }
    );
  }

  return NextResponse.json(
    {
      client_id: clientId,
      client_name: client_name ?? null,
      redirect_uris,
    },
    { status: 201, headers: CORS_HEADERS }
  );
}
