import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  plugins: [viteSingleFile()],
  root: "app",
  build: {
    outDir: "../dist",
    emptyOutDir: false,
    target: "esnext",
  },
});
