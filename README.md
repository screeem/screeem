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
  billing/          Shared billing service and Stripe adapter
  integrations/     Instagram and TikTok provider adapters
  web/              Next.js app — dashboard, MCP HTTP server, OAuth endpoints
  mcp_post_preview/ Standalone MCP stdio server + Vite-built preview UI
  object-storage/   Tenant-scoped object storage port, policy layer, and adapters
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

## Form automation registrations

Application-owned form actions and event handlers are registered in `packages/web/src/lib/forms/form-registrations.ts`. Routing-only pure functions use the same registry. The visual builder consumes provider-neutral action descriptors such as `crm.upsertLead`, while the host registry binds each capability to its provider implementation.

Build the exported registry with `registerPureFunction`, `registerAction`, and `onEvent`. Registrations are immutable, so chain each call when creating the exported registry. Event handlers choose `inline`, `isolated`, or `durable` delivery.

Forms emit `submission.before_save` and `submission.accepted` whether routing is configured or not. Routing also emits evaluation and matched-route events. Inline handlers can reject before saving, isolated handlers run best-effort after the response, and durable handlers are stored with the submission before they run.

Durable routing actions run in their authored order after the submission and route are stored. Event handlers are independent, so one integration failure does not block unrelated handlers. Each delivery receives a stable `idempotencyKey` and an `AbortSignal`. Pass both to external clients that support request deduplication and cancellation. Failed deliveries are attempted up to three times with delays and remain visible with the submission. `CRON_SECRET` protects the recovery worker at `/api/internal/form-event-deliveries`; the included Vercel schedule is daily and can be supplemented by a more frequent external scheduler.

The delivery store uses `DATABASE_URL` for short server-side transactions. In production, set it to the Supabase transaction-pooler URL. Its migration defines storage, constraints, indexes, and row-level access only; event and action behavior stays in TypeScript. `make test` runs the transaction behavior against local Postgres.

## Object storage

`@screeem/object-storage` holds the storage port: keys are `{ teamId, scope, path }`
rendered as `teams/<teamId>/<scope>/<...>`, each scope declares the content types
and byte ceiling it accepts, and every operation is validated before a backend is
reached. Operations return Effects, so hosts run them the same way they run form
validation.

Screeem's backend binding is `packages/web/src/lib/storage/supabase-object-store.ts`,
selected by `packages/web/src/lib/storage/server.ts`. Outside production, a host
with no Supabase credentials falls back to the in-process adapter and says so, so
the playground and tests need no bucket; in production the missing configuration
is an error instead. `SUPABASE_OBJECT_STORAGE_BUCKET` overrides the `team-objects`
bucket name and `SUPABASE_OBJECT_STORAGE_MAX_BYTES` reports the bucket ceiling on
oversized payloads.

Server-side storage calls use the service role, which bypasses row level security.
The first feature to store objects must therefore take `ObjectKey.teamId` from the
authenticated session's team and never from request input — the key is the only
thing separating teams on that path.

Objects live in the private `team-objects` bucket. Reads are open to team members
and direct writes to managers, enforced on the second path segment by policies in
`supabase/migrations/0023_team_object_storage.sql` and covered by
`supabase/tests/team_object_storage.sql`. Server-side writes go through the
service role, which applies the scope policy first.

Adapters share one behavioural suite from `@screeem/object-storage/testing`. Run
it against local Supabase Storage with `make infra-up` followed by
`pnpm --filter @screeem/web test:object-storage-db`; it is skipped by default.

## Billing

`@screeem/billing` defines the shared Effect billing service and includes a
Stripe adapter. Application code owns plans, configuration, routes, customer
records, and entitlements.

See the [billing package README](packages/billing/README.md) for its API and
adapter contract.

## Social integrations

`@screeem/integrations` contains the Instagram and TikTok OAuth, token,
publishing, and status boundaries. Account connections use encrypted
credentials, team-scoped access, and exact OAuth callback routes.

