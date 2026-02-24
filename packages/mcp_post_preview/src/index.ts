#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  registerAppTool,
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod/v3";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const server = new McpServer({
  name: "Post Preview",
  version: "0.0.1",
});

const RESOURCE_URI = "ui://tweet-preview/app";

registerAppTool(
  server,
  "create_or_update_post",
  {
    title: "Create or Update Post",
    description:
      "Create or update a social media post and preview it inline. Supports Twitter/X and LinkedIn. Supports @mentions, #hashtags, and links which are auto-highlighted. Includes a character count indicator.",
    inputSchema: {
      platform: z.enum(["twitter", "linkedin"]),
      text: z.string(),
    },
    _meta: {
      ui: { resourceUri: RESOURCE_URI },
    },
  },
  async (params) => {
    const responseData =
      params.platform === "linkedin"
        ? { _type: "linkedin", text: params.text }
        : { text: params.text };

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(responseData),
        },
      ],
    };
  }
);

// Register the UI resource serving the bundled HTML app
registerAppResource(
  server,
  "Post Preview App",
  RESOURCE_URI,
  { description: "Interactive social media post preview card" },
  async () => ({
    contents: [
      {
        uri: RESOURCE_URI,
        mimeType: RESOURCE_MIME_TYPE,
        text: await fs.readFile(path.join(__dirname, "index.html"), "utf-8"),
      },
    ],
  })
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
