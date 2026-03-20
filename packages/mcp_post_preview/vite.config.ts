import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  plugins: [svelte(), viteSingleFile()],
  root: "app",
  build: {
    outDir: "../dist",
    emptyOutDir: false,
    target: "esnext",
  },
});
