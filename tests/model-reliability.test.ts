import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ComponentRecordSchema, ConventionRecordSchema, ExceptionRecordSchema, IntentRecordSchema, PatternRecordSchema, TokenRecordSchema, type CanonicalModel, type ObservedSnapshot } from "@design-rover/model"
import { createEngine } from "@design-rover/core"
import { analyzeComponents } from "../packages/core/src/analyzers/components.ts"
import { analyzePatterns } from "../packages/core/src/analyzers/patterns.ts"
import { extractFileEvidence } from "../packages/core/src/parse.ts"
import { diffModels } from "../packages/core/src/diff.ts"
import { applyChange, applyChanges } from "../packages/core/src/sync.ts"
import { emptyCanonical, loadCanonical, saveCanonical } from "../packages/core/src/store.ts"
import { specPaths } from "../packages/core/src/paths.ts"
import { checkSystem } from "../packages/core/src/check.ts"
import type { RepoEvidence } from "../packages/core/src/evidence.ts"

const roots: string[] = []
async function temporaryRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "rover-model-"))
  roots.push(root)
  return root
}
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

const component = (id: string, source = "components/ui/button.tsx") => ComponentRecordSchema.parse({
  id, name: "Button", source, importPath: `./${source}`, exportName: "Button",
  props: [{ name: "label", type: "string", required: false }],
  status: "observed", confidence: "high", originKind: "implementation",
})
const convention = (id = "convention.inline") => ConventionRecordSchema.parse({
  id, name: "Inline classes", category: "styling", observed: "10/10 usages", inference: "Prefer inline classes",
  suggestion: "Keep inline classes", guidance: "Use inline classes", status: "inferred", confidence: "high", originKind: "implementation",
})
function snapshot(model: CanonicalModel): ObservedSnapshot {
  return {
    analyzedAt: "2026-01-01T00:00:00.000Z", filesAnalyzed: 0, incremental: false, changedFiles: [],
    tokens: model.tokens, components: model.components, patterns: model.patterns, conventions: model.conventions,
    intents: model.intents, exceptions: model.exceptions,
    framework: model.system.framework, styling: model.system.styling,
    componentLibraries: model.system.componentLibraries, documentation: model.system.documentation,
  }
}
const evidenceFor = (sources: Record<string, string>): RepoEvidence => ({
  root: "/repo", tsconfigPaths: {}, files: Object.entries(sources).map(([relative, content]) =>
    extractFileEvidence({ relative, content, hash: relative, kind: "script" })),
})

describe("entity identity and contract drift", () => {
  it("keeps same-named component identities stable when traversal order changes", () => {
    const evidence = evidenceFor({
      "features/a/Button.tsx": "export function Button(){return <button/>}",
      "features/b/Button.tsx": "export function Button(){return <button/>}",
    })
    const first = analyzeComponents(evidence, [])
    const second = analyzeComponents({ ...evidence, files: [...evidence.files].reverse() }, [])
    expect(first).toHaveLength(2)
    expect(new Set(first.map((item) => item.id)).size).toBe(2)
    expect(first.map((item) => [item.source, item.id]).sort()).toEqual(second.map((item) => [item.source, item.id]).sort())
  })

  it("updates the right same-named component and preserves its legacy canonical ID", () => {
    const model = emptyCanonical("/repo", "repo")
    model.components = [component("component.button", "a.tsx"), component("component.button-b", "b.tsx")]
    const observed = snapshot(model)
    observed.components = [
      { ...model.components[0]!, id: "component.new-a", variants: ["danger"] },
      { ...model.components[1]!, id: "component.new-b" },
    ]
    const changes = diffModels(observed, model).changes
    expect(changes).toHaveLength(1)
    expect(changes[0]!.before).toMatchObject({ id: "component.button", source: "a.tsx" })
    expect(changes[0]!.after).toMatchObject({ id: "component.button", source: "a.tsx" })
    const accepted = applyChange(model, changes[0]!)
    expect(accepted.components).toHaveLength(2)
    expect(accepted.components.find((item) => item.source === "b.tsx")!.variants).toEqual([])
    expect(accepted.components.find((item) => item.id === "component.button")!.variants).toEqual(["danger"])
  })

  it.each([
    { type: "number" }, { required: true }, { values: ["one", "two"] }, { defaultValue: "hello" },
  ])("detects the prop contract change %j", (contract) => {
    const model = emptyCanonical("/repo", "repo")
    model.components = [component("component.button")]
    const observed = snapshot(model)
    observed.components = [{ ...model.components[0]!, props: [{ ...model.components[0]!.props[0]!, ...contract }] }]
    const changes = diffModels(observed, model).changes
    expect(changes).toHaveLength(1)
    expect(changes[0]!.details).toContain("Changed prop contract: label")
    expect(checkSystem(observed, model).diagnostics.some((item) => item.id === "api-component.button")).toBe(true)
  })

  it("gives separate same-named pattern clusters distinct IDs", () => {
    const evidence = evidenceFor({ "a.tsx": "", "b.tsx": "", "c.tsx": "", "d.tsx": "" })
    for (const [index, file] of evidence.files.entries()) file.sections = [{
      file: file.relative, nameHint: "Summary", startLine: 1, depth: 0,
      tags: index < 2 ? ["section", "div"] : ["table", "tr"],
      components: index < 2 ? ["Button"] : ["DataCell"],
      classFamilies: index < 2 ? ["spacing", "layout"] : ["border", "typography"], childCount: index < 2 ? 2 : 6,
    }]
    const patterns = analyzePatterns(evidence)
    expect(patterns).toHaveLength(2)
    expect(patterns.map((item) => item.name)).toEqual(["Summary", "Summary"])
    expect(new Set(patterns.map((item) => item.id)).size).toBe(2)
  })
})

