import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { createEngine } from "@design-rover/core"

const fixture = path.join(process.cwd(), "fixtures/next-tailwind")
const copies: string[] = []

async function copyFixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "design-rover-"))
  copies.push(dir)
  await fs.cp(fixture, dir, {
    recursive: true,
    filter: (src) => !src.includes("node_modules") && !src.includes(".design-rover"),
  })
  return dir
}

afterEach(async () => {
  await Promise.all(copies.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

async function snapshotApp(root: string) {
  const files = ["app/page.tsx", "app/settings/page.tsx", "app/dashboard/page.tsx", "components/ui/button.tsx"]
  const map: Record<string, string> = {}
  for (const file of files) {
    map[file] = await fs.readFile(path.join(root, file), "utf8")
  }
  return map
}

describe("architecture preservation", () => {
  it("does not rewrite application source on init or sync", async () => {
    const root = await copyFixture()
    const before = await snapshotApp(root)
    const engine = await createEngine(root)
    await engine.init({ approve: true, generate: false })
    await engine.applyChanges(undefined, { approveInferred: true, generate: false })
    const after = await snapshotApp(root)
    expect(after).toEqual(before)
  })

  it("records colocated patterns without recommending extraction", async () => {
    const root = await copyFixture()
    const engine = await createEngine(root)
    const { snapshot } = await engine.init()
    const pattern = snapshot.patterns.find((item) => item.occurrences.length >= 2)
    expect(pattern).toBeTruthy()
    expect(pattern?.architecture).toBe("do-not-extract")
    expect(pattern?.guidance.toLowerCase()).toMatch(/colocated|do not extract|not a missing component/)
  })

  it("does not invent a token from a one-off arbitrary radius", async () => {
    const root = await copyFixture()
    const engine = await createEngine(root)
    const { snapshot } = await engine.init()
    expect(snapshot.tokens.some((token) => token.value.includes("13px") || token.name.includes("13"))).toBe(false)
    expect(snapshot.tokens.some((token) => token.name.includes("--color-primary") || token.name.includes("primary"))).toBe(true)
  })

  it("discovers Button variants from the actual component", async () => {
    const root = await copyFixture()
    const engine = await createEngine(root)
    const { snapshot } = await engine.init()
    const button = snapshot.components.find((item) => item.name === "Button")
    expect(button?.variants).toEqual(expect.arrayContaining(["default", "secondary", "outline", "ghost"]))
    expect(button?.sizes).toEqual(expect.arrayContaining(["sm", "default", "lg"]))
    expect(button?.source).toContain("components/ui/button.tsx")
  })

  it("captures placeholder hero intent", async () => {
    const root = await copyFixture()
    const engine = await createEngine(root)
    const { snapshot } = await engine.init()
    expect(snapshot.intents.some((item) => item.placeholderAllowed && item.productionAssetRequired)).toBe(true)
  })

  it("infers inline Tailwind rather than class constants", async () => {
    const root = await copyFixture()
    const engine = await createEngine(root)
    const { snapshot } = await engine.init()
    const inline = snapshot.conventions.find((item) => item.id.includes("inline-tailwind"))
    expect(inline?.guidance.toLowerCase()).toMatch(/inline/)
  })
})

describe("check and baseline", () => {
  it("flags restyling Button padding against existing sizes", async () => {
    const root = await copyFixture()
    const engine = await createEngine(root)
    await engine.init({ approve: true })
    const result = await engine.check()
    expect(result.report.preservedArchitecture).toBe(true)
    expect(
      result.report.diagnostics.some((item) => item.title === "Button" && /padding|size/i.test(item.why)),
    ).toBe(true)
  })

  it("hides baseline debt from new-violation view", async () => {
    const root = await copyFixture()
    const engine = await createEngine(root)
    await engine.init({ approve: true })
    await engine.baseline()
    const result = await engine.check()
    expect(result.report.diagnostics.every((item) => item.baseline || item.severity === "info")).toBeTruthy()
  })
})

describe("drift", () => {
  it("proposes a Button variant update when the API changes", async () => {
    const root = await copyFixture()
    const engine = await createEngine(root)
    await engine.init({ approve: true })
    const buttonPath = path.join(root, "components/ui/button.tsx")
    const source = await fs.readFile(buttonPath, "utf8")
    await fs.writeFile(
      buttonPath,
      source.replace("ghost: \"bg-transparent\",", "ghost: \"bg-transparent\",\n        icon: \"size-9 p-0\","),
    )
    const preview = await engine.syncPreview()
    expect(preview.diff.changes.some((change) => change.name === "Button" && change.kind === "update")).toBe(true)
  })

  it("does not keep suggesting a rejected pattern", async () => {
    const root = await copyFixture()
    const engine = await createEngine(root)
    await engine.init()
    const preview = await engine.syncPreview()
    const pattern = preview.diff.changes.find((change) => change.entity === "pattern")
    if (pattern) {
      await engine.applyChanges([pattern.id], { reject: true, generate: false })
    } else {
      const model = await engine.load()
      const suggested = model?.patterns[0]
      expect(suggested).toBeTruthy()
      await engine.applyChanges([], { reject: false, generate: false })
    }
    const again = await engine.syncPreview()
    if (pattern) {
      expect(again.diff.changes.some((change) => change.fingerprint === pattern.fingerprint)).toBe(false)
    }
  })
})
