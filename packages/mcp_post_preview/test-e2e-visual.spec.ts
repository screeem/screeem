/**
 * Visual E2E test for the MCP post-preview server via MCP Inspector.
 *
 * 1. Starts the MCP Inspector pointing at the built MCP server
 * 2. Uses Playwright to open the Inspector web UI (with auth token)
 * 3. Connects to the server, navigates to Apps tab
 * 4. Calls tools with different parameters
 * 5. Screenshots the rendered UI and checks for visual diffs
 *
 * Run:
 *   pnpm run build && pnpm run test:visual
 *
 * Update snapshots:
 *   pnpm run test:visual:update
 */

import { test, expect } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Use non-default ports to avoid conflicts
const CLIENT_PORT = 6374;
const PROXY_PORT = 6377;

let inspectorProcess: ChildProcess;
let inspectorUrl: string;

test.beforeAll(async () => {
  // Kill any leftover processes on our ports
  try {
    const { execSync } = await import("node:child_process");
    execSync(`lsof -ti:${CLIENT_PORT},${PROXY_PORT} | xargs kill -9 2>/dev/null`, {
      stdio: "ignore",
    });
    await new Promise((r) => setTimeout(r, 500));
  } catch {
    // no processes to kill
  }

  // Start the MCP Inspector pointing at our built server
  inspectorProcess = spawn(
    "pnpm",
    [
      "dlx",
      "@modelcontextprotocol/inspector",
      "node",
      path.join(__dirname, "dist", "index.js"),
    ],
    {
      cwd: __dirname,
      env: {
        ...process.env,
        CLIENT_PORT: String(CLIENT_PORT),
        SERVER_PORT: String(PROXY_PORT),
        MCP_AUTO_OPEN_ENABLED: "false",
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );

  // Capture the URL with auth token from Inspector output
  inspectorUrl = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Timed out waiting for Inspector.\nOutput: ${output}`)),
      30_000,
    );

    let output = "";

    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      // Look for the full URL with token
      const match = output.match(
        /http:\/\/localhost:\d+\/\?[^\s]+MCP_PROXY_AUTH_TOKEN=[a-f0-9]+/,
      );
      if (match) {
        clearTimeout(timeout);
        inspectorProcess.stdout?.off("data", onData);
        inspectorProcess.stderr?.off("data", onData);
        resolve(match[0]);
      }
    };

    inspectorProcess.stdout?.on("data", onData);
    inspectorProcess.stderr?.on("data", onData);

    inspectorProcess.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });

  console.log(`Inspector ready at: ${inspectorUrl}`);
});

test.afterAll(async () => {
  inspectorProcess?.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 1000));
  // Clean up ports
  try {
    const { execSync } = await import("node:child_process");
    execSync(`lsof -ti:${CLIENT_PORT},${PROXY_PORT} | xargs kill -9 2>/dev/null`, {
      stdio: "ignore",
    });
  } catch {
    // fine
  }
});

// Helper: open Inspector, connect to the MCP server
async function connectToServer(page: import("@playwright/test").Page) {
  await page.goto(inspectorUrl);

  // Wait a moment for the UI to populate
  await page.waitForTimeout(1_000);

  // Click the Connect button
  const connectButton = page.getByRole("button", { name: /connect/i }).first();
  await connectButton.click();

  // Wait for connection — the Apps tab should become visible
  await page.getByRole("tab", { name: /apps/i }).waitFor({ timeout: 15_000 });
}

// Helper: navigate to Apps tab, select the tool, fill params, click Open App
async function openApp(
  page: import("@playwright/test").Page,
  platform: "twitter" | "linkedin",
  text: string,
) {
  // Click the Apps tab
  await page.getByRole("tab", { name: /apps/i }).click();

  // Wait for tool list to load, then click create_or_update_post
  const toolItem = page.getByText("create_or_update_post").first();
  await toolItem.waitFor({ timeout: 10_000 });
  await toolItem.click();

  // Fill in the platform — it's a Select (combobox) component
  // The Inspector renders a <SelectTrigger id={key}> for enum fields
  const platformTrigger = page.locator('[id="platform"]');
  await platformTrigger.waitFor({ timeout: 5_000 });
  await platformTrigger.click();
  await page.getByRole("option", { name: platform }).click();

  // Fill in the text field (rendered as a Textarea for string fields)
  const textInput = page.locator('[id="text"]');
  await textInput.fill(text);

  // Click "Open App"
  await page.getByRole("button", { name: /open app/i }).click();

  // Wait for the app renderer container (div with min-height 400px wrapping the iframe)
  const appContainer = page.locator('.border.rounded.overflow-hidden').first();
  await appContainer.waitFor({ timeout: 10_000 });

  // Wait for the iframe inside to load and render
  await page.waitForTimeout(3_000);

  return appContainer;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

test.describe("MCP Inspector - Twitter preview", () => {
  test("renders tweet preview", async ({ page }) => {
    await connectToServer(page);
    const appContainer = await openApp(
      page,
      "twitter",
      "Hello world! @claude #mcp https://example.com",
    );

    await expect(appContainer).toHaveScreenshot("tweet-light.png");
  });
});

test.describe("MCP Inspector - LinkedIn preview", () => {
  test("renders LinkedIn post preview", async ({ page }) => {
    await connectToServer(page);
    const appContainer = await openApp(
      page,
      "linkedin",
      "Excited to share this update! #opentowork @connections",
    );

    await expect(appContainer).toHaveScreenshot("linkedin-light.png");
  });
});