describe("canonical approval lifecycle", () => {
  it("accepts code observations without downgrading approval or losing human annotations", () => {
    const model = emptyCanonical("/repo", "repo")
    model.conventions = [{ ...convention(), status: "approved", approvedBy: "reviewer", notes: "team decision", guidance: "Human-authored policy" }]
    const observed = snapshot(model)
    observed.conventions = [{ ...convention(), observed: "11/11 usages", guidance: "Automatic suggestion" }]
    const changes = diffModels(observed, model).changes
    const accepted = applyChange(model, changes[0]!)
    expect(accepted.conventions[0]).toMatchObject({ status: "approved", approvedBy: "reviewer", notes: "team decision", guidance: "Human-authored policy", observed: "11/11 usages" })
    expect(diffModels(observed, accepted).changes).toEqual([])
  })

  it("preserves approved pattern policy while refreshing structural observations", () => {
    const model = emptyCanonical("/repo", "repo")
    const pattern = PatternRecordSchema.parse({
      id: "pattern.summary", name: "Summary", fingerprint: "before", status: "approved", confidence: "high", originKind: "implementation",
      guidance: "Team-specific guidance", architecture: "already-extracted", implementation: "shared-component",
    })
    model.patterns = [pattern]
    const observed = snapshot(model)
    observed.patterns = [{ ...pattern, fingerprint: "after", status: "suggested", guidance: "Generic suggestion", architecture: "do-not-extract", implementation: "colocated" }]
    const accepted = applyChange(model, diffModels(observed, model).changes[0]!)
    expect(accepted.patterns[0]).toMatchObject({ fingerprint: "after", status: "approved", guidance: "Team-specific guidance", architecture: "already-extracted", implementation: "shared-component" })
    expect(diffModels(observed, accepted).changes).toEqual([])
  })

  it("offers removal of vanished pending inferences without retiring human-authored policy", async () => {
    const root = await temporaryRoot()
    const model = emptyCanonical(root, "repo")
    model.conventions = [convention(), { ...convention("convention.human"), originKind: "human", status: "approved" }]
    const observed = { ...snapshot(model), conventions: [] }
    const changes = diffModels(observed, model).changes
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ kind: "remove", name: "Inline classes" })
    const retired = await applyChanges(root, model, changes, { ids: ["convention.inline"], generate: false })
    expect(retired.conventions.map((item) => item.id)).toEqual(["convention.human"])
  })

  it("preserves approved intent requirements and exception scope during evidence updates", () => {
    let model = emptyCanonical("/repo", "repo")
    model.intents = [IntentRecordSchema.parse({
      id: "intent.hero", subject: "Hero.visual", type: "image", required: true, productionAssetRequired: true,
      status: "approved", confidence: "high", originKind: "implementation", intentStatus: "placeholder",
    })]
    model.exceptions = [ExceptionRecordSchema.parse({
      id: "exception.hero", name: "Hero override", reason: "Maintainer decision", allows: ["restyle-spacing"],
      scope: { paths: ["hero.tsx"], components: ["Hero"] }, status: "approved", confidence: "high", originKind: "implementation",
    })]
    const observed = snapshot(model)
    observed.intents = [{ ...model.intents[0]!, required: false, productionAssetRequired: false, intentStatus: "resolved" }]
    observed.exceptions = [{ ...model.exceptions[0]!, reason: "Scanner guess", allows: ["*"], scope: { paths: ["**"], components: [] }, evidence: [{ id: "new", kind: "comment", description: "updated source evidence" }] }]
    for (const change of diffModels(observed, model).changes) model = applyChange(model, change)
    expect(model.intents[0]).toMatchObject({ required: true, productionAssetRequired: true, intentStatus: "resolved", status: "approved" })
    expect(model.exceptions[0]).toMatchObject({ reason: "Maintainer decision", allows: ["restyle-spacing"], scope: { paths: ["hero.tsx"], components: ["Hero"] } })
    expect(diffModels(observed, model).changes).toEqual([])
  })

  it("marks existing diagnostics as unchanged for an explicitly empty PR change set", () => {
    const model = emptyCanonical("/repo", "repo")
    model.components = [component("component.button")]
    const observed = snapshot(model)
    observed.components = [{ ...model.components[0]!, variants: ["new"] }]
    expect(checkSystem(observed, model, { changedFiles: [] }).diagnostics[0]?.introducedByChange).toBe(false)
    expect(checkSystem(observed, model).diagnostics[0]?.introducedByChange).toBeUndefined()
  })

  it("does not attribute unchanged component usage warnings to an unrelated PR", async () => {
    const root = await temporaryRoot()
    await fs.mkdir(path.join(root, "components"))
    await fs.writeFile(path.join(root, "components/button.tsx"), "export function Button(){return <button/>}")
    await fs.writeFile(path.join(root, "Page.tsx"), 'import { Button } from "./components/button"; export const Page = () => <Button className="p-8"/>')
    for (const args of [["init", "-q"], ["config", "user.name", "Test"], ["config", "user.email", "test@example.invalid"], ["add", "."], ["commit", "-qm", "initial"]]) execFileSync("git", args, { cwd: root })
    await fs.writeFile(path.join(root, "README.md"), "Unrelated documentation change")
    execFileSync("git", ["add", "README.md"], { cwd: root })
    execFileSync("git", ["commit", "-qm", "docs"], { cwd: root })
    const model = emptyCanonical(root, "repo")
    model.components = [{ ...component("component.button", "components/button.tsx"), sizes: ["sm", "lg"] }]
    await saveCanonical(root, model)
    const { report } = await (await createEngine(root)).check({ base: "HEAD~1" })
    const usage = report.diagnostics.find((item) => item.title === "Button" && /spacing|padding/i.test(item.why))
    expect(usage).toBeDefined()
    expect(usage!.introducedByChange).toBe(false)
  })

  it("approves and rejects initial pending records by canonical ID and rejects unknown IDs", async () => {
    const root = await temporaryRoot()
    const model = emptyCanonical(root, "repo")
    model.conventions = [convention(), { ...convention("convention.second"), name: "Another convention" }]
    const observed = snapshot(model)
    let changes = diffModels(observed, model).changes
    expect(diffModels(observed, model).syncStatus).toBe("pending-review")
    const approved = await applyChanges(root, model, changes, { ids: ["convention.inline"], generate: false })
    expect(approved.conventions.find((item) => item.id === "convention.inline")!.status).toBe("approved")
    expect(approved.conventions.find((item) => item.id === "convention.second")!.status).toBe("inferred")
    changes = diffModels(observed, approved).changes
    const rejected = await applyChanges(root, approved, changes, { ids: ["convention.second"], reject: true, generate: false })
    expect(rejected.conventions.find((item) => item.id === "convention.second")!.status).toBe("rejected")
    expect(rejected.history.at(-1)!.type).toBe("rejected")
    expect(diffModels(observed, rejected).changes).toEqual([])
    await expect(applyChanges(root, rejected, [], { ids: ["convention.unknown"], generate: false })).rejects.toThrow(/No pending/)
  })

  it("repeated init preserves existing knowledge, approvals and rejected suggestions", async () => {
    const root = await temporaryRoot()
    await fs.writeFile(path.join(root, "Button.tsx"), "export function Button(){return <button/>}")
    const engine = await createEngine(root)
    await engine.init()
    const model = (await engine.load())!
    model.conventions = [{ ...convention(), guidance: "Human-authored policy", status: "approved" }]
    model.history.push({ ts: "2026-01-01", type: "review", summary: "human decision" })
    await engine.save(model)
    const before = await engine.load()
    await fs.writeFile(path.join(root, "Button.tsx"), "export function Button(){return <button className='p-2'/>}")
    await engine.init({ approve: true })
    expect(await engine.load()).toEqual(before)
  })

  it("fails explicitly when checking a snippet without a canonical model", async () => {
    const engine = await createEngine(await temporaryRoot())
    await expect(engine.checkSnippet("<Button/>", "page.tsx")).rejects.toThrow(/not initialized/)
  })
})

