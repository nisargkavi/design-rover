import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { createEngine, serializeContext, type ContextPacket } from "@design-rover/core"

const roots: string[] = []
const buttonSource = 'export function Button({ label }: { label: string }) { return <button className="px-4">{label}</button> }\n'
const updatedButton = 'export function Button({ label, disabled }: { label: string; disabled?: boolean }) { return <button className="px-4" disabled={disabled}>{label}</button> }\n'

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

async function project(options: { approve?: boolean; generate?: boolean; longPath?: boolean } = {}) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "design rover context freshness "))
  roots.push(temporary)
  const root = options.longPath
    ? path.join(temporary, "nested project ".repeat(6), "a second directory ".repeat(5), "component workspace ".repeat(5))
    : temporary
  await fs.mkdir(path.join(root, "components/ui"), { recursive: true })
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ private: true, dependencies: { react: "19.0.0", tailwindcss: "4.0.0" } }))
  await fs.writeFile(path.join(root, "components/ui/Button.tsx"), buttonSource)
  const engine = await createEngine(root)
  await engine.init({ approve: options.approve ?? true, generate: options.generate ?? false })
  return { root, engine }
}

// Cache writes are permitted; every other source, decision, projection and
// history byte must survive a context request unchanged.
async function durableFiles(root: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {}
  async function visit(directory: string) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name)
      const relative = path.relative(root, file).split(path.sep).join("/")
      if (relative === ".design-rover/cache") continue
      if (entry.isDirectory()) await visit(file)
      else if (entry.isFile()) files[relative] = await fs.readFile(file, "utf8")
    }
  }
  await visit(root)
  return files
}

function assertChecked(packet: ContextPacket): asserts packet is ContextPacket & { freshness: Extract<ContextPacket["freshness"], { checked: true }> } {
  expect(packet.freshness.checked).toBe(true)
  if (!packet.freshness.checked) throw new Error("Expected a checked context packet")
}

