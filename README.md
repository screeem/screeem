# Screeem

Draft and preview social media posts directly inside Claude.

Screeem is an MCP server that gives Claude a `create_or_update_post` tool. When you ask Claude to write a tweet or LinkedIn post, it renders a live, pixel-accurate preview card — with your avatar, handle, character count, and engagement metrics — right in the conversation. Edit the copy by talking to Claude; the preview updates instantly.

## Features

- **Live post preview** — Twitter/X and LinkedIn cards rendered inline in Claude
- **Your avatar & handle** — pulls your profile from the account you connect
- **Character count indicator** — visual progress ring, turns red when over the limit
- **Copy button** — copy the final post text to your clipboard with one click
- **Team workspaces** — share social accounts with teammates using owner, admin, and member roles
- **Team-aware access** — each member gets a revocable MCP key for the workspace they select
- **Works in Claude.ai and Claude Desktop**

## Getting Started

### Claude.ai (custom connector)

1. Sign up at [screeem.app](https://screeem.app), choose or create a team, and add its Twitter/LinkedIn handles in the dashboard.
2. In Claude.ai go to **Settings → Customize → Connectors** and click **+**.
3. Enter the name `Screeem` and the connector URL shown in your dashboard.
4. Click **Save** — Claude will redirect you to sign in and authorize access.
5. Ask Claude to draft a post: *"Write me a tweet about shipping a new feature."*

### Claude Desktop

1. Sign up and grab your API key from the dashboard.
2. Add the following to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "screeem": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://screeem.app/api/mcp",
        "--header",
        "Authorization: Bearer <your-api-key>"
      ]
    }
  }
}
```

3. Restart Claude Desktop and start a new conversation.

## Monorepo Structure

```
packages/
  web/              Next.js app — dashboard, MCP HTTP server, OAuth endpoints
  mcp_post_preview/ Standalone MCP stdio server + Vite-built preview UI
  blog_components/  Shared blog UI components
  sample_blog/      Example blog built with blog_components
  shared/           Shared types and utilities
supabase/
  migrations/       Database schema
```

## Tech Stack

- **Next.js** (App Router) — web app and MCP HTTP server
- **Supabase** — auth (magic link), database, row-level security
- **Model Context Protocol** — MCP SDK for tool and resource registration
- **Vite + vite-plugin-singlefile** — bundles the preview UI into a single inline HTML file
- **Drizzle** — database schema management
## Local Docker stack

The local stack runs the production Next.js image against Supabase's Dockerized PostgreSQL, Auth, and REST services. Docker host networking is used so the browser and server resolve the same local Supabase URL; this workflow currently targets Linux.

Start the migrated database and web app:

```bash
pnpm docker:up
```

Open `http://localhost:3000`. Supabase Studio remains available at `http://localhost:54323`.

Reset the database, apply every migration, run the pgTAP database tests, and run the web TypeScript/Vitest suite inside the test image:

```bash
pnpm docker:test
```

Stop the app and local Supabase containers:

```bash
pnpm docker:down
```