describe("canonical storage integrity", () => {
  it("does not create canonical directories when reading an absent repository", async () => {
    const missing = path.join(await temporaryRoot(), "absent")
    expect(await loadCanonical(missing)).toBeUndefined()
    await expect(fs.stat(missing)).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("rejects a concurrent read during partial installation instead of exposing hybrid data", async () => {
    const root = await temporaryRoot()
    const model = emptyCanonical(root, "repo")
    model.components = [component("component.a", "a.tsx"), component("component.b", "b.tsx")]
    await saveCanonical(root, model)
    const renameOriginal = fs.rename.bind(fs)
    let calls = 0
    let attempted = false
    vi.spyOn(fs, "rename").mockImplementation(async (...args) => {
      if (++calls === 2) {
        attempted = true
        await expect(loadCanonical(root)).rejects.toThrow(/busy with another read or write/)
      }
      return renameOriginal(...args)
    })
    const updated = { ...model, components: model.components.map((item) => ({ ...item, variants: ["new"] })) }
    await saveCanonical(root, updated)
    expect(attempted).toBe(true)
    expect(await loadCanonical(root)).toEqual(updated)
  })

  it("preserves user gitignore exclusions during later saves", async () => {
    const root = await temporaryRoot()
    const model = emptyCanonical(root, "repo")
    await saveCanonical(root, model)
    const file = specPaths(root).gitignore
    await fs.appendFile(file, "# private team notes\nprivate-notes.json\n")
    await saveCanonical(root, model)
    const content = await fs.readFile(file, "utf8")
    expect(content).toContain("# private team notes\nprivate-notes.json\n")
    expect(content.split("\n").filter((line) => line === "cache/")).toHaveLength(1)
  })
  it("round-trips same-named entities and scoped tokens without record loss", async () => {
    const root = await temporaryRoot()
    const model = emptyCanonical(root, "repo")
    model.components = [component("component.a", "a.tsx"), component("component.b", "b.tsx")]
    model.patterns = ["one", "two"].map((id) => PatternRecordSchema.parse({ id: `pattern.${id}`, name: "Summary", fingerprint: id, status: "suggested", confidence: "medium", originKind: "implementation" }))
    model.tokens = [":root", ".dark"].map((scope, index) => TokenRecordSchema.parse({
      id: `token.primary-${index}`, name: "--color-primary", scope, mode: index ? "dark" : "light",
      value: index ? "blue" : "red", category: "semantic-color", origin: "theme.css",
      status: "observed", confidence: "high", originKind: "implementation",
    }))
    await saveCanonical(root, model)
    expect(await loadCanonical(root)).toEqual(model)
  })

  it("rejects duplicate IDs before touching canonical files", async () => {
    const root = await temporaryRoot()
    const model = emptyCanonical(root, "repo")
    model.components = [component("component.button")]
    await saveCanonical(root, model)
    const before = await fs.readFile(specPaths(root).system, "utf8")
    await expect(saveCanonical(root, { ...model, components: [...model.components, { ...model.components[0]!, source: "other.tsx" }] })).rejects.toThrow(/Duplicate/)
    expect(await fs.readFile(specPaths(root).system, "utf8")).toBe(before)
    expect((await loadCanonical(root))!.components).toHaveLength(1)
  })

  it("reports corrupt record JSON and refuses to silently prune it", async () => {
    const root = await temporaryRoot()
    const model = emptyCanonical(root, "repo")
    model.components = [component("component.button")]
    await saveCanonical(root, model)
    const file = path.join(specPaths(root).components, "button.json")
    await fs.writeFile(file, "{ broken")
    await expect(loadCanonical(root)).rejects.toThrow(/button\.json/)
    await expect(saveCanonical(root, { ...model, components: [] })).rejects.toThrow(/button\.json/)
    expect(await fs.readFile(file, "utf8")).toBe("{ broken")
  })

  it("keeps obsolete records when installing replacement files fails", async () => {
    const root = await temporaryRoot()
    const model = emptyCanonical(root, "repo")
    model.components = [component("component.old")]
    await saveCanonical(root, model)
    const rename = vi.spyOn(fs, "rename").mockRejectedValueOnce(new Error("simulated installation failure"))
    await expect(saveCanonical(root, { ...model, components: [component("component.new")] })).rejects.toThrow(/installation failure/)
    rename.mockRestore()
    expect((await loadCanonical(root))!.components.map((item) => item.id)).toEqual(["component.old"])
    expect((await fs.readdir(specPaths(root).dir)).some((file) => file.startsWith(".write"))).toBe(false)
  })

  it("rolls back a partial installation without leaving a hybrid model", async () => {
    const root = await temporaryRoot()
    const model = emptyCanonical(root, "repo")
    model.components = [component("component.a", "a.tsx"), component("component.b", "b.tsx")]
    await saveCanonical(root, model)
    const renameOriginal = fs.rename.bind(fs)
    let calls = 0
    vi.spyOn(fs, "rename").mockImplementation(async (...args) => {
      if (++calls === 2) throw new Error("mid-install failure")
      return renameOriginal(...args)
    })
    await expect(saveCanonical(root, { ...model, components: model.components.map((item) => ({ ...item, variants: ["new"] })) })).rejects.toThrow(/mid-install/)
    expect(await loadCanonical(root)).toEqual(model)
    expect((await fs.readdir(specPaths(root).dir)).some((file) => file.startsWith(".write"))).toBe(false)
  })

  it("retains recovery bytes and blocks further reads if rollback itself fails", async () => {
    const root = await temporaryRoot()
    const model = emptyCanonical(root, "repo")
    model.components = [component("component.a", "a.tsx"), component("component.b", "b.tsx")]
    await saveCanonical(root, model)
    const renameOriginal = fs.rename.bind(fs)
    let calls = 0
    vi.spyOn(fs, "rename").mockImplementation(async (...args) => {
      if ([2, 3].includes(++calls)) throw new Error("simulated filesystem failure")
      return renameOriginal(...args)
    })
    await expect(saveCanonical(root, { ...model, components: model.components.map((item) => ({ ...item, variants: ["new"] })) })).rejects.toThrow(/Retained recovery backup/)
    const marker = JSON.parse(await fs.readFile(path.join(specPaths(root).dir, ".recovery-required.json"), "utf8"))
    const manifest = JSON.parse(await fs.readFile(marker.manifest, "utf8"))
    const backup = manifest.files.find((item: { path: string }) => item.path === "components/a.json").backup
    expect(JSON.parse(await fs.readFile(path.join(marker.backup, backup), "utf8")).variants).toEqual([])
    await expect(loadCanonical(root)).rejects.toThrow(/needs recovery/)
  })

  it("prunes removed records only after valid replacements are installed", async () => {
    const root = await temporaryRoot()
    const model = emptyCanonical(root, "repo")
    model.components = [component("component.old")]
    await saveCanonical(root, model)
    await saveCanonical(root, { ...model, components: [component("component.new")] })
    expect(await fs.readdir(specPaths(root).components)).toEqual(["new.json"])
    expect((await loadCanonical(root))!.components.map((item) => item.id)).toEqual(["component.new"])
  })
})
