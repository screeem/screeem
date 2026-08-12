import type { NextConfig } from "next"
import path from "node:path"

const standardPageExtensions = ["tsx", "ts", "jsx", "js"]

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(process.cwd(), "../.."),
  pageExtensions:
    process.env.NODE_ENV === "production"
      ? standardPageExtensions
      : ["dev.tsx", ...standardPageExtensions],
}

export default nextConfig
