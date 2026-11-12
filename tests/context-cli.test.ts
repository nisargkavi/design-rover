import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { afterEach, describe, expect, it } from "vitest"
import { createEngine, loadCanonical } from "@design-rover/core"

const execute = promisify(execFile)
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))) })

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "design-rover context cli-"))
  roots.push(root)
  await fs.cp(path.join(process.cwd(), "fixtures/next-tailwind"), root, { recursive: true, filter: (file) => !file.includes("node_modules") && !file.includes(".design-rover") })
  return root
}

async function savedFiles(root: string) {
  const files: Record<string, string> = {}
  async function visit(relative = "") {
    for (const entry of await fs.readdir(path.join(root, ".design-rover", relative), { withFileTypes: true })) {
      const child = path.join(relative, entry.name)
      if (child === "cache") continue
      if (entry.isDirectory()) await visit(child)
      else files[child] = await fs.readFile(path.join(root, ".design-rover", child), "utf8")
    }
  }
  await visit()
  return files
}

function run(root: string, args: string[]) {
  return execute("bun", ["run", "design-rover", ...args, "--cwd", root, "--json"], { cwd: process.cwd(), maxBuffer: 1024 * 1024 })
}

function followAction(action: string, cwd: string) {
  const [runner, packageName, ...args] = action.split(" ")
  expect([runner, packageName]).toEqual(["bunx", "design-rover"])
  // Exercise the returned arguments against this checkout's CLI from the supplied
  // working directory, without fetching the previously published version.
  return execute("bun", [path.join(process.cwd(), "packages/cli/src/bin.ts"), ...args, "--json"], { cwd, maxBuffer: 1024 * 1024 })
}

