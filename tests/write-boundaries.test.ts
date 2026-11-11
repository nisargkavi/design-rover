import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  createEngine,
  emptyCanonical,
  saveCanonical,
  loadCanonical,
  writeGenerated,
  writeText,
} from "@design-rover/core"
const temporary: string[] = []
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})
async function setup() {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "rover-write-boundaries-"))
  temporary.push(parent)
  const root = path.join(parent, "repo")
  const outside = path.join(parent, "outside")
  await fs.mkdir(root)
  await fs.mkdir(outside)
  return { parent, root, outside }
}
describe("managed write boundaries", () => {
  it("rejects a linked AGENTS file before modifying any guidance", async () => {
    const { root, outside } = await setup()
    const note = path.join(outside, "notes.md")
    await fs.writeFile(note, "Human notes\n")
    await fs.symlink(note, path.join(root, "AGENTS.md"))
    await expect(writeGenerated(root, emptyCanonical(root, "test"))).rejects.toThrow(/symlink/)
    expect(await fs.readFile(note, "utf8")).toBe("Human notes\n")
    await expect(fs.stat(path.join(root, "CLAUDE.md"))).rejects.toMatchObject({ code: "ENOENT" })
  })
  it("rejects dangling linked adapters before creating their target or other files", async () => {
    const { root, outside } = await setup()
    await fs.mkdir(path.join(root, ".cursor/rules"), { recursive: true })
    const target = path.join(outside, "missing.mdc")
    await fs.symlink(target, path.join(root, ".cursor/rules/design-rover.mdc"))
    await expect(writeGenerated(root, emptyCanonical(root, "test"))).rejects.toThrow(/symlink/)
    await expect(fs.stat(target)).rejects.toMatchObject({ code: "ENOENT" })
    await expect(fs.stat(path.join(root, "AGENTS.md"))).rejects.toMatchObject({ code: "ENOENT" })
  })
  it("rejects symlinked adapter ancestors", async () => {
    const { root, outside } = await setup()
    await fs.symlink(outside, path.join(root, ".cursor"), "dir")
    await expect(writeGenerated(root, emptyCanonical(root, "test"))).rejects.toThrow(/symlink/)
    expect(await fs.readdir(outside)).toEqual([])
  })
  it("blocks reads and initialization through a linked canonical directory", async () => {
    const { root, outside } = await setup()
    await fs.symlink(outside, path.join(root, ".design-rover"), "dir")
    await expect(loadCanonical(root)).rejects.toThrow(/symlink/)
    await expect((await createEngine(root)).init()).rejects.toThrow(/symlink/)
    expect(await fs.readdir(outside)).toEqual([])
  })
  it("supports a symlink naming the repository root itself", async () => {
    const { parent, root } = await setup()
    const alias = path.join(parent, "alias")
    await fs.symlink(root, alias, "dir")
    await saveCanonical(alias, emptyCanonical(alias, "test"))
    await writeGenerated(alias, (await loadCanonical(alias))!)
    expect(await fs.readFile(path.join(root, "AGENTS.md"), "utf8")).toContain("Design Rover")
  })
  it("refuses invalid target types and paths outside the root before writes", async () => {
    const { root, outside } = await setup()
    await fs.mkdir(path.join(root, "AGENTS.md"))
    await expect(writeGenerated(root, emptyCanonical(root, "test"))).rejects.toThrow()
    await expect(fs.stat(path.join(root, "CLAUDE.md"))).rejects.toMatchObject({ code: "ENOENT" })
    await expect(writeText(path.join(outside, "notes"), "bad", root)).rejects.toThrow(/outside/)
    expect(await fs.readdir(outside)).toEqual([])
  })
})
