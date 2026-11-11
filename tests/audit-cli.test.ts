import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { spawnSync, execFileSync } from "node:child_process"
import { afterEach, describe, expect, it } from "vitest"
import { createEngine, loadCanonical } from "@design-rover/core"
const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "rover-audit-cli-"))
  roots.push(root)
  await fs.mkdir(path.join(root, "components/ui"), { recursive: true })
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ private: true, dependencies: { react: "19" } }),
  )
  await fs.writeFile(
    path.join(root, "components/ui/Button.tsx"),
    "export function Button(props: {label?: string}) { return <button>{props.label}</button> }",
  )
  return root
}
function cli(root: string, args: string[]) {
  const result = spawnSync("bun", ["run", "design-rover", ...args, "--cwd", root, "--json"], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 20000,
  })
  if (result.error) throw result.error
  return {
    exit: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    data: result.stdout.trim() ? JSON.parse(result.stdout) : undefined,
  }
}
async function setup() {
  const root = await fixture()
  const engine = await createEngine(root)
  await engine.init({ approve: true, generate: true })
  return { root, engine }
}
describe("audit CLI contracts", () => {
  it.each([
    ["status", "--unknown-option"],
    ["context", "--max-chars"],
    ["status", "--unknown-option=bad"],
  ])("uses JSON for parser errors in %s %s", async (command, flag) => {
    const root = await fixture()
    const result = cli(root, [command, flag])
    expect(result.exit).toBe(1)
    expect(result.data.error).toBeTypeOf("string")
    await expect(fs.stat(path.join(root, ".design-rover"))).rejects.toMatchObject({ code: "ENOENT" })
  })
  it("ignores absent local snapshots and adapters for gates while preserving freshness reporting", async () => {
    const { root } = await setup()
    await fs.rm(path.join(root, ".design-rover/generated"), { recursive: true })
    for (const file of [
      "AGENTS.md",
      "CLAUDE.md",
      ".cursor/rules/design-rover.mdc",
      ".agents/skills/design-rover/SKILL.md",
    ])
      await fs.rm(path.join(root, file))
    const status = cli(root, ["status"])
    expect(status.data.staleGenerated.length).toBeGreaterThan(0)
    expect(cli(root, ["ci"]).exit).toBe(0)
    expect(cli(root, ["git", "hook"]).exit).toBe(0)
    await fs.mkdir(path.join(root, ".design-rover/generated"))
    await fs.writeFile(path.join(root, ".design-rover/generated/AGENTS.md"), "edited local snapshot")
    expect(cli(root, ["ci"]).exit).toBe(1)
    expect(cli(root, ["git", "hook"]).exit).toBe(1)
  })
  it("keeps missing tracked root guidance as a gate failure without creating Git commits", async () => {
    const { root } = await setup()
    execFileSync("git", ["init", "-q"], { cwd: root })
    execFileSync("git", ["add", "AGENTS.md"], { cwd: root })
    await fs.rm(path.join(root, "AGENTS.md"))
    expect(cli(root, ["ci"]).exit).toBe(1)
    expect(cli(root, ["git", "hook"]).exit).toBe(1)
  })
  it("fails explicitly when an unreadable Git index prevents tracked-guidance checks", async () => {
    const { root } = await setup()
    execFileSync("git", ["init", "-q"], { cwd: root })
    execFileSync("git", ["add", "AGENTS.md"], { cwd: root })
    await fs.rm(path.join(root, "AGENTS.md"))
    await fs.writeFile(path.join(root, ".git/index"), "invalid index")
    const result = cli(root, ["ci"])
    expect(result.exit).toBe(1)
    expect(result.data.error).toContain("Cannot determine Git-tracked guidance")
  })
  it("supports explicit API approval and protects retirement from routine sync", async () => {
    const { root } = await setup()
    const original = (await loadCanonical(root))!
    const button = original.components.find((item) => item.name === "Button")!
    expect(cli(root, ["approve", button.id]).exit).toBe(0)
    expect((await loadCanonical(root))!.components.find((item) => item.id === button.id)?.status).toBe(
      "approved",
    )
    await fs.rm(path.join(root, "components/ui/Button.tsx"))
    expect(cli(root, ["check"]).exit).toBe(1)
    expect(cli(root, ["ci"]).exit).toBe(1)
    expect(cli(root, ["git", "hook"]).exit).toBe(1)
    expect(cli(root, ["sync", "--yes", "--approve"]).exit).toBe(0)
    expect((await loadCanonical(root))!.components.some((item) => item.id === button.id)).toBe(true)
    const change = cli(root, ["diff"]).data.changes.find(
      (item: { entity: string; kind: string; name: string }) =>
        item.entity === "component" && item.kind === "remove" && item.name === "Button",
    )
    expect(cli(root, ["approve", change.id]).exit).toBe(0)
    expect((await loadCanonical(root))!.components.some((item) => item.id === button.id)).toBe(false)
  })
  it("supports revoking and reapproving an unchanged public API", async () => {
    const { root } = await setup()
    const id = (await loadCanonical(root))!.components[0]!.id
    expect(cli(root, ["approve", id]).exit).toBe(0)
    expect(cli(root, ["reject", id]).exit).toBe(0)
    expect((await loadCanonical(root))!.components[0]!.status).toBe("rejected")
    expect(cli(root, ["approve", id]).exit).toBe(0)
    const model = (await loadCanonical(root))!
    expect(model.components[0]!.status).toBe("approved")
    expect(model.history.some((event) => event.type === "approved")).toBe(true)
    expect(
      model.history.some((event) => event.type === "rejected" && event.summary.startsWith("Rejected:")),
    ).toBe(true)
  })
  it("warns about unknown root framework coverage", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "rover-unknown-framework-"))
    roots.push(root)
    await fs.writeFile(path.join(root, "package.json"), "{}")
    const result = spawnSync("bun", ["run", "design-rover", "init", "--cwd", root], {
      encoding: "utf8",
      cwd: process.cwd(),
    })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("Root framework is unknown")
    expect(result.stdout).toContain("Non-React templates are not component-checked")
  })
})
