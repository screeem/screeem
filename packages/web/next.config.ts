import type { NextConfig } from "next"
import path from "node:path"

const standardPageExtensions = ["tsx", "ts", "jsx", "js"]
const isDockerBuild = process.env.SCREEEM_DOCKER_BUILD === "1"

const nextConfig: NextConfig = {
  agentRules: false,
  ...(process.env.NODE_ENV === "production"
    ? {}
    : { allowedDevOrigins: ["127.0.0.1"] }),
  ...(isDockerBuild
    ? {
        output: "standalone" as const,
        outputFileTracingRoot: path.join(process.cwd(), "../.."),
      }
    : {}),
  pageExtensions:
    process.env.NODE_ENV === "production"
      ? standardPageExtensions
      : ["dev.tsx", ...standardPageExtensions],
}

export default nextConfig
