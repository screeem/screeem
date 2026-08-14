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

## Local development

Docker provides PostgreSQL, Auth, REST, Studio, Mailpit, and the other local Supabase services. The Next.js development server runs on the host so the same commands work on macOS and Linux and development-only pages remain available.

The first setup needs internet access to download locked pnpm packages and Docker images:

```bash
make setup
```

After that, the package store and images are cached locally. Check that the machine is ready for disconnected work with:

```bash
make offline-check
```

Run only the visual form and routing playground when you do not need accounts or persistence:

```bash
make playground
```

Open [http://localhost:3000/_dev/form-builder](http://localhost:3000/_dev/form-builder). This route exists only in the development server. Use the Build and Routing tabs to add fields, drag fields and rules into a new order, test sample submissions, and inspect the generated JSON.

Run the full local application with Dockerized dependencies:

```bash
make dev
```

The app is at `http://localhost:3000`, the playground uses the URL above, and Supabase Studio is at `http://127.0.0.1:54323`. Local Supabase credentials are generated into the ignored `packages/web/.env.local` file.

Useful commands:

```bash
make help          # show every target
make infra-status  # show local service URLs
make db-reset      # replace local data with current migrations and seed data
make test          # run forms, web, and database tests
make infra-down    # stop local Supabase; downloaded images remain cached
```

`make docker-build`, `make docker-up`, and `make docker-test` retain the production-image workflow. The production image intentionally excludes `/_dev`, so use `make playground` for visual review.

## Routing host registrations

Application-owned routing functions, actions, and lifecycle handlers are registered in `packages/web/src/lib/forms/routing-registrations.ts`. Form authors use the registered names; they do not need the implementation details.

Build the exported registry with `registerPureFunction`, `registerAction`, `onBeforeEvaluation`, and `onAfterEvaluation`. Registrations are immutable, so chain each call when creating the exported registry.

Actions run in their configured order after the submission and route are stored. Each action receives a stable `idempotencyKey` and an `AbortSignal`. Pass both to external clients that support request deduplication and cancellation. Failed actions retry three times with delays and remain visible with the submission. `CRON_SECRET` protects the recovery worker at `/api/internal/form-routing-actions`; the included Vercel schedule is daily and can be supplemented by a more frequent external scheduler.

The action store uses `DATABASE_URL` for short server-side transactions. In production, set it to the Supabase transaction-pooler URL. Its migration defines storage, constraints, indexes, and row-level access only; routing and action behavior stays in TypeScript. `make test` runs the transaction behavior against local Postgres.