describe("context freshness and explicit review", () => {
  it("checks unchanged supported observations without rewriting saved knowledge", async () => {
    const { root, engine } = await project()
    const before = await durableFiles(root)
    const packet = await engine.context({ query: "Button", maxChars: 16000 })
    assertChecked(packet)
    expect(packet.freshness).toMatchObject({ checked: true, sourceStatus: "current", syncStatus: "synchronized", sourceChanges: 0, pendingReview: 0, staleGenerated: 0 })
    expect(Number.isNaN(Date.parse(packet.freshness.checkedAt!))).toBe(false)
    expect(packet.matches.some((item) => item.kind === "component" && "name" in item.record && item.record.name === "Button")).toBe(true)
    expect(packet.freshness.actions).toBeUndefined()
    expect(await durableFiles(root)).toEqual(before)
  })

  it.each(["add", "update", "remove"] as const)("reports a component %s without replacing the saved map or its decisions", async (change) => {
    const { root, engine } = await project()
    const buttonFile = path.join(root, "components/ui/Button.tsx")
    if (change === "add") await fs.writeFile(path.join(root, "components/ui/Card.tsx"), "export function Card() { return <section /> }\n")
    else if (change === "update") await fs.writeFile(buttonFile, updatedButton)
    else await fs.rm(buttonFile)
    const before = await durableFiles(root)
    const packet = await engine.context({ query: change === "add" ? "Card" : "Button", maxChars: 16000 })
    assertChecked(packet)
    expect(packet.freshness).toMatchObject({ checked: true, sourceStatus: "stale" })
    expect(packet.freshness.sourceChanges).toBeGreaterThan(0)
    expect(packet.warnings.some((warning) => warning.includes("Saved context is stale"))).toBe(true)
    expect(packet.freshness.actions).toMatchObject({ cwd: root, review: "bunx design-rover diff --json", refresh: "bunx design-rover sync --yes" })
    expect(JSON.stringify(packet.freshness.actions)).not.toContain("--approve")
    if (change === "add") expect(packet.matches.some((item) => item.kind === "component" && "name" in item.record && item.record.name === "Card")).toBe(false)
    else {
      const button = packet.matches.find((item) => item.kind === "component" && "name" in item.record && item.record.name === "Button")!
      expect(button).toBeDefined()
      if ("props" in button.record) expect(button.record.props.some((prop) => prop.name === "disabled")).toBe(false)
    }
    expect(await durableFiles(root)).toEqual(before)
  })

  it("keeps pending approval separate from stale source and requires explicit opt-in to retrieve it", async () => {
    const { root, engine } = await project({ approve: false })
    const before = await durableFiles(root)
    const packet = await engine.context({ query: "Button", maxChars: 16000 })
    assertChecked(packet)
    expect(packet.freshness).toMatchObject({ checked: true, sourceStatus: "current", syncStatus: "pending-review", sourceChanges: 0 })
    expect(packet.freshness.pendingReview).toBeGreaterThan(0)
    expect(packet.freshness.actions).toMatchObject({ cwd: root, review: "bunx design-rover diff --json" })
    expect(packet.freshness.actions?.refresh).toBeUndefined()
    expect(packet.matches.some((item) => item.record.status === "inferred" || item.record.status === "suggested")).toBe(false)
    const review = await engine.context({ query: "Button", includePending: true, maxChars: 16000 })
    expect(review.matches.some((item) => item.record.status === "inferred" || item.record.status === "suggested")).toBe(true)
    expect(await durableFiles(root)).toEqual(before)
  })

  it("refreshes returned APIs only after explicit application while leaving unrelated inferences pending", async () => {
    const { root, engine } = await project({ approve: false })
    await fs.writeFile(path.join(root, "components/ui/Button.tsx"), updatedButton)
    const pending = (await engine.load())!.conventions.map(({ id, status }) => ({ id, status }))
    expect(pending.some((item) => item.status === "inferred")).toBe(true)
    const stale = await engine.context({ query: "Button" })
    assertChecked(stale)
    expect(stale.freshness.sourceStatus).toBe("stale")
    const preview = await engine.syncPreview()
    const componentChange = preview.diff.changes.find((item) => item.entity === "component" && item.name === "Button")!
    await engine.applyChanges([componentChange.id], { generate: false })
    const packet = await engine.context({ query: "Button", maxChars: 16000 })
    assertChecked(packet)
    expect(packet.freshness).toMatchObject({ sourceStatus: "current", sourceChanges: 0 })
    expect(packet.freshness.pendingReview).toBeGreaterThan(0)
    const button = packet.matches.find((item) => item.kind === "component" && "name" in item.record && item.record.name === "Button")!
    expect("props" in button.record && button.record.props.some((prop) => prop.name === "disabled")).toBe(true)
    expect((await engine.load())!.conventions.map(({ id, status }) => ({ id, status }))).toEqual(pending)
  })

  it("keeps an approved removed component until its removal change is explicitly accepted", async () => {
    const { root, engine } = await project()
    const observed = (await engine.load())!.components.find((item) => item.name === "Button")!
    await engine.applyChanges([observed.id], { generate: false })
    const approved = (await engine.load())!.components.find((item) => item.id === observed.id)!
    expect(approved.status).toBe("approved")
    await fs.rm(path.join(root, "components/ui/Button.tsx"))
    const stale = await engine.context({ query: "Button", maxChars: 16000 })
    assertChecked(stale)
    expect(stale.freshness.sourceStatus).toBe("stale")
    expect(stale.matches.find((item) => item.record.id === approved.id)?.record).toEqual(approved)
    await engine.applyChanges(undefined, { generate: false })
    expect((await engine.load())!.components.find((item) => item.id === approved.id)).toEqual(approved)
    const stillStale = await engine.context({ query: "Button", maxChars: 16000 })
    assertChecked(stillStale)
    expect(stillStale.freshness.sourceStatus).toBe("stale")
    const preview = await engine.syncPreview()
    const removal = preview.diff.changes.find((item) => item.kind === "remove" && item.entity === "component" && item.name === "Button")!
    expect(removal).toBeDefined()
    await engine.applyChanges([removal.id], { generate: false })
    expect((await engine.load())!.components.some((item) => item.id === approved.id)).toBe(false)
  })

  it("reports stale generated guidance independently and offers generation without refreshing or approving", async () => {
    const { root, engine } = await project({ generate: true })
    await fs.writeFile(path.join(root, ".design-rover/generated/AGENTS.md"), "Stale generated guidance\n")
    const before = await durableFiles(root)
    const packet = await engine.context({ query: "Button", maxChars: 16000 })
    assertChecked(packet)
    expect(packet.freshness).toMatchObject({ checked: true, sourceStatus: "current", sourceChanges: 0 })
    expect(packet.freshness.staleGenerated).toBeGreaterThan(0)
    expect(packet.freshness.actions).toMatchObject({ cwd: root, generate: "bunx design-rover generate" })
    expect(packet.freshness.actions?.refresh).toBeUndefined()
    expect(await durableFiles(root)).toEqual(before)
  })

  it("fails an unavailable freshness scan clearly while retaining explicit snapshot-only access", async () => {
    const { root, engine } = await project()
    await fs.mkdir(path.join(root, ".gitignore"))
    const before = await durableFiles(root)
    await expect(engine.context({ query: "Button" })).rejects.toThrow(/Unable to check context freshness/)
    const snapshot = await engine.context({ query: "Button", checkFreshness: false })
    expect(snapshot.freshness.checked).toBe(false)
    expect(snapshot.matches.some((item) => item.kind === "component" && "name" in item.record && item.record.name === "Button")).toBe(true)
    expect(await durableFiles(root)).toEqual(before)
  })

  it("includes freshness and usable actions inside the output budget for long repository paths with spaces", async () => {
    const { root, engine } = await project({ longPath: true })
    await fs.writeFile(path.join(root, "components/ui/Button.tsx"), updatedButton)
    for (const maxChars of [2400, 4000, 7000]) {
      const packet = await engine.context({ query: "Button", maxChars })
      assertChecked(packet)
      const output = serializeContext(packet)
      expect(packet.freshness.actions?.cwd).toBe(root)
      expect(packet.freshness.sourceStatus).toBe("stale")
      expect(output.length).toBeLessThanOrEqual(maxChars)
      expect(packet.limits.outputChars).toBe(output.length)
      expect(packet.coverage.returned).toBe(packet.matches.length)
    }
  })
})
