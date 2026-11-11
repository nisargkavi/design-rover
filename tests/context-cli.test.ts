import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { afterEach, describe, expect, it } from "vitest"
import { createEngine } from "@design-rover/core"

const execute = promisify(execFile)
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))) })

describe("context CLI", () => {
  it("emits a bounded canonical packet and actionable JSON errors", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "design-rover-context-cli-"))
    roots.push(root)
    await fs.cp(path.join(process.cwd(), "fixtures/next-tailwind"), root, { recursive: true, filter: (file) => !file.includes("node_modules") && !file.includes(".design-rover") })
    await (await createEngine(root)).init({ approve: true, generate: false })
    const run = (args: string[]) => execute("bun", ["run", "design-rover", "context", ...args, "--cwd", root, "--json"], { cwd: process.cwd(), maxBuffer: 1024 * 1024 })
    const { stdout } = await run(["Button", "--path", "app/dashboard/page.tsx", "--max-chars", "18000", "--limit", "20"])
    const packet = JSON.parse(stdout)
    expect(stdout.length).toBeLessThanOrEqual(18000)
    expect(packet.limits.outputChars).toBe(stdout.length)
    expect(packet.scope.path).toBe("app/dashboard/page.tsx")
    expect(packet.matches.some((item: { kind: string; record: { name: string; source: string } }) => item.kind === "component" && item.record.name === "Button" && item.record.source === "components/ui/button.tsx")).toBe(true)
    const small = JSON.parse((await run(["Button", "--path", "app/dashboard/page.tsx", "--max-chars", "3000"])).stdout)
    expect(small.limits.outputChars).toBeLessThanOrEqual(3000)
    expect(small.coverage.complete).toBe(false)
    await expect(run(["--path", "../outside"])).rejects.toMatchObject({ code: 1, stdout: expect.stringContaining("cannot leave the repository") })
  })
})
