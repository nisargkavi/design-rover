export { analyzeRepository } from "./analyze.ts"
export { checkSnippet, checkSystem, captureBaseline } from "./check.ts"
export { renderContext, writeGenerated, generatedHashes } from "./context.ts"
export { retrieveContext, serializeContext } from "./retrieval.ts"
export type { ContextOptions, ContextPacket, ContextMatch, ContextKind } from "./retrieval.ts"
export { diffModels, diffAgainstRepo } from "./diff.ts"
export { createEngine } from "./engine.ts"
export { explain, searchModel } from "./explain.ts"
export { collectEvidence, discoverFiles } from "./scan.ts"
export {
  emptyCanonical,
  isInitialized,
  loadCanonical,
  saveCanonical,
} from "./store.ts"
export { applyChange, applyChanges, seedCanonical } from "./sync.ts"
export { usageDiagnostics } from "./usage-check.ts"
export { specDir, specPaths } from "./paths.ts"
export { githubWorkflow, hookScript, installGitHook, installGithubWorkflow } from "./integrations-local.ts"
export { pathExists, readText, writeText } from "./fs.ts"
export type { RepoEvidence, FileEvidence } from "./evidence.ts"
export type { AnalyzeOptions } from "./analyze.ts"
