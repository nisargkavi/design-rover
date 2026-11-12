import fs from "node:fs/promises"
import path from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import ts from "typescript"
import type { CanonicalModel, ModelChange } from "@design-rover/model"
import { createEngine } from "./engine.ts"
import { discoverFiles } from "./scan.ts"
import { sha256 } from "./hash.ts"
import { readText } from "./fs.ts"
import { specPaths } from "./paths.ts"
import { applyChanges } from "./sync.ts"
import { generatedHashes } from "./context.ts"
import type { RepoEvidence } from "./evidence.ts"

export type WatchEvent = {
  type: "ready" | "updated" | "review" | "error" | "stopped"
  cwd: string
  at: string
  applied: number
  pendingChanges: number
  pendingReview: number
  staleGenerated: number
  actions?: { review?: string; generate?: string }
  error?: string
}

export type WatchOptions = {
  signal?: AbortSignal
  intervalMs?: number
  debounceMs?: number
  generate?: boolean
  onEvent?: (event: WatchEvent) => void
}

function milliseconds(value: number, name: string) {
  if (!Number.isInteger(value) || value < 100 || value > 60000) throw new Error(`Watch ${name} must be an integer from 100 to 60000 milliseconds.`)
  return value
}

// Unlike manual sync, watching cannot change a reviewed contract or policy.
function automatic(change: ModelChange): boolean {
  if (change.entity !== "component" && change.entity !== "token") return false
  const before = change.before as { status?: string; notes?: string; approvedBy?: string; originKind?: string } | undefined
  const after = change.after as { status?: string } | undefined
  if (before && (before.status !== "observed" || before.notes !== undefined || before.approvedBy !== undefined || before.originKind === "human")) return false
  return change.before !== change.after && (!after || after.status === "observed")
}

async function fingerprint(root: string) {
  const files = await discoverFiles(root)
  const entries: [string, string][] = []
  for (const file of files) {
    let content = await fs.readFile(path.join(root, file), "utf8")
    if (file === "AGENTS.md" || file === "CLAUDE.md") {
      content = content.replace(/<!-- design-rover:start -->[\s\S]*?<!-- design-rover:end -->/g, "").trim()
      if (!content) continue
    }
    entries.push([file, sha256(content)])
  }
  // Ignore rules can change discovery; canonical revisions can change which
  // records are safe to refresh even when application source has not changed.
  entries.push([".gitignore", await readText(path.join(root, ".gitignore")) ?? ""])
  const configurations: Record<string, string> = {}
  // These loaders are active even if a user excludes their files from discovery.
  for (const file of ["package.json", "components.json", "tsconfig.json"]) {
    const content = await readText(path.join(root, file))
    if (content !== undefined) configurations[file] = content
    entries.push([`config:${file}`, content ?? ""])
  }
  const source = sha256(JSON.stringify(entries))
  return { source, key: sha256(`${source}\0${await fs.readFile(specPaths(root).system, "utf8")}`), configurations }
}

function validateSyntax(evidence: RepoEvidence, configurations: Record<string, string>) {
  for (const file of evidence.files) {
    if (file.kind === "script") {
      const absolute = path.join(evidence.root, file.relative)
      const source = ts.createSourceFile(absolute, file.content, ts.ScriptTarget.Latest, true)
      const compilerOptions = { allowJs: true, noResolve: true, noLib: true, jsx: ts.JsxEmit.Preserve }
      const host = ts.createCompilerHost(compilerOptions)
      // Ask only for parser diagnostics, without project/type/module checks or
      // reading imports. Valid CommonJS and isolatedModules constructs are safe.
      host.getSourceFile = (name) => name === absolute ? source : undefined
      const program = ts.createProgram([absolute], compilerOptions, host)
      const error = program.getSyntacticDiagnostics(source).find((item) => item.category === ts.DiagnosticCategory.Error)
      if (error) throw new Error(`Source syntax error in ${file.relative}: ${ts.flattenDiagnosticMessageText(error.messageText, " ")}`)
    }
  }
  for (const [file, content] of Object.entries(configurations)) {
    if (file === "tsconfig.json") {
      const result = ts.parseConfigFileTextToJson(file, content)
      if (result.error) throw new Error(`Configuration syntax error in ${file}: ${ts.flattenDiagnosticMessageText(result.error.messageText, " ")}`)
    } else {
      try { JSON.parse(content) } catch { throw new Error(`Configuration syntax error in ${file}.`) }
    }
  }
}