describe("context CLI", () => {
  it("emits a bounded canonical packet and actionable JSON errors", async () => {
    const root = await fixture()
    await (await createEngine(root)).init({ approve: true, generate: false })
    const { stdout } = await run(root, ["context", "Button", "--path", "app/dashboard/page.tsx", "--max-chars", "18000", "--limit", "20"])
    const packet = JSON.parse(stdout)
    expect(stdout.length).toBeLessThanOrEqual(18000)
    expect(packet.limits.outputChars).toBe(stdout.length)
    expect(packet.scope.path).toBe("app/dashboard/page.tsx")
    expect(packet.freshness).toMatchObject({ checked: true, sourceStatus: "current", sourceChanges: 0, syncStatus: "synchronized" })
    expect(Number.isNaN(Date.parse(packet.freshness.checkedAt))).toBe(false)
    expect(packet.matches.some((item: { kind: string; record: { name: string; source: string } }) => item.kind === "component" && item.record.name === "Button" && item.record.source === "components/ui/button.tsx")).toBe(true)
    const small = JSON.parse((await run(root, ["context", "Button", "--path", "app/dashboard/page.tsx", "--max-chars", "3000"])).stdout)
    expect(small.limits.outputChars).toBeLessThanOrEqual(3000)
    expect(small.coverage.complete).toBe(false)
    await expect(run(root, ["context", "--path", "../outside"])).rejects.toMatchObject({ code: 1, stdout: expect.stringContaining("cannot leave the repository") })
  })

  it("reports changed observations without accepting them, then refreshes only after explicit sync", async () => {
    const root = await fixture()
    await (await createEngine(root)).init({ generate: false })
    const before = (await loadCanonical(root))!
    const pending = [...before.patterns, ...before.conventions, ...before.intents, ...before.exceptions].filter((item) => item.status === "inferred" || item.status === "suggested")
    expect(pending.length).toBeGreaterThan(0)
    const persisted = await savedFiles(root)
    const buttonFile = path.join(root, "components/ui/button.tsx")
    const changedButton = (await fs.readFile(buttonFile, "utf8")).replace('ghost: "bg-transparent"', 'quiet: "bg-transparent"')
    await fs.writeFile(buttonFile, changedButton)
    await fs.writeFile(path.join(root, "components/ui/NewAction.tsx"), 'export function NewAction() { return <button className="h-9"><span className="text-sm">Continue</span></button> }\n')
    await fs.rm(path.join(root, "components/ui/card.tsx"))

    const { stdout } = await run(root, ["context", "Button", "--path", "components/ui", "--max-chars", "18000"])
    const stale = JSON.parse(stdout)
    expect(stale.freshness).toMatchObject({ checked: true, sourceStatus: "stale", actions: { cwd: root, review: "bunx design-rover diff --json", refresh: "bunx design-rover sync --yes" } })
    expect(stale.freshness.sourceChanges).toBeGreaterThanOrEqual(3)
    expect(stale.freshness.pendingReview).toBeGreaterThan(0)
    expect(stale.warnings.join(" ")).toContain("Saved context is stale")
    expect(stale.matches.find((item: { record: { name: string } }) => item.record.name === "Button").record.variants).toContain("ghost")
    expect(stale.limits.outputChars).toBe(stdout.length)
    expect(stdout.length).toBeLessThanOrEqual(18000)
    expect(await savedFiles(root)).toEqual(persisted)
    expect(await loadCanonical(root)).toEqual(before)
    expect(await fs.readFile(buttonFile, "utf8")).toBe(changedButton)

    const cacheFile = path.join(root, ".design-rover/cache/evidence.json")
    const cache = await fs.readFile(cacheFile, "utf8")
    const offline = JSON.parse((await run(root, ["context", "Button", "--no-check-freshness"])).stdout)
    expect(offline.freshness.checked).toBe(false)
    expect(await fs.readFile(cacheFile, "utf8")).toBe(cache)
    expect(await savedFiles(root)).toEqual(persisted)

    await followAction(stale.freshness.actions.review, stale.freshness.actions.cwd)
    expect(await savedFiles(root)).toEqual(persisted)
    await followAction(stale.freshness.actions.refresh, stale.freshness.actions.cwd)
    const refreshed = JSON.parse((await run(root, ["context", "Button", "--path", "components/ui", "--max-chars", "18000"])).stdout)
    expect(refreshed.freshness).toMatchObject({ checked: true, sourceStatus: "current", sourceChanges: 0 })
    expect(refreshed.freshness.pendingReview).toBeGreaterThan(0)
    expect(refreshed.freshness.actions?.refresh).toBeUndefined()
    expect(refreshed.matches.find((item: { record: { name: string } }) => item.record.name === "Button").record.variants).toContain("quiet")
    const after = (await loadCanonical(root))!
    expect(after.components.some((item) => item.name === "NewAction")).toBe(true)
    expect(after.components.some((item) => item.source === "components/ui/card.tsx")).toBe(false)
    const afterDecisions = [...after.patterns, ...after.conventions, ...after.intents, ...after.exceptions]
    for (const record of pending) {
      expect(afterDecisions.find((item) => item.id === record.id)?.status).toBe(record.status)
    }
    expect(after.history.filter((event) => event.type === "approved")).toEqual(before.history.filter((event) => event.type === "approved"))
  })

  it("keeps an approved component removal stale until its specific change is explicitly accepted", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "design-rover protected removal-"))
    roots.push(root)
    const source = path.join(root, "Button.tsx")
    await fs.writeFile(source, "export function Button() { return <button>Save</button> }\n")
    const engine = await createEngine(root)
    const { model } = await engine.init({ generate: false })
    const component = model.components.find((item) => item.name === "Button")!
    await engine.applyChanges([component.id], { generate: false })
    const approved = (await loadCanonical(root))!.components.find((item) => item.id === component.id)!
    expect(approved.status).toBe("approved")
    await fs.rm(source)
    const stale = JSON.parse((await run(root, ["context", "Button"])).stdout)
    expect(stale.freshness).toMatchObject({ checked: true, sourceStatus: "stale" })
    const preview = JSON.parse((await followAction(stale.freshness.actions.review, stale.freshness.actions.cwd)).stdout)
    const removal = preview.changes.find((change: { kind: string; entity: string; before?: { id: string } }) => change.kind === "remove" && change.entity === "component" && change.before?.id === component.id)
    expect(removal).toBeDefined()
    await followAction(stale.freshness.actions.refresh, stale.freshness.actions.cwd)
    const retained = JSON.parse((await run(root, ["context", "Button"])).stdout)
    expect(retained.freshness).toMatchObject({ checked: true, sourceStatus: "stale", sourceChanges: 1 })
    expect((await loadCanonical(root))!.components.find((item) => item.id === component.id)).toEqual(approved)
    await run(root, ["approve", removal.id])
    const accepted = JSON.parse((await run(root, ["context", "Button"])).stdout)
    expect(accepted.freshness).toMatchObject({ checked: true, sourceStatus: "current", sourceChanges: 0 })
    expect((await loadCanonical(root))!.components.some((item) => item.id === component.id)).toBe(false)
  })

  it("returns an actionable JSON error when freshness cannot be checked, with an explicit offline escape hatch", async () => {
    const root = await fixture()
    await (await createEngine(root)).init({ generate: false })
    const persisted = await savedFiles(root)
    const cache = path.join(root, ".design-rover/cache")
    await fs.rm(cache, { recursive: true, force: true })
    await fs.writeFile(cache, "Blocked cache directory\n")
    await expect(run(root, ["context", "Button"])).rejects.toMatchObject({ code: 1, stdout: expect.stringContaining("Unable to check context freshness") })
    const offline = JSON.parse((await run(root, ["context", "Button", "--no-check-freshness"])).stdout)
    expect(offline.freshness.checked).toBe(false)
    expect(await savedFiles(root)).toEqual(persisted)
  })
})
