import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { execFile, spawn } from "node:child_process"
import { promisify } from "node:util"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ComponentRecordSchema, ConventionRecordSchema, type ModelChange } from "@design-rover/model"
import { createEngine } from "../packages/core/src/engine.ts"
import { emptyCanonical, loadCanonical, saveCanonical } from "../packages/core/src/store.ts"
import { applyChanges } from "../packages/core/src/sync.ts"

const roots: string[] = []
const run = promisify(execFile)
async function rootFor(name: string, copyFixture = false) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `rover-lifecycle-${name}-`))
  roots.push(root)
  if (copyFixture) await fs.cp(path.join(process.cwd(), "fixtures/next-tailwind"), root, {
    recursive: true, filter: (source) => !source.includes("node_modules") && !source.includes(".design-rover"),
  })
  return root
}
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe("approved decision identity and review", () => {
  it("migrates legacy line IDs through sync while keeping notes, decisions and diagnostics", async () => {
    const root = await rootFor("line-shift", true)
    const file = path.join(root, "app/exception.tsx")
    await fs.writeFile(file, 'import { Button } from "@/components/ui/button"\n// design-rover:allow approved spacing\nexport default function ExceptionPage(){return <Button className="px-10">OK</Button>}\n')
    const engine = await createEngine(root)
    await engine.init({ approve: true, generate: false })
    const model = (await engine.load())!
    const exception = model.exceptions.find((item) => item.evidence.some((ref) => ref.location?.file === "app/exception.tsx"))!
    exception.id = "exception.legacy-line-2"
    exception.notes = "Approved human exception note"
    exception.approvedBy = "human-reviewer"
    const intent = model.intents.find((item) => item.subject === "Product.visual")!
    intent.id = "intent.legacy-product-line-10"
    intent.notes = "Approved human intent note"
    await engine.save(model)
    const before = (await engine.check()).report.diagnostics.map((item) => [item.title, item.why, item.location?.file])
    for (const shifted of [file, path.join(root, "app/page.tsx")]) await fs.writeFile(shifted, "\n" + await fs.readFile(shifted, "utf8"))
    await run("bun", [path.join(process.cwd(), "packages/cli/src/bin.ts"), "sync", "--yes", "--json", "--cwd", root])
    const after = (await engine.load())!
    expect(after.exceptions.find((item) => item.id === exception.id)).toMatchObject({ status: "approved", notes: exception.notes, approvedBy: "human-reviewer" })
    expect(after.intents.find((item) => item.id === intent.id)).toMatchObject({ status: "approved", notes: intent.notes, productionAssetRequired: true })
    expect(after.exceptions.find((item) => item.id === exception.id)!.evidence[0]!.location!.startLine).toBe(3)
    expect((await engine.check()).report.diagnostics.map((item) => [item.title, item.why, item.location?.file])).toEqual(before)
  })

  it("keeps new intent IDs stable after blank lines move their evidence", async () => {
    const root = await rootFor("stable-identity", true)
    const engine = await createEngine(root)
    const before = await engine.analyze()
    const file = path.join(root, "app/page.tsx")
    await fs.writeFile(file, "\n\n" + await fs.readFile(file, "utf8"))
    const after = await engine.analyze()
    expect(after.snapshot.intents.map((item) => item.id)).toEqual(before.snapshot.intents.map((item) => item.id))
  })

  it("supports explicit revocation and reapproval with truthful history", async () => {
    const root = await rootFor("revoke", true)
    const engine = await createEngine(root)
    await engine.init({ generate: false })
    const id = "convention.inline-tailwind"
    await engine.applyChanges([id], { generate: false })
    await engine.applyChanges([id], { reject: true, generate: false })
    let model = (await engine.load())!
    expect(model.conventions.find((item) => item.id === id)!.status).toBe("rejected")
    expect(model.history.at(-1)!.type).toBe("rejected")
    expect(model.rejections.length).toBeGreaterThan(0)
    await engine.applyChanges([id], { generate: false })
    model = (await engine.load())!
    expect(model.conventions.find((item) => item.id === id)!.status).toBe("approved")
    expect(model.history.at(-1)).toMatchObject({ type: "approved", summary: "Approved convention Inline Tailwind classes" })
    expect(model.rejections).toEqual([])
  })

  it("explicitly approves incoming inventory changes without replacing them with stale records", async () => {
    const root = await rootFor("approve-inventory")
    let model = emptyCanonical(root, "inventory")
    model.components = [ComponentRecordSchema.parse({ id: "component.button", name: "Button", source: "Button.tsx", importPath: "./Button", exportName: "Button", status: "observed", confidence: "high", originKind: "implementation" })]
    model = await saveCanonical(root, model)
    const incoming = { ...model.components[0]!, relatedTokens: ["--color-primary"], usage: [{ file: "Page.tsx", count: 2 }] }
    const change: ModelChange = { id: "change.button-context", kind: "update", entity: "component", name: "Button", summary: "Update Button context", details: [], fingerprint: "context-change", confidence: "high", status: "observed", certain: true, before: model.components[0], after: incoming }
    await applyChanges(root, model, [change], { ids: ["component.button"], generate: false })
    const saved = (await loadCanonical(root))!
    expect(saved.components[0]).toMatchObject({ status: "approved", relatedTokens: ["--color-primary"], usage: [{ file: "Page.tsx", count: 2 }] })
    expect(saved.history.at(-1)!.type).toBe("approved")
  })
})

