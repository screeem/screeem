#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v3";
import http from "node:http";
import { renderPostHtml, PostData } from "./renderPost.js";

const DEFAULT_PORT = 3456;

let currentPost: PostData | null = null;
let postVersion = 0;
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
        res.end(JSON.stringify({ version: postVersion }));
        return;
      }

      if (!currentPost) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`<!DOCTYPE html>
<html><head><title>Post Preview</title>
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
<body class="min-h-screen bg-gray-50 flex items-center justify-center">
  <div class="text-center">
    <h1 class="text-2xl font-bold text-gray-400 mb-2">Waiting for post...</h1>
    <p class="text-gray-500">Use the <code class="bg-gray-100 px-2 py-1 rounded">create_or_update_post</code> tool in Claude to get started.</p>
  </div>
</body></html>`);
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(renderPostHtml(currentPost));
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
  name: "Post Preview",
  version: "0.0.1",
});

const CreatePostSchema = {
  title: z.string(),
  content: z.string(),
  author: z.string(),
  date: z.string().optional(),
  tags: z.array(z.string()).optional(),
  slug: z.string().optional(),
  excerpt: z.string().optional(),
};

server.tool(
  "create_or_update_post",
  "Create or update a blog post and preview it in the browser. Supports markdown content. The preview auto-refreshes in the browser whenever the post is updated.",
  CreatePostSchema,
  async (params) => {
    currentPost = {
      title: params.title,
      content: params.content,
      author: params.author,
      date:
        params.date ||
        new Date().toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric",
        }),
      tags: params.tags,
      slug: params.slug,
      excerpt: params.excerpt,
    };
    postVersion++;

    const port = await startPreviewServer(DEFAULT_PORT);

    return {
      content: [
        {
          type: "text" as const,
          text: `Post "${params.title}" has been ${postVersion === 1 ? "created" : "updated"} (version ${postVersion}).\n\nPreview is live at: http://localhost:${port}\n\nThe browser will auto-refresh when you make changes. Use this tool again to update the post content.`,
        },
      ],
    };
  }
);

server.tool(
  "get_current_post",
  "Get the current post data as JSON. Useful for reviewing the current state of the post before making edits.",
  {},
  async () => {
    if (!currentPost) {
      return {
        content: [
          {
            type: "text" as const,
            text: "No post has been created yet. Use create_or_update_post to create one.",
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(currentPost, null, 2),
        },
      ],
    };
  }
);

server.tool(
  "export_post_html",
  "Export the current post as standalone HTML. Returns the full HTML source that can be saved to a file.",
  {},
  async () => {
    if (!currentPost) {
      return {
        content: [
          {
            type: "text" as const,
            text: "No post has been created yet. Use create_or_update_post to create one.",
          },
        ],
      };
    }

    const html = renderPostHtml(currentPost);
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
  "export_post_markdown",
  "Export the current post as markdown with front matter. Returns markdown that can be saved directly as a blog post file.",
  {},
  async () => {
    if (!currentPost) {
      return {
        content: [
          {
            type: "text" as const,
            text: "No post has been created yet. Use create_or_update_post to create one.",
          },
        ],
      };
    }

    const frontMatter = [
      "---",
      `title: "${currentPost.title}"`,
      `author: "${currentPost.author}"`,
      `date: "${currentPost.date}"`,
    ];

    if (currentPost.slug) {
      frontMatter.push(`slug: "${currentPost.slug}"`);
    }
    if (currentPost.excerpt) {
      frontMatter.push(`excerpt: "${currentPost.excerpt}"`);
    }
    if (currentPost.tags && currentPost.tags.length > 0) {
      frontMatter.push(`tags:`);
      for (const tag of currentPost.tags) {
        frontMatter.push(`  - "${tag}"`);
      }
    }
    frontMatter.push("---");

    const markdown = `${frontMatter.join("\n")}\n\n${currentPost.content}`;

    return {
      content: [
        {
          type: "text" as const,
          text: markdown,
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