function pending(model: CanonicalModel) {
  return [model.components, model.tokens, model.patterns, model.conventions, model.intents, model.exceptions]
    .flat().filter((item) => item.status === "inferred" || item.status === "suggested").length
}

/** Poll supported observations, serializing all work and preserving decisions. */
export async function watchRepository(directory: string, options: WatchOptions = {}): Promise<void> {
  const root = path.resolve(directory)
  const interval = milliseconds(options.intervalMs ?? 1000, "interval")
  const debounce = milliseconds(options.debounceMs ?? 300, "debounce")
  const engine = await createEngine(root)
  if (!await engine.load()) throw new Error("Design Rover is not initialized. Run `bunx design-rover init` before watching.")
  let previous: string | undefined
  let candidate: string | undefined
  let changedAt = 0
  let ready = false
  let lastState: string | undefined
  let lastSource: string | undefined
  let lastError: string | undefined
  let counts = { applied: 0, pendingChanges: 0, pendingReview: 0, staleGenerated: 0 }
  const emit = (event: Omit<WatchEvent, "cwd" | "at">) => options.onEvent?.({ ...event, cwd: root, at: new Date().toISOString() })

  while (!options.signal?.aborted) {
    let event: Omit<WatchEvent, "cwd" | "at"> | undefined
    try {
      const current = await fingerprint(root)
      if (current.key !== previous || lastError) {
        if (candidate !== current.key) { candidate = current.key; changedAt = Date.now() }
        if (Date.now() - changedAt >= debounce) {
          const preview = await engine.syncPreview({ incremental: true })
          if (!preview.model) throw new Error("Design Rover model was removed. Run `bunx design-rover init` before resuming.")
          validateSyntax(preview.evidence, current.configurations)
          // Do not install a snapshot taken across an editor save or approval.
          if ((await fingerprint(root)).key === current.key && !options.signal?.aborted) {
            const selected = preview.diff.changes.filter(automatic)
            let model = preview.model
            if (selected.length) {
              // Use the SAME model/diff with change IDs. Entity IDs imply
              // approval, and a second preview could overwrite a newer decision.
              model = await applyChanges(root, model, preview.diff.changes, { ids: selected.map((change) => change.id), generate: options.generate ?? false })
            } else if (options.generate && (!model.system.generated.length || preview.diff.generated.stale.length)) {
              await engine.generate({ writeRepoFiles: true })
              model = (await engine.load())!
            }
            counts = {
              applied: selected.length,
              pendingChanges: preview.diff.changes.filter((change) => !selected.includes(change) && change.entity !== "projection" && change.before !== change.after).length,
              pendingReview: pending(model),
              staleGenerated: (await generatedHashes(root, model)).stale.length,
            }
            const actions = {
              ...(counts.pendingChanges || counts.pendingReview ? { review: "bunx design-rover diff --json" } : {}),
              ...(counts.staleGenerated ? { generate: "bunx design-rover generate" } : {}),
            }
            const state = JSON.stringify([counts.pendingChanges, counts.pendingReview, counts.staleGenerated])
            if (!ready || selected.length || lastError || state !== lastState || current.source !== lastSource) {
              event = { type: !ready ? "ready" : selected.length ? "updated" : counts.pendingChanges || counts.pendingReview || counts.staleGenerated ? "review" : "updated", ...counts, ...(Object.keys(actions).length ? { actions } : {}) }
            }
            ready = true
            lastState = state
            lastSource = current.source
            lastError = undefined
            previous = current.key
          }
        }
      }
    } catch (error) {
      const message = `Watch refresh failed; retrying after the next poll. ${error instanceof Error ? error.message : String(error)}`
      if (message !== lastError) event = { type: "error", ...counts, applied: 0, error: message, actions: { review: "bunx design-rover diff --json" } }
      lastError = message
    }
    if (event) emit(event)
    if (!options.signal?.aborted) {
      try { await delay(interval, undefined, { signal: options.signal }) }
      catch (error) { if (!options.signal?.aborted) throw error }
    }
  }
  emit({ type: "stopped", ...counts, applied: 0 })
}