describe("canonical mutation integrity", () => {
  it("never reports two successful parallel approvals while silently losing one", async () => {
    const root = await rootFor("concurrent", true)
    const engine = await createEngine(root)
    await engine.init({ generate: false })
    const ids = ["convention.inline-tailwind", "convention.images"]
    const results = await Promise.allSettled(ids.map((id) => engine.applyChanges([id], { generate: false })))
    const model = (await engine.load())!
    for (let index = 0; index < results.length; index += 1) {
      const result = results[index]!
      if (result.status === "fulfilled") expect(model.conventions.find((item) => item.id === ids[index])!.status).toBe("approved")
      else expect(String(result.reason)).toMatch(/Canonical model changed.*No decisions were saved/)
    }
    expect(results.some((result) => result.status === "fulfilled")).toBe(true)
  })

  it("compares complete prior contents so a reviewer cannot overwrite newer human policy", async () => {
    const root = await rootFor("cas", true)
    const engine = await createEngine(root)
    await engine.init({ generate: false })
    const previous = (await engine.load())!
    const updated = structuredClone(previous)
    updated.conventions[0]!.notes = "New human policy from another writer"
    await saveCanonical(root, updated, { expected: previous })
    await expect(saveCanonical(root, previous, { expected: previous })).rejects.toThrow(/Canonical model changed/)
    expect((await engine.load())!.conventions[0]!.notes).toBe(updated.conventions[0]!.notes)
  })

  it("does not write projections before a stale review fails its compare-and-save", async () => {
    const root = await rootFor("projection-cas", true)
    const engine = await createEngine(root)
    await engine.init({ generate: false })
    const preview = await engine.syncPreview()
    const updated = structuredClone(preview.model!)
    updated.conventions[0]!.notes = "Another reviewer's policy"
    await saveCanonical(root, updated, { expected: preview.model! })
    await expect(applyChanges(root, preview.model!, preview.diff.changes, { ids: ["convention.inline-tailwind"], generate: true })).rejects.toThrow(/Canonical model changed/)
    expect(await fs.readdir(path.join(root, ".design-rover/generated"))).toEqual([])
    await expect(fs.stat(path.join(root, "CLAUDE.md"))).rejects.toMatchObject({ code: "ENOENT" })
    expect((await engine.load())!.conventions[0]!.notes).toBe("Another reviewer's policy")
  })

  it("reports a later generation failure honestly while keeping saved decisions", async () => {
    const root = await rootFor("generation-failure", true)
    const engine = await createEngine(root)
    await engine.init({ generate: false })
    const original = fs.writeFile.bind(fs)
    vi.spyOn(fs, "writeFile").mockImplementation(async (...args) => {
      if (String(args[0]).endsWith("/.design-rover/generated/AGENTS.md")) throw new Error("injected projection write failure")
      return original(...args)
    })
    await expect(engine.applyChanges(["convention.inline-tailwind"], { generate: true })).rejects.toThrow(/Review decisions were saved, but generated guidance may be stale/)
    expect((await engine.load())!.conventions.find((item) => item.id === "convention.inline-tailwind")!.status).toBe("approved")
  })

  it("migrates an absolute metadata root only after checking the actual prior model", async () => {
    const root = await rootFor("portable-root")
    await saveCanonical(root, emptyCanonical(root, "portable"))
    const file = path.join(root, ".design-rover/system.json")
    const system = JSON.parse(await fs.readFile(file, "utf8"))
    system.repository.root = "/private/old-developer/project"
    await fs.writeFile(file, JSON.stringify(system))
    const legacy = (await loadCanonical(root))!
    expect(legacy.system.repository.root).toBe("/private/old-developer/project")
    const migrated = await saveCanonical(root, legacy, { expected: legacy })
    expect(migrated.system.repository.root).toBe(".")
    expect((await loadCanonical(root))!.system.repository.root).toBe(".")
    expect(await fs.readFile(file, "utf8")).not.toContain("old-developer")
    await expect(saveCanonical(root, legacy, { expected: legacy })).rejects.toThrow(/Canonical model changed/)
  })

  it("refuses initialization when missing metadata leaves orphaned decisions", async () => {
    const root = await rootFor("orphan", true)
    const engine = await createEngine(root)
    await engine.init({ approve: true, generate: false })
    const model = (await engine.load())!
    model.conventions[0]!.notes = "Keep my approved decision"
    model.rejections = [{ fingerprint: "human-rejection", kind: "pattern", summary: "Keep this rejected", rejectedAt: "2026-01-01" }]
    await engine.save(model)
    const recordPath = path.join(root, ".design-rover/conventions", `${model.conventions[0]!.id.slice("convention.".length)}.json`)
    const before = await fs.readFile(recordPath, "utf8")
    const rejected = await fs.readFile(path.join(root, ".design-rover/rejections.json"), "utf8")
    await fs.rm(path.join(root, ".design-rover/system.json"))
    await expect((await createEngine(root)).init()).rejects.toThrow(/system metadata is missing.*existing knowledge/)
    expect(await fs.readFile(recordPath, "utf8")).toBe(before)
    expect(await fs.readFile(path.join(root, ".design-rover/rejections.json"), "utf8")).toBe(rejected)
    await expect(fs.stat(path.join(root, ".design-rover/system.json"))).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("requires recovery after abrupt exit, even when the stale lock is manually cleared", async () => {
    const root = await rootFor("crash")
    const model = emptyCanonical(root, "crash-fixture")
    model.conventions = ["one", "two", "three", "four", "five"].map((name) => ConventionRecordSchema.parse({
      id: `convention.${name}`, name, category: "styling", observed: "evidence", inference: "inference", suggestion: "review", guidance: "guidance",
      status: "inferred", confidence: "low", originKind: "implementation",
    }))
    await saveCanonical(root, model)
    const script = path.join(root, "owned-crash-child.ts")
    const module = path.join(process.cwd(), "packages/core/src/store.ts")
    await fs.writeFile(script, `import fs from 'node:fs/promises';import {loadCanonical,saveCanonical} from ${JSON.stringify(module)};const root=process.argv[2];const model=await loadCanonical(root);for(const x of model.conventions)x.status='approved';const rename=fs.rename.bind(fs);let count=0;fs.rename=async(...args)=>{await rename(...args);if(++count===3)process.exit(73)};await saveCanonical(root,model);`)
    const exit = await new Promise<number | null>((resolve, reject) => {
      const child = spawn("bun", [script, root], { stdio: "ignore" })
      child.once("error", reject)
      child.once("exit", resolve)
    })
    expect(exit).toBe(73)
    const dir = path.join(root, ".design-rover")
    const marker = path.join(dir, ".recovery-required.json")
    expect(JSON.parse(await fs.readFile(marker, "utf8"))).toMatchObject({ state: "installing" })
    await fs.rm(path.join(dir, ".write.lock"))
    await expect(loadCanonical(root)).rejects.toThrow(/needs recovery/)
    await fs.rm(marker)
    await expect(loadCanonical(root)).rejects.toThrow(/interrupted save/)
  })
})

describe("explicit review of protected removals", () => {
  async function removalFixture() {
    const root = await rootFor("protected-removals")
    let model = emptyCanonical(root, "protected-removals")
    const records = [
      { id: "convention.approved", name: "Approved decision", status: "approved" },
      { id: "convention.noted", name: "Noted inference", status: "inferred", notes: "Preserve the human note" },
      { id: "convention.empty-note", name: "Empty note", status: "inferred", notes: "" },
      { id: "convention.reviewer", name: "Reviewer inference", status: "inferred", approvedBy: "" },
      { id: "convention.human", name: "Human inference", status: "inferred", originKind: "human" },
    ]
    model.conventions = records.map((record) => ConventionRecordSchema.parse({
      category: "styling", observed: "Previous source evidence", inference: "A convention", suggestion: "Review this decision", guidance: "Preserve this guidance",
      confidence: "high", originKind: "implementation", ...record,
    }))
    model = await saveCanonical(root, model)
    const changes: ModelChange[] = model.conventions.map((record) => ({
      id: `change.remove-${record.id.slice("convention.".length)}`, kind: "remove", entity: "convention", name: record.name,
      summary: `Remove ${record.name} — no longer observed`, details: [], fingerprint: `remove-${record.id}`,
      confidence: "medium", status: record.status, certain: false, before: record,
    }))
    return { root, model, changes }
  }

  it("keeps protected removals pending during bulk acceptance and bulk inference approval", async () => {
    const { root, model, changes } = await removalFixture()
    const saved = await applyChanges(root, model, changes, { approveInferred: true, generate: false })
    expect(saved.conventions).toHaveLength(model.conventions.length)
    for (const original of model.conventions) expect(saved.conventions.find((item) => item.id === original.id)).toEqual(original)
    expect(saved.system.syncStatus).toBe("drift")
    expect(saved.history).toEqual([])
  })

  it("requires a removal change ID instead of accepting an entity ID or name", async () => {
    const { root, model, changes } = await removalFixture()
    for (const record of model.conventions) {
      for (const selector of [record.id, record.name]) {
        await expect(applyChanges(root, model, changes, { ids: [selector], generate: false }))
          .rejects.toThrow(/Removing protected knowledge requires explicit review.*Use approve change\.remove-/)
      }
    }
    const saved = (await loadCanonical(root))!
    for (const original of model.conventions) expect(saved.conventions.find((item) => item.id === original.id)).toEqual(original)
  })

  it("accepts explicitly reviewed removal change IDs, including annotated unapproved records", async () => {
    const { root, model, changes } = await removalFixture()
    const saved = await applyChanges(root, model, changes, { ids: changes.map((change) => change.id), generate: false })
    expect(saved.conventions).toEqual([])
    expect(saved.history).toHaveLength(changes.length)
    expect(saved.history.every((event) => event.type === "remove")).toBe(true)
  })

  it("can reject a protected removal without deleting or revoking the approved decision", async () => {
    const { root, model, changes } = await removalFixture()
    const removal = changes.find((change) => change.name === "Approved decision")!
    const saved = await applyChanges(root, model, changes, { ids: [removal.id], reject: true, generate: false })
    expect(saved.conventions).toHaveLength(model.conventions.length)
    expect(saved.conventions.find((item) => item.id === "convention.approved")!.status).toBe("approved")
    expect(saved.rejections).toContainEqual(expect.objectContaining({ fingerprint: removal.fingerprint }))
    expect(saved.history.at(-1)!.type).toBe("rejected")
  })
})
