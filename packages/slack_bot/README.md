# @screeem/slack-bot

A Slack bot that monitors channels for social media links and tracks them for amplification purposes. When someone shares a post to be liked/shared, the bot records it in a local SQLite database and provides commands to query the data.

## Supported Platforms

- Twitter / X
- LinkedIn
- Instagram
- Facebook
- YouTube
- TikTok
- Threads
- Bluesky
- Mastodon
- Reddit

## Setup

### 1. Create a Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps) and click **Create New App** → **From scratch**
2. Enable **Socket Mode** under Settings → Socket Mode. Create an app-level token with `connections:write` scope — this gives you the `xapp-...` token.
3. Under **OAuth & Permissions**, add these Bot Token Scopes:
   - `channels:history` — read messages in public channels
   - `reactions:write` — react to messages
   - `users:read` — look up user names
   - `commands` — register slash commands
   - `chat:write` — send messages
4. Under **Event Subscriptions**, enable events and subscribe to:
   - `message.channels` — messages in public channels
5. (Optional) Under **Slash Commands**, create a command:
   - Command: `/amplify`
   - Description: `Social media amplification tracker`
6. Install the app to your workspace. Copy the **Bot User OAuth Token** (`xoxb-...`).
7. Invite the bot to the channel(s) you want to monitor.

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your tokens and channel IDs. You can find channel IDs by right-clicking a channel in Slack → "View channel details" → the ID is at the bottom.

### 3. Install & Run

```bash
# From the monorepo root
pnpm install
pnpm --filter @screeem/slack-bot build
pnpm --filter @screeem/slack-bot start
```

## Usage

### Automatic Tracking

The bot automatically watches configured channels. When someone posts a message containing a social media link, the bot:

1. Extracts the link(s) and identifies the platform
2. Records the post in the database
3. Reacts with 👀 to confirm tracking

### Slash Commands

| Command | Description |
|---------|-------------|
| `/amplify stats` | Show overall statistics (total posts, breakdown by platform and user) |
| `/amplify recent [count]` | Show recently tracked posts (default 10, max 25) |
| `/amplify platform <name>` | Filter posts by platform (e.g., `twitter`, `linkedin`) |
| `/amplify mine` | Show your own tracked posts |
| `/amplify help` | Show command help |

### REST API

The bot also runs a simple HTTP API (default port 3100):

| Endpoint | Description |
|----------|-------------|
| `GET /api/posts` | List all tracked posts |
| `GET /api/posts?platform=twitter` | Filter by platform |
| `GET /api/posts?user=U01ABCDEF` | Filter by Slack user ID |
| `GET /api/posts?q=searchterm` | Search posts |
| `GET /api/stats` | Get aggregate statistics |
| `GET /api/health` | Health check |

All list endpoints support `limit` (max 200) and `offset` query parameters.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SLACK_BOT_TOKEN` | Yes | Bot User OAuth Token (`xoxb-...`) |
| `SLACK_APP_TOKEN` | Yes | App-Level Token for Socket Mode (`xapp-...`) |
| `SLACK_CHANNEL_IDS` | Yes | Comma-separated channel IDs to watch |
| `API_PORT` | No | REST API port (default: `3100`) |
| `DB_PATH` | No | SQLite database path (default: `./amplification.db`) |
