import type { App, SlackEventMiddlewareArgs } from "@slack/bolt";
import { parseLinks, stripUrls } from "./parser";
import { insertPost, getPostByMessageTs, getAllPosts, getStats, getPostsByPlatform, getPostsByUser } from "./db";

export function registerHandlers(app: App, channelIds: string[]): void {
  const watchedChannels = new Set(channelIds);

  // Listen for messages in watched channels
  app.message(async ({ message, client }) => {
    // Only handle standard messages (not bot messages, edits, etc.)
    if (message.subtype !== undefined) return;
    if (!("text" in message) || !message.text) return;
    if (!("user" in message) || !message.user) return;
    if (!watchedChannels.has(message.channel)) return;

    const links = parseLinks(message.text);
    if (links.length === 0) return;

    // Check if we already recorded this message
    if (getPostByMessageTs(message.ts)) return;

    // Look up the user's display name
    let userName = "";
    try {
      const userInfo = await client.users.info({ user: message.user });
      userName =
        userInfo.user?.profile?.display_name ||
        userInfo.user?.profile?.real_name ||
        userInfo.user?.name ||
        "";
    } catch {
      // If we can't look up the user, continue without the name
    }

    const postText = stripUrls(message.text);

    for (const link of links) {
      try {
        insertPost({
          platform: link.platform,
          url: link.url,
          author_name: link.author,
          post_text: postText,
          slack_user_id: message.user,
          slack_user_name: userName,
          slack_channel_id: message.channel,
          slack_message_ts: `${message.ts}-${link.url}`,
        });
      } catch (err) {
        // Duplicate message_ts — already tracked, skip
        if (err instanceof Error && err.message.includes("UNIQUE constraint")) {
          continue;
        }
        console.error("Failed to insert post:", err);
      }
    }

    // React with an emoji to confirm we tracked it
    try {
      await client.reactions.add({
        channel: message.channel,
        timestamp: message.ts,
        name: "eyes",
      });
    } catch {
      // Reaction may already exist or bot may lack permission
    }
  });

  // Slash command: /amplify stats
  app.command("/amplify", async ({ command, ack, respond }) => {
    await ack();

    const args = command.text.trim().split(/\s+/);
    const subcommand = args[0]?.toLowerCase() || "help";

    switch (subcommand) {
      case "stats": {
        const stats = getStats();
        const platformLines = Object.entries(stats.by_platform)
          .map(([p, c]) => `  • ${p}: ${c}`)
          .join("\n");
        const userLines = Object.entries(stats.by_user)
          .slice(0, 10)
          .map(([u, c]) => `  • ${u}: ${c}`)
          .join("\n");

        await respond({
          response_type: "ephemeral",
          text: [
            `*Amplification Stats*`,
            `Total tracked posts: *${stats.total_posts}*`,
            ``,
            `*By platform:*`,
            platformLines || "  (none yet)",
            ``,
            `*Top contributors:*`,
            userLines || "  (none yet)",
          ].join("\n"),
        });
        break;
      }

      case "recent": {
        const limit = parseInt(args[1] || "10", 10);
        const posts = getAllPosts(Math.min(limit, 25));
        if (posts.length === 0) {
          await respond({ response_type: "ephemeral", text: "No tracked posts yet." });
          break;
        }
        const lines = posts.map(
          (p) => `• [${p.platform}] <${p.url}> — shared by ${p.slack_user_name || p.slack_user_id} (${p.created_at})`
        );
        await respond({
          response_type: "ephemeral",
          text: `*Recent tracked posts:*\n${lines.join("\n")}`,
        });
        break;
      }

      case "platform": {
        const platform = args[1]?.toLowerCase();
        if (!platform) {
          await respond({ response_type: "ephemeral", text: "Usage: `/amplify platform <name>`" });
          break;
        }
        const posts = getPostsByPlatform(platform, 15);
        if (posts.length === 0) {
          await respond({ response_type: "ephemeral", text: `No tracked posts for platform: ${platform}` });
          break;
        }
        const lines = posts.map(
          (p) => `• <${p.url}> — ${p.slack_user_name || p.slack_user_id} (${p.created_at})`
        );
        await respond({
          response_type: "ephemeral",
          text: `*Posts from ${platform}:*\n${lines.join("\n")}`,
        });
        break;
      }

      case "mine": {
        const posts = getPostsByUser(command.user_id, 15);
        if (posts.length === 0) {
          await respond({ response_type: "ephemeral", text: "You haven't shared any tracked posts yet." });
          break;
        }
        const lines = posts.map(
          (p) => `• [${p.platform}] <${p.url}> (${p.created_at})`
        );
        await respond({
          response_type: "ephemeral",
          text: `*Your tracked posts:*\n${lines.join("\n")}`,
        });
        break;
      }

      case "help":
      default: {
        await respond({
          response_type: "ephemeral",
          text: [
            "*Amplification Tracker Commands:*",
            "• `/amplify stats` — Show overall statistics",
            "• `/amplify recent [count]` — Show recently tracked posts",
            "• `/amplify platform <name>` — Filter by platform (twitter, linkedin, etc.)",
            "• `/amplify mine` — Show your tracked posts",
            "• `/amplify help` — Show this help message",
          ].join("\n"),
        });
        break;
      }
    }
  });
}
