import type { NextConfig } from "next"

const config: NextConfig = {
  transpilePackages: ["@design-rover/core", "@design-rover/model"],
  serverExternalPackages: ["typescript"],
}

export default config
