import path from "node:path"
import { fileURLToPath } from "node:url"
import { defineConfig } from "tsup"

const here = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  entry: ["src/bin.ts"],
  format: ["esm"],
  target: "node20",
  outDir: "dist",
  clean: true,
  splitting: false,
  sourcemap: true,
  dts: false,
  shims: true,
  banner: {
    js: "#!/usr/bin/env node",
  },
  noExternal: [/^@design-rover\//],
  external: ["@modelcontextprotocol/sdk"],
  esbuildOptions(options) {
    options.alias = {
      "@design-rover/core": path.join(here, "../core/src/index.ts"),
      "@design-rover/model": path.join(here, "../model/src/index.ts"),
      "@design-rover/integrations": path.join(here, "../integrations/src/index.ts"),
      "@design-rover/mcp": path.join(here, "../mcp/src/index.ts"),
    }
  },
})