See the [integrations package README](packages/integrations/README.md) for the
provider contracts and platform approval requirements.

To enable account connections, apply the Supabase migrations and copy
`packages/web/social.env.example` to `packages/web/.env.development.local`.
Register these exact callbacks in the provider apps:

- `${NEXT_PUBLIC_SITE_URL}/api/integrations/instagram/callback`
- `${NEXT_PUBLIC_SITE_URL}/api/integrations/tiktok/callback`

Keep each integration switch disabled until its client credentials, callback,
permissions, credential-encryption key, and TikTok media URL prefix are set.
Owners and admins can then connect one account per provider for the active team
from the Integrations page. A provider account can only be active for one team
at a time. Disconnecting disables Screeem's access immediately and removes its
provider grant when the provider credential is still usable. If provider
cleanup cannot be confirmed, the dashboard tells the owner or admin to remove
Screeem from the account's app permissions. It never deletes or signs out of
the Instagram or TikTok account itself.

## Salesforce integration development

Salesforce is the first adapter on the provider-neutral integration boundary. Configure an External Client App with the callback `${NEXT_PUBLIC_SITE_URL}/api/integrations/salesforce/callback` and the `id`, `api`, and `refresh_token` scopes. For local development, copy the values from `packages/web/salesforce.env.example` into `packages/web/.env.development.local`; `make dev` regenerates `.env.local` but leaves this integration override untouched. Keep `SALESFORCE_INTEGRATION_ENABLED=false` until those values are installed.

Managers start or renew authorization through the team-scoped connect/reconnect endpoints. OAuth state is short-lived, one-time, and bound to the initiating user and team. Access and refresh tokens are AES-GCM encrypted with tenant, connection, and provider identity as authenticated context. Standard tests use the fake client and do not contact Salesforce.

Before enabling Salesforce in production:

- Configure the External Client App with PKCE, refresh-token rotation, and the current Salesforce-required refresh-token idle TTL. The client persists rotated refresh tokens and moves expired or revoked credentials to `reauthorization_required`.
- Enable Salesforce's refresh-token IP allowlist when the app is subject to the partner-app controls. The deployment must then use stable outbound IPs; on Vercel this requires Static IPs or Secure Compute. Add every production egress IP to Salesforce before enabling the integration.
- Configure the app as a confidential server integration and provide `SALESFORCE_CLIENT_SECRET` through the deployment secret manager.
- Create a unique External ID field on Salesforce Lead and set its API name as `SALESFORCE_LEAD_EXTERNAL_ID_FIELD`. The public `crm.upsertLead` action writes the stable durable delivery key to this field so retries target the same record. Its first rollout uses the pre-existing `salesforceUpsertLead` runtime registration so mixed-version workers remain safe, while authors only see the CRM capability name.
- Keep the requested scopes to `id`, `api`, and `refresh_token`, and verify the callback URL exactly matches `NEXT_PUBLIC_SITE_URL`.
- Complete these checks in a Salesforce sandbox before enabling the global integration switch.

`SALESFORCE_LOGIN_URL` currently accepts only `https://login.salesforce.com` and `https://test.salesforce.com`. Salesforce My Domain, Experience Cloud, and custom OAuth origins are not supported; add a separately validated My Domain flow rather than placing an arbitrary host in this setting.

An optional sandbox contract test is available with `pnpm --filter @screeem/web test:salesforce-sandbox`. It requires `SALESFORCE_SANDBOX_CLIENT_ID`, `SALESFORCE_SANDBOX_ACCESS_TOKEN`, `SALESFORCE_SANDBOX_REFRESH_TOKEN`, `SALESFORCE_SANDBOX_INSTANCE_URL`, and `SALESFORCE_SANDBOX_IDENTITY_URL`; `SALESFORCE_SANDBOX_CLIENT_SECRET` is optional. The normal test suite never makes Salesforce requests.
