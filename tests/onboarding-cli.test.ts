import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { afterEach, describe, expect, it } from "vitest"
import { createEngine } from "@design-rover/core"

const execute = promisify(execFile)
const project = process.cwd()
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))) })

async function repository(options: { fixture?: boolean; files?: Record<string, string> } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "design-rover onboarding "))
  roots.push(root)
  if (options.fixture) await fs.cp(path.join(project, "fixtures/next-tailwind"), root, { recursive: true, filter: (file) => !file.includes("node_modules") && !file.includes(".design-rover") })
  for (const [file, content] of Object.entries(options.files ?? {})) {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true })
    await fs.writeFile(path.join(root, file), content)
  }
  return root
}

function cli(root: string, args: string[]) {
  return execute("bun", ["run", "design-rover", ...args, "--cwd", root], { cwd: project, env: { ...process.env, NO_COLOR: "1" }, maxBuffer: 1024 * 1024 })
}

const json = async (root: string, args: string[]) => JSON.parse((await cli(root, [...args, "--json"])).stdout)
const pending = (model: NonNullable<Awaited<ReturnType<Awaited<ReturnType<typeof createEngine>>["load"]>>>) => [...model.patterns, ...model.conventions, ...model.intents, ...model.exceptions].filter((item) => item.status === "inferred" || item.status === "suggested")

