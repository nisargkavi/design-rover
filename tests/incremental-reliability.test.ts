import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { afterEach, describe, expect, it } from "vitest"
import { analyzeRepository } from "../packages/core/src/analyze.ts"
import { gitChangedFiles } from "../packages/core/src/fs.ts"
import { loadCache } from "../packages/core/src/cache.ts"
import { collectEvidence, discoverFiles } from "../packages/core/src/scan.ts"
import { specPaths } from "../packages/core/src/paths.ts"
import type { ObservedSnapshot } from "@design-rover/model"

const execute = promisify(execFile)
const roots: string[] = []

async function write(root: string, file: string, content: string) {
  await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true })
  await fs.writeFile(path.join(root, file), content)
}

async function git(root: string, ...args: string[]) {
  return (await execute("git", args, { cwd: root })).stdout.trim()
}

async function commit(root: string, message: string) {
  await git(root, "add", ".")
  await git(root, "-c", "user.name=Design Rover Test", "-c", "user.email=test@example.invalid", "commit", "-m", message)
  return git(root, "rev-parse", "HEAD")
}

async function fixture(withGit = true) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "design-rover-incremental-"))
  roots.push(root)
  await write(root, "package.json", JSON.stringify({ name: "test-ui", dependencies: { react: "19" } }))
  await write(root, ".gitignore", ".design-rover/\nignored/\n")
  await write(root, "components/ui/Button.tsx", 'export function Button() { return <button>Save</button> }\n')
  await write(root, "components/ui/Card.tsx", 'export function Card() { return <article>Card</article> }\n')
  if (withGit) {
    await git(root, "init", "--initial-branch=main")
    await commit(root, "initial")
  }
  return root
}

