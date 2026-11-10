import { defineConfig } from "vitest/config"
import path from "node:path"

export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts", "tests/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@design-rover/core": path.resolve("packages/core/src/index.ts"),
      "@design-rover/model": path.resolve("packages/model/src/index.ts"),
      "@design-rover/integrations": path.resolve("packages/integrations/src/index.ts"),
    },
  },
})
