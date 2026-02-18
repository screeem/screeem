#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v3";
import http from "node:http";
import { renderTweetHtml, TweetData } from "./renderTweet.js";

const DEFAULT_PORT = 3456;

let currentTweet: TweetData | null = null;
let tweetVersion = 0;
let previewServer: http.Server | null = null;
let serverPort: number | null = null;

function startPreviewServer(port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    if (previewServer) {
      resolve(serverPort!);
      return;
    }

    previewServer = http.createServer((req, res) => {
      if (req.url === "/api/version") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ version: tweetVersion }));
        return;
      }

      if (!currentTweet) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`<!DOCTYPE html>
<html><head><title>Tweet Preview</title>
<script src="https://cdn.tailwindcss.com"></script>
<script>
  setInterval(async () => {
    try {
      const res = await fetch('/api/version');
      const data = await res.json();
      if (data.version > 0) window.location.reload();
    } catch(e) {}
  }, 2000);
</script>
</head>
<body class="min-h-screen bg-gray-100 flex items-center justify-center">
  <div class="text-center">
    <h1 class="text-2xl font-bold text-gray-400 mb-2">Waiting for tweet...</h1>
    <p class="text-gray-500">Use the <code class="bg-gray-100 px-2 py-1 rounded">create_or_update_tweet</code> tool in Claude to get started.</p>
  </div>
</body></html>`);
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(renderTweetHtml(currentTweet));
    });

    previewServer.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        previewServer = null;
        startPreviewServer(port + 1).then(resolve).catch(reject);
      } else {
        reject(err);
      }
    });

    previewServer.listen(port, () => {
      serverPort = port;
      resolve(port);
    });
  });
}

const server = new McpServer({
  name: "Tweet Preview",
  version: "0.0.1",
});

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

server.tool(
  "create_or_update_tweet",
  "Create or update a tweet and preview it in the browser, rendered exactly like it would appear on Twitter/X. Supports @mentions, #hashtags, and links which are auto-highlighted. The preview auto-refreshes when the tweet is updated so you can iterate on it live. Includes a character count indicator (280 limit) and a light/dark theme toggle.",
  CreateTweetSchema,
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

    const port = await startPreviewServer(DEFAULT_PORT);
    const charCount = params.text.length;
    const overLimit = charCount > 280;

    return {
      content: [
        {
          type: "text" as const,
          text: `Tweet by @${params.handle} has been ${tweetVersion === 1 ? "created" : "updated"} (version ${tweetVersion}).\n\nCharacter count: ${charCount}/280${overLimit ? " — OVER LIMIT!" : ""}\n\nPreview is live at: http://localhost:${port}\n\nThe browser will auto-refresh when you make changes. Use this tool again to update the tweet.`,
        },
      ],
    };
  }
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
