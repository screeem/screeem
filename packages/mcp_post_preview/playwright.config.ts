import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "test-e2e-visual.spec.ts",
  timeout: 60_000,
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.01,
    },
  },
  use: {
    browserName: "chromium",
    headless: true,
    viewport: { width: 1280, height: 900 },
  },
  snapshotPathTemplate: "{testDir}/screenshots/{arg}{ext}",
});