describe("CLI onboarding and readiness", () => {
  it("leaves first-init inferences unapproved and gives copyable Bun next steps", async () => {
    const root = await repository({ fixture: true })
    const result = await cli(root, ["init"])
    expect(result.stdout).toContain("Initialized repository design knowledge")
    expect(result.stdout).toContain("not approved policy")
    for (const command of ["diff", "generate", "context", "check"]) expect(result.stdout).toContain("bunx design-rover " + command)
    expect(result.stdout).toContain("--cwd '" + root + "'")
    const engine = await createEngine(root)
    const model = (await engine.load())!
    expect(pending(model).length).toBeGreaterThan(0)
    expect(model.system.generated).toEqual([])
  })

  it("reports canonical and observed counts separately on repeat init and preserves decisions", async () => {
    const root = await repository({ files: { "components/ui/Card.tsx": "export function Card() { return <div /> }" } })
    const first = await json(root, ["init"])
    expect(first.created).toBe(true)
    const engine = await createEngine(root)
    const original = (await engine.load())!
    original.components[0]!.notes = "Maintainer note"
    await engine.save(original)
    await fs.writeFile(path.join(root, "components/ui/Toast.tsx"), "export function Toast() { return <aside /> }")
    const repeat = await json(root, ["init", "--approve", "--generate"])
    expect(repeat.created).toBe(false)
    expect(repeat.counts.components).toBe(first.counts.components)
    expect(repeat.observedCounts.components).toBe(first.counts.components + 1)
    expect(repeat.ignoredOptions).toEqual(["--approve", "--generate"])
    expect(repeat.generatedFiles).toBe(0)
    expect(repeat.nextSteps.some((command: string) => command.startsWith("bunx design-rover diff"))).toBe(true)
    const after = (await engine.load())!
    expect(after.components[0]?.notes).toBe("Maintainer note")
    expect(after.system.generated).toEqual([])
    expect(pending(after)).toEqual(pending(original))
    const human = await cli(root, ["init"])
    expect(human.stdout).toContain("Existing canonical knowledge was preserved")
    expect(human.stdout).toContain("Current scan observed 2 components")
  })

  it("adapts the next steps when explicit initial approval and generation are complete", async () => {
    const root = await repository({ fixture: true })
    const initialized = await json(root, ["init", "--approve", "--generate"])
    expect(initialized.pending).toBe(0)
    expect(initialized.generatedFiles).toBeGreaterThan(0)
    expect(initialized.staleGenerated).toEqual([])
    expect(initialized.nextSteps.some((command: string) => command.startsWith("bunx design-rover generate"))).toBe(false)
    expect(initialized.nextSteps.some((command: string) => command.startsWith("bunx design-rover context"))).toBe(true)
    expect(initialized.nextSteps.at(-1)).toContain("bunx design-rover check")
  })

  it("makes partial APIs explicit and points to a real explainable ID", async () => {
    const root = await repository({ files: { "components/ui/RemoteCard.tsx": 'import type { RemoteProps } from "unavailable-library"; export function RemoteCard(props: RemoteProps) { return <div>{props.title}</div> }' } })
    const result = await json(root, ["init"])
    expect(result.apiResolution.partial + result.apiResolution.unresolved).toBe(1)
    const model = (await (await createEngine(root)).load())!
    const output = (await cli(root, ["init"])).stdout
    expect(output).toContain("partial or unresolved")
    expect(output).toContain("bunx design-rover explain " + model.components[0]!.id)
  })

  it("adds machine-readable readiness without replacing status or check fields", async () => {
    const root = await repository({ fixture: true })
    await json(root, ["init"])
    const model = (await (await createEngine(root)).load())!
    const status = await json(root, ["status"])
    expect(status.initialized).toBe(true)
    expect(Array.isArray(status.changes)).toBe(true)
    expect(status.readiness).toMatchObject({ pending: pending(model).length, generatedFiles: 0, staleGenerated: [] })
    expect(Object.values(status.readiness.apiResolution).reduce((total, count) => Number(total) + Number(count), 0)).toBe(model.components.length)
    const check = await json(root, ["check"])
    expect(check.preservedArchitecture).toBe(true)
    expect(Array.isArray(check.diagnostics)).toBe(true)
    expect(check.readiness).toEqual(status.readiness)
  })

  it("sync --yes accepts observed inventory without approving pending policies", async () => {
    const root = await repository({ fixture: true })
    const engine = await createEngine(root)
    await engine.init()
    const before = pending((await engine.load())!)
    expect(before.length).toBeGreaterThan(0)
    await fs.writeFile(path.join(root, "components/ui/Toast.tsx"), "export function Toast() { return <aside /> }")
    const result = await json(root, ["sync", "--yes"])
    expect(Array.isArray(result.changes)).toBe(true)
    const after = (await engine.load())!
    expect(after.components.some((component) => component.name === "Toast")).toBe(true)
    for (const item of before) expect(pending(after).some((record) => record.id === item.id && record.status === item.status)).toBe(true)
    expect(result.syncStatus).not.toBe("synchronized")
    expect(result.changes.some((change: { status: string }) => change.status === "inferred" || change.status === "suggested")).toBe(true)
  })

  it("requires --yes for noninteractive sync even when --approve was passed", async () => {
    const root = await repository({ fixture: true })
    const engine = await createEngine(root)
    await engine.init()
    const before = (await engine.load())!
    const output = await cli(root, ["sync", "--approve"])
    expect(output.stdout).toContain("Preview only. No changes were applied")
    expect(pending((await engine.load())!)).toEqual(pending(before))
    expect((await engine.load())!.system.generated).toEqual([])
    const accepted = await json(root, ["sync", "--yes", "--approve"])
    expect(accepted.syncStatus).toBe("synchronized")
    expect(pending((await engine.load())!)).toEqual([])
  })

  it("shows working individual decision commands after reviewing diff", async () => {
    const root = await repository({ fixture: true })
    const engine = await createEngine(root)
    await engine.init()
    const preview = await engine.syncPreview()
    const decision = preview.diff.changes.find((change) => change.entity !== "projection")!
    const output = (await cli(root, ["diff"])).stdout
    expect(output).toContain("[" + decision.id + "]")
    expect(output).toContain("bunx design-rover approve " + decision.id)
    expect(output).toContain("bunx design-rover reject " + decision.id)
    const before = pending((await engine.load())!).length
    await json(root, ["approve", decision.id])
    expect(pending((await engine.load())!).length).toBe(before - 1)
  })

  it("check and status disclose missing or stale agent guidance", async () => {
    const root = await repository()
    await json(root, ["init"])
    const check = (await cli(root, ["check"])).stdout
    expect(check).toContain("Agent guidance has not been generated yet")
    expect(check).toContain("bunx design-rover generate")
    const generated = await json(root, ["generate"])
    expect(Array.isArray(generated)).toBe(true)
    await fs.appendFile(path.join(root, ".agents/skills/design-rover/SKILL.md"), "\nChanged generated file\n")
    for (const command of ["check", "status"]) {
      const output = (await cli(root, [command])).stdout
      expect(output).toContain("generated files are stale")
      expect(output).toContain("bunx design-rover generate")
    }
    const checked = await json(root, ["check"])
    expect(checked.preservedArchitecture).toBe(true)
    expect(checked.readiness.staleGenerated).toContain(".agents/skills/design-rover/SKILL.md")
  })

  it("provides focused help and parseable JSON without initializing a repository", async () => {
    const root = await repository()
    const init = (await cli(root, ["init", "--help"])).stdout
    expect(init).toContain("Inferences remain pending")
    expect(init).toContain("--generate")
    expect(init).not.toContain("design-rover lint")
    const sync = await json(root, ["help", "sync"])
    expect(sync.command).toBe("sync")
    expect(sync.help).toContain("Pending inferences require explicit approval")
    const context = await json(root, ["context", "--help"])
    expect(context.help.replace(/\s+/g, " ")).toContain("does not scan source or prove freshness")
    await expect(fs.stat(path.join(root, ".design-rover"))).rejects.toMatchObject({ code: "ENOENT" })
  })
})
