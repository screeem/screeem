import { App, LogLevel } from "@slack/bolt";
import { getDb } from "./db";
import { registerHandlers } from "./handlers";
import { startApiServer } from "./api";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

async function main(): Promise<void> {
  // Required env vars
  const slackBotToken = requiredEnv("SLACK_BOT_TOKEN");
  const slackAppToken = requiredEnv("SLACK_APP_TOKEN");
  const channelIds = requiredEnv("SLACK_CHANNEL_IDS").split(",").map((s) => s.trim());

  // Optional env vars
  const apiPort = parseInt(process.env.API_PORT || "3100", 10);
  const dbPath = process.env.DB_PATH;

  // Initialize database
  getDb(dbPath);
  console.log("Database initialized");

  // Create Slack app using Socket Mode (no public URL needed)
  const app = new App({
    token: slackBotToken,
    appToken: slackAppToken,
    socketMode: true,
    logLevel: LogLevel.INFO,
  });

  // Register message handlers and slash commands
  registerHandlers(app, channelIds);

  // Start Slack app
  await app.start();
  console.log(`Slack bot is running (watching channels: ${channelIds.join(", ")})`);

  // Start API server
  startApiServer(apiPort);

  // Graceful shutdown
  const shutdown = async () => {
    console.log("Shutting down...");
    await app.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
