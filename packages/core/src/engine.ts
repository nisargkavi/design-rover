import path from "node:path"
import { nowIso, type CanonicalModel, type StatusReport } from "@design-rover/model"
import { retrieveContext, type ContextOptions } from "./retrieval.ts"
import { analyzeRepository, type AnalyzeOptions } from "./analyze.ts"
import { captureBaseline, checkSnippet, checkSystem } from "./check.ts"
import { usageDiagnostics } from "./usage-check.ts"
import { generatedHashes, writeGenerated } from "./context.ts"
import { diffAgainstRepo } from "./diff.ts"
import { explain, searchModel } from "./explain.ts"
import { gitChangedFiles } from "./fs.ts"
import { history, installGitHook, installGithubWorkflow } from "./integrations-local.ts"
import { specDir } from "./paths.ts"
import {
  emptyCanonical,
  CanonicalConflictError,
  isInitialized,
  loadCanonical,
  saveCanonical,
} from "./store.ts"
import { applyChanges, seedCanonical } from "./sync.ts"
import type { RepoEvidence } from "./evidence.ts"

export type EngineResult = {
  root: string
  initialized: boolean
  model?: CanonicalModel
  evidence?: RepoEvidence
}

function repoName(root: string): string {
  return path.basename(root)
}

export async function createEngine(root: string) {
  const initialized = await isInitialized(root)

  async function analyze(options: AnalyzeOptions = {}) {
    return analyzeRepository(root, options)
  }

  async function init(options: { approve?: boolean; generate?: boolean } = {}) {
    const previous = await loadCanonical(root)
    const { snapshot, evidence } = await analyze()
    // Initialization is safe to repeat; review new observations through sync.
    if (previous) {
      return { model: previous, snapshot, evidence, diff: await diffAgainstRepo(root, snapshot, previous) }
    }
    let model = await seedCanonical(root, repoName(root), snapshot, emptyCanonical(root, repoName(root)), { generate: options.generate })
    if (options.approve) {
      model = await applyChanges(root, model, [], {
        approveInferred: true,
        generate: options.generate ?? false,
      })
    } else if (options.generate) {
      const seeded = model
      const generated = await writeGenerated(root, model, { writeRepoFiles: true })
      model = { ...model, system: { ...model.system, generated: generated.files } }
      model = await saveCanonical(root, model, { expected: seeded })
    }
    const diff = await diffAgainstRepo(root, snapshot, model)
    return { model, snapshot, evidence, diff }
  }

  async function status(): Promise<StatusReport> {
    const model = await loadCanonical(root)
    if (!model) {
      return {
        syncStatus: "uninitialized",
        initialized: false,
        counts: {
          components: 0,
          tokens: 0,
          patterns: 0,
          conventions: 0,
          intents: 0,
          exceptions: 0,
        },
        pendingChanges: 0,
        staleGenerated: [],
        enforcement: {},
        repository: repoName(root),
        baselineCaptured: false,
      }
    }
    const { snapshot } = await analyze({ incremental: true })
    const diff = await diffAgainstRepo(root, snapshot, model)
    return {
      syncStatus: diff.syncStatus,
      initialized: true,
      lastSyncAt: model.system.lastSyncAt,
      lastAnalyzedAt: snapshot.analyzedAt,
      counts: diff.counts,
      pendingChanges: diff.changes.length,
      staleGenerated: diff.generated.stale,
      enforcement: model.system.enforcement,
      repository: model.system.repository.name,
      baselineCaptured: Boolean(model.baseline),
    }
  }

  async function syncPreview(options: AnalyzeOptions = {}) {
    const model = await loadCanonical(root)
    const { snapshot, evidence } = await analyze({ incremental: true, ...options })
    const diff = await diffAgainstRepo(root, snapshot, model)
    return { model, snapshot, evidence, diff }
  }

  async function check(options: { base?: string } = {}) {
    const model = await loadCanonical(root)
    if (!model) throw new Error("Design Rover is not initialized. Run `design-rover init`.")
    const changedFiles = options.base ? await gitChangedFiles(root, options.base) : []
    const { snapshot, evidence } = await analyze({
      incremental: Boolean(options.base),
      base: options.base,
    })
    const report = checkSystem(snapshot, model, options.base ? { changedFiles } : {})
    const changed = new Set(changedFiles)
    report.diagnostics.push(...usageDiagnostics(evidence, model).map((diagnostic) => ({
      ...diagnostic,
      introducedByChange: options.base ? Boolean(diagnostic.location?.file && changed.has(diagnostic.location.file)) : undefined,
    })))
    if (model.baseline) {
      const fingerprints = new Set(model.baseline.findings.map((item) => item.fingerprint))
      report.diagnostics = report.diagnostics.map((item) => ({
        ...item,
        baseline: item.baseline || fingerprints.has(item.fingerprint),
      }))
    }
    return { model, snapshot, evidence, report, changedFiles }
  }

  async function baseline() {
    const result = await check()
    const captured = captureBaseline(result.report)
    const model = {
      ...result.model,
      baseline: captured,
      system: { ...result.model.system, updatedAt: nowIso() },
    }
    return saveCanonical(root, model, { expected: result.model })
  }

  async function generate(options: { writeRepoFiles?: boolean } = {}) {
    const model = await loadCanonical(root)
    if (!model) throw new Error("Design Rover is not initialized. Run `design-rover init`.")
    await writeGenerated(root, model, { ...options, dryRun: true })
    const reserved = await saveCanonical(root, { ...model, system: { ...model.system, updatedAt: nowIso() } }, { expected: model })
    try {
      const generated = await writeGenerated(root, reserved, options)
      const next = { ...reserved, system: { ...reserved.system, generated: generated.files } }
      await saveCanonical(root, next, { expected: reserved })
      return generated
    } catch (error) {
      const reason = error instanceof CanonicalConflictError ? "Another writer changed the model before its projection manifest could be installed." : String(error)
      throw new Error(`Canonical decisions were preserved, but generated guidance may be stale. Retry design-rover generate after other writers finish. ${reason}`)
    }
  }

  return {
    root,
    initialized,
    analyze,
    init,
    status,
    syncPreview,
    applyChanges: async (
      ids: string[] | undefined,
      options: { reject?: boolean; approveInferred?: boolean; generate?: boolean } = {},
    ) => {
      const preview = await syncPreview()
      if (!preview.model) throw new Error("Design Rover is not initialized. Run `design-rover init`.")
      return applyChanges(root, preview.model, preview.diff.changes, {
        ids,
        reject: options.reject,
        approveInferred: options.approveInferred,
        generate: options.generate,
      })
    },
    check,
    baseline,
    generate,
    load: () => loadCanonical(root),
    save: (model: CanonicalModel) => saveCanonical(root, model),
    explain: async (query: string) => {
      const model = await loadCanonical(root)
      if (!model) return "Design Rover is not initialized."
      return explain(model, query)
    },
    search: async (query: string) => {
      const model = await loadCanonical(root)
      if (!model) return undefined
      return searchModel(model, query)
    },
    context: async (options: ContextOptions = {}) => {
      const model = await loadCanonical(root)
      if (!model) throw new Error("Design Rover is not initialized. Run `design-rover init` before retrieving context.")
      return retrieveContext(model, options)
    },
    history: () => history(root),
    checkSnippet: async (code: string, fileName: string) => {
      const model = await loadCanonical(root)
      if (!model) throw new Error("Design Rover is not initialized. Run `design-rover init` before checking a snippet.")
      return checkSnippet(code, fileName, model)
    },
    generatedStale: async () => {
      const model = await loadCanonical(root)
      if (!model) return []
      return (await generatedHashes(root, model)).stale
    },
    installGitHook: () => installGitHook(root),
    installGithubWorkflow: () => installGithubWorkflow(root),
    specDir: specDir(root),
  }
}
