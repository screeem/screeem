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
import { renderTweetHtml, TweetData } from "./renderTweet.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let currentTweet: TweetData | null = null;
let tweetVersion = 0;

const server = new McpServer({
  name: "Tweet Preview",
  version: "0.0.1",
});

const RESOURCE_URI = "ui://tweet-preview/app";

const CreateTweetSchema = {
  displayName: z.string(),
  handle: z.string(),
  text: z.string(),
  avatarUrl: z.string().optional(),
  imageUrl: z.string().optional(),
  verified: z.boolean().optional(),
  timestamp: z.string().optional(),
  likes: z.number().optional(),
  retweets: z.number().optional(),
  replies: z.number().optional(),
  views: z.number().optional(),
};

registerAppTool(
  server,
  "create_or_update_tweet",
  {
    title: "Create or Update Tweet",
    description:
      "Create or update a tweet and preview it inline, rendered exactly like it would appear on Twitter/X. Supports @mentions, #hashtags, and links which are auto-highlighted. Includes a character count indicator (280 limit).",
    inputSchema: CreateTweetSchema,
    _meta: {
      ui: { resourceUri: RESOURCE_URI },
    },
  },
  async (params) => {
    currentTweet = {
      displayName: params.displayName,
      handle: params.handle,
      text: params.text,
      avatarUrl: params.avatarUrl,
      imageUrl: params.imageUrl,
      verified: params.verified,
      timestamp: params.timestamp,
      likes: params.likes,
      retweets: params.retweets,
      replies: params.replies,
      views: params.views,
    };
    tweetVersion++;

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(currentTweet),
        },
      ],
    };
  }
);

// Register the UI resource serving the bundled HTML app
registerAppResource(
  server,
  "Tweet Preview App",
  RESOURCE_URI,
  { description: "Interactive tweet preview card" },
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

server.tool(
  "get_current_tweet",
  "Get the current tweet data as JSON. Useful for reviewing the current state of the tweet before making edits.",
  {},
  async () => {
    if (!currentTweet) {
      return {
        content: [
          {
            type: "text" as const,
            text: "No tweet has been created yet. Use create_or_update_tweet to create one.",
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(currentTweet, null, 2),
        },
      ],
    };
  }
);

server.tool(
  "export_tweet_html",
  "Export the current tweet preview as standalone HTML. Returns the full HTML source that can be saved to a file.",
  {},
  async () => {
    if (!currentTweet) {
      return {
        content: [
          {
            type: "text" as const,
            text: "No tweet has been created yet. Use create_or_update_tweet to create one.",
          },
        ],
      };
    }

    const html = renderTweetHtml(currentTweet);
    return {
      content: [
        {
          type: "text" as const,
          text: html,
        },
      ],
    };
  }
);

server.tool(
  "export_tweet_text",
  "Export the current tweet as plain text, ready to copy-paste into Twitter/X.",
  {},
  async () => {
    if (!currentTweet) {
      return {
        content: [
          {
            type: "text" as const,
            text: "No tweet has been created yet. Use create_or_update_tweet to create one.",
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: currentTweet.text,
        },
      ],
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
