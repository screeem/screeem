#!/usr/bin/env npx tsx
/**
 * End-to-end test harness for the MCP post-preview server.
 *
 * Spawns the built server as a child process, connects via stdio,
 * and exercises every tool + the UI resource.
 *
 * Usage:
 *   npm run build && npx tsx test-e2e.ts
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

function assertIncludes(haystack: string, needle: string, message: string) {
  assert(haystack.includes(needle), message);
}

function getTextContent(result: { content: Array<{ type: string; text?: string }> }): string {
  const item = result.content.find((c) => c.type === "text") as { text: string } | undefined;
  return item?.text ?? "";
}

async function main() {
  console.log("\n🧪 MCP Post-Preview Server — E2E Tests\n");

  // --- Connect ---
  console.log("Connecting to server...");
  const transport = new StdioClientTransport({
    command: "node",
    args: [path.join(__dirname, "dist", "index.js")],
    cwd: __dirname,
    stderr: "pipe",
  });

  const client = new Client(
    { name: "test-harness", version: "1.0.0" },
    { capabilities: {} }
  );

  await client.connect(transport);
  console.log("Connected.\n");

  // --- List tools ---
  console.log("1. List tools");
  const { tools } = await client.listTools();
  const toolNames = tools.map((t) => t.name);
  assert(toolNames.includes("create_or_update_tweet"), "create_or_update_tweet tool exists");
  assert(toolNames.includes("get_current_tweet"), "get_current_tweet tool exists");
  assert(toolNames.includes("export_tweet_html"), "export_tweet_html tool exists");
  assert(toolNames.includes("export_tweet_text"), "export_tweet_text tool exists");
  assert(tools.length === 4, `exactly 4 tools registered (got ${tools.length})`);

  // Check that create_or_update_tweet has UI metadata
  const createTool = tools.find((t) => t.name === "create_or_update_tweet")!;
  const meta = (createTool as any)._meta;
  assert(meta?.ui?.resourceUri === "ui://tweet-preview/app", "create_or_update_tweet has correct UI resource URI in _meta");

  // --- List resources ---
  console.log("\n2. List resources");
  const { resources } = await client.listResources();
  assert(resources.length >= 1, `at least 1 resource registered (got ${resources.length})`);
  const appResource = resources.find((r) => r.uri === "ui://tweet-preview/app");
  assert(appResource !== undefined, "ui://tweet-preview/app resource exists");

  // --- Read UI resource ---
  console.log("\n3. Read UI resource");
  const { contents } = await client.readResource({ uri: "ui://tweet-preview/app" });
  assert(contents.length === 1, "resource returns exactly 1 content item");
  const htmlContent = (contents[0] as any).text as string;
  assert(typeof htmlContent === "string" && htmlContent.length > 0, "resource content is non-empty HTML string");
  assertIncludes(htmlContent, "<!DOCTYPE html>", "HTML starts with doctype");
  assertIncludes(htmlContent, "tweet-card", "HTML contains tweet-card CSS class");
  assert(
    contents[0].mimeType === "text/html;profile=mcp-app",
    `resource mimeType is correct (got ${contents[0].mimeType})`
  );

  // --- get_current_tweet (before creating) ---
  console.log("\n4. get_current_tweet (no tweet yet)");
  const noTweetResult = await client.callTool({ name: "get_current_tweet", arguments: {} });
  const noTweetText = getTextContent(noTweetResult as any);
  assertIncludes(noTweetText, "No tweet has been created yet", "returns 'no tweet' message");

  // --- export_tweet_html (before creating) ---
  console.log("\n5. export_tweet_html (no tweet yet)");
  const noHtmlResult = await client.callTool({ name: "export_tweet_html", arguments: {} });
  const noHtmlText = getTextContent(noHtmlResult as any);
  assertIncludes(noHtmlText, "No tweet has been created yet", "returns 'no tweet' message");

  // --- export_tweet_text (before creating) ---
  console.log("\n6. export_tweet_text (no tweet yet)");
  const noTextResult = await client.callTool({ name: "export_tweet_text", arguments: {} });
  const noTextText = getTextContent(noTextResult as any);
  assertIncludes(noTextText, "No tweet has been created yet", "returns 'no tweet' message");

  // --- create_or_update_tweet ---
  console.log("\n7. create_or_update_tweet");
  const createResult = await client.callTool({
    name: "create_or_update_tweet",
    arguments: {
      displayName: "Test User",
      handle: "testuser",
      text: "Hello world! @claude #mcp https://example.com",
      verified: true,
      likes: 42,
      retweets: 7,
      replies: 3,
      views: 1200,
    },
  });
  const createText = getTextContent(createResult as any);
  assert(createText.length > 0, "returns non-empty content");

  // The tool now returns JSON for the UI app to consume
  let tweetData: any;
  try {
    tweetData = JSON.parse(createText);
    assert(true, "tool result is valid JSON");
  } catch {
    assert(false, "tool result is valid JSON");
    tweetData = {};
  }
  assert(tweetData.displayName === "Test User", "JSON has correct displayName");
  assert(tweetData.handle === "testuser", "JSON has correct handle");
  assertIncludes(tweetData.text, "Hello world!", "JSON has correct text");
  assert(tweetData.verified === true, "JSON has verified flag");
  assert(tweetData.likes === 42, "JSON has correct likes");
  assert(tweetData.retweets === 7, "JSON has correct retweets");
  assert(tweetData.replies === 3, "JSON has correct replies");
  assert(tweetData.views === 1200, "JSON has correct views");

  // --- get_current_tweet (after creating) ---
  console.log("\n8. get_current_tweet (after creating)");
  const getCurrentResult = await client.callTool({ name: "get_current_tweet", arguments: {} });
  const getCurrentText = getTextContent(getCurrentResult as any);
  let currentTweet: any;
  try {
    currentTweet = JSON.parse(getCurrentText);
    assert(true, "returns valid JSON");
  } catch {
    assert(false, "returns valid JSON");
    currentTweet = {};
  }
  assert(currentTweet.handle === "testuser", "current tweet has correct handle");
  assert(currentTweet.text === "Hello world! @claude #mcp https://example.com", "current tweet has correct text");

  // --- export_tweet_html (after creating) ---
  console.log("\n9. export_tweet_html (after creating)");
  const htmlResult = await client.callTool({ name: "export_tweet_html", arguments: {} });
  const htmlText = getTextContent(htmlResult as any);
  assertIncludes(htmlText, "<!DOCTYPE html>", "returns full HTML document");
  assertIncludes(htmlText, "Test User", "HTML contains display name");
  assertIncludes(htmlText, "@testuser", "HTML contains handle");
  assertIncludes(htmlText, "Hello world!", "HTML contains tweet text");
  assertIncludes(htmlText, "tailwindcss", "HTML includes Tailwind CDN (standalone export)");

  // --- export_tweet_text (after creating) ---
  console.log("\n10. export_tweet_text (after creating)");
  const textResult = await client.callTool({ name: "export_tweet_text", arguments: {} });
  const textText = getTextContent(textResult as any);
  assert(
    textText === "Hello world! @claude #mcp https://example.com",
    "returns exact tweet text"
  );

  // --- Update tweet ---
  console.log("\n11. create_or_update_tweet (update)");
  const updateResult = await client.callTool({
    name: "create_or_update_tweet",
    arguments: {
      displayName: "Test User",
      handle: "testuser",
      text: "Updated tweet! 🎉",
    },
  });
  const updateText = getTextContent(updateResult as any);
  let updatedData: any;
  try {
    updatedData = JSON.parse(updateText);
    assert(true, "update returns valid JSON");
  } catch {
    assert(false, "update returns valid JSON");
    updatedData = {};
  }
  assert(updatedData.text === "Updated tweet! 🎉", "updated tweet has new text");

  // Verify get_current_tweet reflects the update
  const getUpdatedResult = await client.callTool({ name: "get_current_tweet", arguments: {} });
  const getUpdatedText = getTextContent(getUpdatedResult as any);
  const updatedTweet = JSON.parse(getUpdatedText);
  assert(updatedTweet.text === "Updated tweet! 🎉", "get_current_tweet reflects update");

  // --- Character limit edge case ---
  console.log("\n12. Character limit edge case (280+ chars)");
  const longText = "A".repeat(300);
  const longResult = await client.callTool({
    name: "create_or_update_tweet",
    arguments: {
      displayName: "Test User",
      handle: "testuser",
      text: longText,
    },
  });
  const longData = JSON.parse(getTextContent(longResult as any));
  assert(longData.text.length === 300, "accepts text over 280 chars (server doesn't truncate)");

  // --- Optional fields ---
  console.log("\n13. Minimal tweet (only required fields)");
  const minimalResult = await client.callTool({
    name: "create_or_update_tweet",
    arguments: {
      displayName: "Minimal",
      handle: "min",
      text: "Just text.",
    },
  });
  const minimalData = JSON.parse(getTextContent(minimalResult as any));
  assert(minimalData.displayName === "Minimal", "minimal tweet has display name");
  assert(minimalData.avatarUrl === undefined, "minimal tweet has no avatar URL");
  assert(minimalData.imageUrl === undefined, "minimal tweet has no image URL");
  assert(minimalData.verified === undefined, "minimal tweet has no verified flag");
  assert(minimalData.likes === undefined, "minimal tweet has no likes");

  // --- Cleanup ---
  await client.close();

  // --- Summary ---
  console.log(`\n${"─".repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  console.log(`${"─".repeat(40)}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
