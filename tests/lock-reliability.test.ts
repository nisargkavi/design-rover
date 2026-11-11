import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ComponentRecordSchema } from "@design-rover/model"
import { emptyCanonical, loadCanonical, saveCanonical } from "../packages/core/src/store.ts"
import { specPaths } from "../packages/core/src/paths.ts"

const roots: string[] = []
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "rover-lock-"))
  roots.push(root)
  const model = emptyCanonical(root, "lock-fixture")
  model.components = ["one", "two"].map((name) => ComponentRecordSchema.parse({
    id: `component.${name}`, name, source: `${name}.tsx`, importPath: `./${name}`, exportName: name,
    status: "observed", confidence: "high", originKind: "implementation", variants: ["old"],
  }))
  await saveCanonical(root, model)
  return { root, model, lockFile: path.join(specPaths(root).dir, ".write.lock") }
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe("canonical lock contention", () => {
  it("queues short-lived parallel readers without reporting a busy model", async () => {
    const { root, model } = await fixture()
    const models = await Promise.all(Array.from({ length: 8 }, () => loadCanonical(root)))
    expect(models).toEqual(Array.from({ length: 8 }, () => model))
  })

  it("waits for a partially installed save and returns a complete snapshot", async () => {
    const { root, model } = await fixture()
    const updated = { ...model, components: model.components.map((item) => ({ ...item, variants: ["new"] })) }
    let releaseWrite!: () => void
    let reportPaused!: () => void
    const gate = new Promise<void>((resolve) => { releaseWrite = resolve })
    const paused = new Promise<void>((resolve) => { reportPaused = resolve })
    const renameOriginal = fs.rename.bind(fs)
    let replacements = 0
    vi.spyOn(fs, "rename").mockImplementation(async (...args) => {
      if (++replacements === 2) {
        reportPaused()
        await gate
      }
      return renameOriginal(...args)
    })
    const write = saveCanonical(root, updated)
    await paused
    let readFinished = false
    const read = loadCanonical(root).then((result) => { readFinished = true; return result })
    try {
      await delay(60)
      expect(readFinished).toBe(false)
    } finally { releaseWrite() }
    await write
    expect(await read).toEqual(updated)
  })

  it("queues a writer until an existing reader releases its lock", async () => {
    const { root, model, lockFile } = await fixture()
    const held = await fs.open(lockFile, "wx")
    const updated = { ...model, system: { ...model.system, repository: { name: "updated" } } }
    let writeFinished = false
    const write = saveCanonical(root, updated).then(() => { writeFinished = true })
    try {
      await delay(60)
      expect(writeFinished).toBe(false)
      const stored = JSON.parse(await fs.readFile(specPaths(root).system, "utf8"))
      expect(stored.repository.name).toBe(model.system.repository.name)
    } finally {
      await held.close()
      await fs.rm(lockFile)
    }
    await write
    expect(await loadCanonical(root)).toEqual(updated)
  })

  it("times out without deleting an abandoned lock or changing canonical bytes", async () => {
    const { root, model, lockFile } = await fixture()
    const original = await fs.readFile(specPaths(root).system, "utf8")
    await fs.writeFile(lockFile, "owner-is-not-known-to-be-dead", { flag: "wx" })
    const results = await Promise.allSettled([loadCanonical(root), saveCanonical(root, model)])
    for (const result of results) {
      expect(result.status).toBe("rejected")
      if (result.status === "rejected") expect(String(result.reason)).toMatch(/after waiting 1500ms.*stale lock/)
    }
    expect(await fs.readFile(lockFile, "utf8")).toBe("owner-is-not-known-to-be-dead")
    expect(await fs.readFile(specPaths(root).system, "utf8")).toBe(original)
  }, 5000)
})
