import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import fs from "node:fs/promises";
import path from "node:path";

const RESOURCE_URI = "ui://tweet-preview/app";
const RESOURCE_MIME_TYPE = "text/html;profile=mcp-app";

const TOOL_DEFINITION = {
  name: "create_or_update_post",
  description:
    "Create or update a social media post and preview it. Supports Twitter/X and LinkedIn. Supports @mentions, #hashtags, and links which are auto-highlighted. Includes a character count indicator.",
  inputSchema: {
    type: "object",
    properties: {
      platform: {
        type: "string",
        enum: ["twitter", "linkedin"],
        description: "The social media platform",
      },
      text: {
        type: "string",
        description: "The post content",
      },
    },
    required: ["platform", "text"],
  },
  _meta: {
    "ui/resourceUri": RESOURCE_URI,
  },
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

type SocialAccount = {
  id: string;
  platform: string;
  handle: string;
  label: string | null;
};

async function resolveApiKey(
  request: NextRequest
): Promise<{ userId: string; accounts: SocialAccount[] } | null> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const token = authHeader.slice(7);
  const admin = createAdminClient();

  const { data: apiKey } = await admin
    .from("api_keys")
    .select("user_id")
    .eq("key", token)
    .single();

  if (!apiKey) return null;

  const { data: accounts } = await admin
    .from("social_accounts")
    .select("id, platform, handle, label")
    .eq("user_id", apiKey.user_id)
    .order("created_at", { ascending: true });

  return {
    userId: apiKey.user_id,
    accounts: accounts ?? [],
  };
}

async function fetchAvatarDataUrl(handle: string): Promise<string | undefined> {
  try {
    const res = await fetch(`https://unavatar.io/twitter/${handle}`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return undefined;
    const buffer = await res.arrayBuffer();
    const contentType = res.headers.get("content-type") ?? "image/jpeg";
    const base64 = Buffer.from(buffer).toString("base64");
    return `data:${contentType};base64,${base64}`;
  } catch {
    return undefined;
  }
}

function jsonRpcError(id: unknown, code: number, message: string) {
  return NextResponse.json(
    { jsonrpc: "2.0", id, error: { code, message } },
    { headers: CORS_HEADERS }
  );
}

function jsonRpcResult(id: unknown, result: unknown) {
  return NextResponse.json(
    { jsonrpc: "2.0", id, result },
    { headers: CORS_HEADERS }
  );
}

export async function POST(request: NextRequest) {
  let body: { jsonrpc: string; id?: unknown; method: string; params?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonRpcError(null, -32700, "Parse error");
  }

  const { id, method } = body;

  if (method === "initialize") {
    return jsonRpcResult(id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {}, resources: {} },
      serverInfo: { name: "screeem-post-preview", version: "0.1.0" },
    });
  }

  if (method === "resources/list") {
    return jsonRpcResult(id, {
      resources: [
        {
          uri: RESOURCE_URI,
          name: "Post Preview App",
          mimeType: RESOURCE_MIME_TYPE,
        },
      ],
    });
  }

  if (method === "resources/read") {
    const html = await fs.readFile(
      path.join(process.cwd(), "public", "mcp-app.html"),
      "utf-8"
    );
    return jsonRpcResult(id, {
      contents: [{ uri: RESOURCE_URI, mimeType: RESOURCE_MIME_TYPE, text: html }],
    });
  }

  if (method === "notifications/initialized") {
    return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
  }

  if (method === "tools/list") {
    return jsonRpcResult(id, { tools: [TOOL_DEFINITION] });
  }

  if (method === "tools/call") {
    const user = await resolveApiKey(request);
    if (!user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401, headers: CORS_HEADERS }
      );
    }

    const params = body.params as {
      name: string;
      arguments: { platform: "twitter" | "linkedin"; text: string };
    };

    if (params.name !== "create_or_update_post") {
      return jsonRpcError(id, -32601, `Unknown tool: ${params.name}`);
    }

    const { platform, text } = params.arguments;
    const platformAccounts = user.accounts.filter((a) => a.platform === platform);

    if (platform === "linkedin") {
      const variants = await Promise.all(
        platformAccounts.map(async (account) => ({
          _type: "linkedin",
          text,
          authorName: account.handle,
          accountLabel: account.label ?? undefined,
          accountId: account.id,
        }))
      );

      const responseData = {
        _type: "linkedin",
        text,
        accounts: variants.length > 0 ? variants : [{ _type: "linkedin", text }],
      };

      return jsonRpcResult(id, {
        content: [{ type: "text", text: JSON.stringify(responseData) }],
      });
    } else {
      const variants = await Promise.all(
        platformAccounts.map(async (account) => {
          const avatarUrl = await fetchAvatarDataUrl(account.handle);
          return {
            text,
            handle: account.handle,
            displayName: account.handle,
            avatarUrl,
            accountLabel: account.label ?? undefined,
            accountId: account.id,
            likes: 42,
            retweets: 7,
            replies: 3,
            views: 1337,
          };
        })
      );

      const responseData = {
        text,
        accounts: variants.length > 0 ? variants : [{
          text,
          likes: 42,
          retweets: 7,
          replies: 3,
          views: 1337,
        }],
      };

      return jsonRpcResult(id, {
        content: [{ type: "text", text: JSON.stringify(responseData) }],
      });
    }
  }

  return jsonRpcError(id, -32601, `Method not found: ${method}`);
}
