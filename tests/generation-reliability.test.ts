import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { createEngine, writeGenerated } from "@design-rover/core"

const dirs: string[] = []
async function root() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rover-generation-"))
  dirs.push(dir)
  return dir
}
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }))) })

describe("Design Rover generated guidance", () => {
  it("uses the canonical directory and produces stable guidance", async () => {
    const dir = await root()
    const engine = await createEngine(dir)
    await engine.init({ approve: true, generate: true })
    expect(await fs.stat(path.join(dir, ".design-rover/system.json"))).toBeTruthy()
    expect(await engine.generatedStale()).toEqual([])
    const skill = await fs.readFile(path.join(dir, ".agents/skills/design-rover/SKILL.md"), "utf8")
    expect(skill).toContain("name: design-rover")
    await fs.appendFile(path.join(dir, "AGENTS.md"), "\nUser notes outside managed block.\n")
    expect(await engine.generatedStale()).toEqual([])
  })

  it("replaces duplicate managed blocks once while preserving surrounding notes", async () => {
    const dir = await root()
    const engine = await createEngine(dir)
    await engine.init({ generate: false })
    await fs.writeFile(path.join(dir, "AGENTS.md"), "# Team notes\nKeep these notes.\n\n<!-- design-rover:start -->\nPrevious guidance\n<!-- design-rover:end -->\n\nMiddle notes.\n<!-- design-rover:start -->\nDuplicate guidance\n<!-- design-rover:end -->\nFooter notes.\n")
    await engine.generate()
    const agents = await fs.readFile(path.join(dir, "AGENTS.md"), "utf8")
    expect(agents).toContain("Keep these notes.")
    expect(agents).toContain("Middle notes.")
    expect(agents).toContain("Footer notes.")
    expect(agents.match(/<!-- design-rover:start -->/g)).toHaveLength(1)
    expect(await engine.generatedStale()).toEqual([])
  })

  it("preflights customized adapters before changing other guidance", async () => {
    const dir = await root()
    const engine = await createEngine(dir)
    await engine.init({ approve: true, generate: true })
    const skill = path.join(dir, ".agents/skills/design-rover/SKILL.md")
    await fs.appendFile(skill, "User customization\n")
    const before = await fs.readFile(path.join(dir, "AGENTS.md"), "utf8")
    await expect(engine.generate()).rejects.toThrow(/untracked edits/)
    expect(await fs.readFile(path.join(dir, "AGENTS.md"), "utf8")).toBe(before)
    expect(await fs.readFile(skill, "utf8")).toContain("User customization")
  })

  it("reports an enabled adapter as stale until it is generated", async () => {
    const dir = await root()
    const engine = await createEngine(dir)
    await engine.init({ generate: false })
    const model = (await engine.load())!
    model.system.generate.skill = false
    await engine.save(model)
    await engine.generate()
    const next = (await engine.load())!
    next.system.generate.skill = true
    await engine.save(next)
    expect(await engine.generatedStale()).toContain(".agents/skills/design-rover/SKILL.md")
    await engine.generate()
    expect(await engine.generatedStale()).toEqual([])
  })

  it("preflights malformed managed blocks before writing other guidance", async () => {
    const dir = await root()
    const engine = await createEngine(dir)
    await engine.init({ generate: false })
    await fs.writeFile(path.join(dir, "AGENTS.md"), "Human text\n<!-- design-rover:start -->\nUnclosed block")
    await expect(engine.generate()).rejects.toThrow(/Unclosed/)
    await expect(fs.stat(path.join(dir, "CLAUDE.md"))).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("can preview generation without writing projections or changing the model", async () => {
    const dir = await root()
    const engine = await createEngine(dir)
    await engine.init({ generate: false })
    const model = (await engine.load())!
    const preview = await writeGenerated(dir, model, { dryRun: true })
    expect(preview.files).toHaveLength(8)
    await expect(fs.stat(path.join(dir, "AGENTS.md"))).rejects.toMatchObject({ code: "ENOENT" })
    expect((await engine.load())?.system.generated).toEqual([])
  })
})
