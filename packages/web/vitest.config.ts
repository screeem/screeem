import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

// Mirrors the `@/*` path mapping in tsconfig.json so tests resolve the same
// module specifiers the app does. Environments stay per-file via the
// `@vitest-environment` docblock.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    setupFiles: ["./test/setup.ts"],
  },
})
