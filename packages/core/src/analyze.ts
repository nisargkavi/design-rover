import { nowIso, type ObservedSnapshot } from "@design-rover/model"
import { analyzeComponents } from "./analyzers/components.ts"
import { analyzeConventions } from "./analyzers/conventions.ts"
import { analyzeExceptions } from "./analyzers/exceptions.ts"
import { analyzeFramework } from "./analyzers/framework.ts"
import { analyzeIntents } from "./analyzers/intents.ts"
import { analyzePatterns } from "./analyzers/patterns.ts"
import { analyzeTokens } from "./analyzers/tokens.ts"
import { collectEvidence } from "./scan.ts"
import { loadCache, saveCache, type FileCache } from "./cache.ts"
import { gitChangedFiles } from "./fs.ts"
import { sha256 } from "./hash.ts"
import type { RepoEvidence } from "./evidence.ts"

export type AnalyzeOptions = {
  files?: string[]
  incremental?: boolean
  base?: string
}

export async function analyzeRepository(
  root: string,
  options: AnalyzeOptions = {},
): Promise<{ snapshot: ObservedSnapshot; evidence: RepoEvidence }> {
  const cache = await loadCache(root)
  const incremental = Boolean(!options.files && options.incremental && cache)
  const gitChanges = options.base !== undefined || options.incremental ? await gitChangedFiles(root, options.base) : []
  // Always reconcile the complete discovered manifest. Git dirtiness alone is
  // insufficient after commits, branch changes, deletes or ignore changes.
  const evidence = await collectEvidence(root, {
    files: options.files,
    cachedFiles: incremental ? cache?.files : undefined,
  })
  const merged: RepoEvidence = evidence
  const previous = new Map(cache?.files.map((file) => [file.relative, file.hash]))
  const current = new Map(evidence.files.map((file) => [file.relative, file.hash]))
  const contentChanges = cache && !options.files
    ? [...new Set([...previous.keys(), ...current.keys()])].filter((file) => previous.get(file) !== current.get(file))
    : []
  const changedFiles = [...new Set([...gitChanges, ...contentChanges])].sort()

  const framework = analyzeFramework(merged)
  const tokens = analyzeTokens(merged)
  const components = analyzeComponents(
    merged,
    tokens.map((token) => token.name),
  )
  const patterns = analyzePatterns(merged)
  const conventions = analyzeConventions(merged)
  const intents = analyzeIntents(merged)
  const exceptions = analyzeExceptions(merged)

  const snapshot: ObservedSnapshot = {
    analyzedAt: nowIso(),
    filesAnalyzed: evidence.files.length,
    incremental,
    changedFiles,
    tokens,
    components,
    patterns,
    conventions,
    intents,
    exceptions,
    framework: framework.framework,
    styling: framework.styling,
    componentLibraries: framework.componentLibraries,
    documentation: framework.documentation,
  }

  const nextCache: FileCache = {
    version: 4,
    hash: sha256(merged.files.map((file) => `${file.relative}\0${file.hash}`).join("\0")),
    files: merged.files,
  }
  // A partial analysis is not a complete repository cache.
  if (!options.files) await saveCache(root, nextCache)

  return { snapshot, evidence: merged }
}