function knowledge(snapshot: ObservedSnapshot) {
  const { analyzedAt: _at, incremental: _incremental, changedFiles: _changed, ...rest } = snapshot
  return rest
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe("incremental repository reconciliation", () => {
  it("matches a full scan after deleted, renamed and new untracked components", async () => {
    const root = await fixture()
    await analyzeRepository(root)
    await fs.rm(path.join(root, "components/ui/Button.tsx"))
    await fs.rename(path.join(root, "components/ui/Card.tsx"), path.join(root, "components/ui/Panel.tsx"))
    await write(root, "components/ui/NewWidget.tsx", 'export function NewWidget() { return <div>New</div> }')
    const incremental = await analyzeRepository(root, { incremental: true })
    const full = await analyzeRepository(root)
    expect(incremental.snapshot.incremental).toBe(true)
    expect(knowledge(incremental.snapshot)).toEqual(knowledge(full.snapshot))
    expect(incremental.snapshot.components.some((item) => item.name === "Button")).toBe(false)
    expect(incremental.snapshot.components.some((item) => item.name === "NewWidget")).toBe(true)
    expect(incremental.snapshot.components.find((item) => item.name === "Card")?.source).toBe("components/ui/Panel.tsx")
    expect(incremental.snapshot.changedFiles).toEqual(expect.arrayContaining(["components/ui/Button.tsx", "components/ui/Card.tsx", "components/ui/Panel.tsx", "components/ui/NewWidget.tsx"]))
  })

  it("refreshes after clean committed changes and branch switches", async () => {
    const root = await fixture()
    const original = await git(root, "rev-parse", "HEAD")
    await analyzeRepository(root)
    await write(root, "components/ui/Committed.tsx", 'export function Committed() { return <span>Committed</span> }')
    await commit(root, "new component")
    expect(await gitChangedFiles(root)).toEqual([])
    const changed = await analyzeRepository(root, { incremental: true })
    expect(changed.snapshot.components.some((item) => item.name === "Committed")).toBe(true)
    expect(changed.snapshot.changedFiles).toContain("components/ui/Committed.tsx")
    await git(root, "checkout", "--detach", original)
    const switched = await analyzeRepository(root, { incremental: true })
    const full = await analyzeRepository(root)
    expect(knowledge(switched.snapshot)).toEqual(knowledge(full.snapshot))
    expect(switched.snapshot.components.some((item) => item.name === "Committed")).toBe(false)
  })

  it("reconciles non-Git files and changed ignore rules", async () => {
    const root = await fixture(false)
    await analyzeRepository(root)
    await write(root, ".gitignore", ".design-rover/\ncomponents/ui/Card.tsx\n")
    await write(root, "New.tsx", 'export function New() { return <div /> }')
    const incremental = await analyzeRepository(root, { incremental: true })
    const full = await analyzeRepository(root)
    expect(knowledge(incremental.snapshot)).toEqual(knowledge(full.snapshot))
    expect(incremental.snapshot.components.map((item) => item.name)).not.toContain("Card")
    expect(incremental.snapshot.components.map((item) => item.name)).toContain("New")
  })

  it("does not replace the complete cache with an explicit partial scan", async () => {
    const root = await fixture()
    await analyzeRepository(root)
    const original = await loadCache(root)
    await analyzeRepository(root, { files: ["components/ui/Button.tsx"], incremental: true })
    expect(await loadCache(root)).toEqual(original)
    const incremental = await analyzeRepository(root, { incremental: true })
    expect(incremental.snapshot.components.map((item) => item.name)).toEqual(expect.arrayContaining(["Button", "Card"]))
  })

  it("discards obsolete or malformed caches and safely rebuilds", async () => {
    const root = await fixture()
    const full = await analyzeRepository(root)
    const file = path.join(specPaths(root).cache, "evidence.json")
    await fs.writeFile(file, JSON.stringify({ version: 1, files: [] }))
    expect(await loadCache(root)).toBeUndefined()
    const fromOld = await analyzeRepository(root, { incremental: true })
    expect(knowledge(fromOld.snapshot)).toEqual(knowledge(full.snapshot))
    const malformed = JSON.parse(await fs.readFile(file, "utf8"))
    malformed.files[0].components = "broken"
    await fs.writeFile(file, JSON.stringify(malformed))
    expect(await loadCache(root)).toBeUndefined()
    const repaired = await analyzeRepository(root, { incremental: true })
    expect(knowledge(repaired.snapshot)).toEqual(knowledge(full.snapshot))
  })
})

describe("Git change discovery", () => {
  it("includes committed deletion and both rename sides without corrupting whitespace paths", async () => {
    const root = await fixture()
    await write(root, "components/ui/ Old name .tsx", "export const value = 1\n")
    const base = await commit(root, "whitespace path")
    await git(root, "mv", "components/ui/ Old name .tsx", "components/ui/Renamed\nname.tsx")
    await fs.rm(path.join(root, "components/ui/Button.tsx"))
    await commit(root, "move and delete")
    await write(root, "components/ui/ untracked .tsx", "export const value = 2\n")
    const changed = await gitChangedFiles(root, base)
    expect(changed).toEqual(expect.arrayContaining(["components/ui/ Old name .tsx", "components/ui/Renamed\nname.tsx", "components/ui/Button.tsx", "components/ui/ untracked .tsx"]))
  })

  it("supports new Git repositories before the first commit", async () => {
    const root = await fixture(false)
    await git(root, "init", "--initial-branch=main")
    await git(root, "add", "components/ui/Button.tsx")
    expect(await gitChangedFiles(root)).toEqual(expect.arrayContaining(["components/ui/Button.tsx", "components/ui/Card.tsx"]))
  })

  it("reports invalid bases rather than an empty successful comparison", async () => {
    const root = await fixture()
    await analyzeRepository(root)
    await expect(gitChangedFiles(root, "missing-branch")).rejects.toThrow(/missing-branch/)
    await expect(analyzeRepository(root, { base: "" })).rejects.toThrow(/must not be empty/)
    await expect(analyzeRepository(root, { incremental: true, base: "missing-branch" })).rejects.toThrow(/missing-branch/)
    const nonGit = await fixture(false)
    await expect(gitChangedFiles(nonGit, "main")).rejects.toThrow(/not a Git repository/)
  })
})

describe("generated knowledge is not source evidence", () => {
  it("excludes canonical knowledge and generated adapters", async () => {
    const root = await fixture(false)
    await write(root, ".design-rover/generated/Fake.tsx", "export function Fake() { return <div /> }")
    await write(root, ".cursor/rules/design-rover.mdc", "TODO generated rover")
    const files = await discoverFiles(root)
    expect(files.some((file) => file.startsWith(".design-rover/") || file.includes("design-rover.mdc"))).toBe(false)
  })

  it("keeps human AGENTS text but strips current and legacy managed blocks", async () => {
    const root = await fixture(false)
    await write(root, "AGENTS.md", "TODO human guidance\n<!-- design-rover:start -->\nTODO generated current\n<!-- design-rover:end -->\n")
    await write(root, "CLAUDE.md", "<!-- design-rover:start -->\nTODO generated only\n<!-- design-rover:end -->\n")
    const evidence = await collectEvidence(root)
    const agents = evidence.files.find((file) => file.relative === "AGENTS.md")
    expect(agents?.comments.map((item) => item.text)).toEqual(["TODO human guidance"])
    expect(evidence.files.some((file) => file.relative === "CLAUDE.md")).toBe(false)
  })
})
