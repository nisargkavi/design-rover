import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { createEngine } from "@design-rover/core"

const copies: string[] = []

afterEach(async () => {
  await Promise.all(copies.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe("generated context", () => {
  it("wraps AGENTS.md in managed markers and does not destroy existing notes", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "design-rover-ctx-"))
    copies.push(dir)
    await fs.cp(path.join(process.cwd(), "fixtures/next-tailwind"), dir, {
      recursive: true,
      filter: (src) => !src.includes("node_modules") && !src.includes(".design-rover"),
    })
    const original = "# Keep this architecture. Do not extract page sections.\n"
    await fs.writeFile(path.join(dir, "AGENTS.md"), original)
    const engine = await createEngine(dir)
    await engine.init({ approve: true, generate: false })
    await engine.generate({ writeRepoFiles: true })
    const next = await fs.readFile(path.join(dir, "AGENTS.md"), "utf8")
    expect(next).toContain("Keep this architecture")
    expect(next).toContain("<!-- design-rover:start -->")
    expect(next).toContain("<!-- design-rover:end -->")
  })
})
