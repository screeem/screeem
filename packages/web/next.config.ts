import type { NextConfig } from "next"

const standardPageExtensions = ["tsx", "ts", "jsx", "js"]

const nextConfig: NextConfig = {
  pageExtensions:
    process.env.NODE_ENV === "production"
      ? standardPageExtensions
      : ["dev.tsx", ...standardPageExtensions],
}

export default nextConfig
