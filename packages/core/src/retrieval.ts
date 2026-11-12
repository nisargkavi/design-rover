import path from "node:path"
import ignore from "ignore"
import type { CanonicalModel, SystemDiff, TokenRecord } from "@design-rover/model"
import { variableReferences } from "./token-usage.ts"

const KINDS = ["component", "token", "pattern", "convention", "intent", "exception"] as const
export type ContextKind = typeof KINDS[number]
export type ContextRecord = CanonicalModel["components" | "tokens" | "patterns" | "conventions" | "intents" | "exceptions"][number]
export type ContextOptions = {
  query?: string
  path?: string
  includePending?: boolean
  limit?: number
  maxChars?: number
}

export type ContextFreshnessCheck = {
  checkedAt: string
  syncStatus: SystemDiff["syncStatus"]
  sourceChanges: number
  pendingReview: number
  staleGenerated: number
  root: string
}

export type ContextFreshness = {
  canonicalUpdatedAt: string
  lastAnalyzedAt: string | null
  recordedSyncStatus: string
} & ({ checked: false } | {
  checked: true
  checkedAt: string
  sourceStatus: "current" | "stale"
  syncStatus: SystemDiff["syncStatus"]
  sourceChanges: number
  pendingReview: number
  staleGenerated: number
  actions?: { cwd: string; review?: string; refresh?: string; generate?: string }
})

export type ContextMatch = {
  kind: ContextKind
  score: number
  reasons: string[]
  sourceRefs: string[]
  record: ContextRecord
}

export type ContextPacket = {
  version: 1
  repository: string
  scope: { query: string | null; path: string | null; includePending: boolean }
  limits: { limit: number; maxChars: number; outputChars: number; unit: "UTF-16 code units including JSON formatting and final newline" }
  freshness: ContextFreshness
  coverage: {
    matched: number; returned: number; complete: boolean
    omittedByLimit: number; omittedByBudget: number
    approvedDecisions: { matched: number; returned: number; omitted: number }
  }
  warnings: string[]
  matches: ContextMatch[]
}

const STOP_WORDS = new Set(["a", "an", "the", "to", "for", "with", "on", "in", "and", "or", "of", "this", "that", "please", "build", "create", "edit", "update", "change", "add", "implement", "make", "use", "using"])
const normalizeText = (value: string) => value.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase()
const lexicalWords = (value: string) => normalizeText(value).split(/[^a-z0-9_-]+/).filter((word) => word && !STOP_WORDS.has(word))
const compare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0

function normalizePath(value: string): string {
  const input = value.trim().replace(/\\/g, "/")
  if (!input || input.length > 512 || input.includes("\0") || input.startsWith("/") || /^[a-z]:/i.test(input)) throw new Error("Context path must be a repository-relative file or directory (at most 512 characters).")
  const normalized = path.posix.normalize(input).replace(/\/$/, "")
  if (normalized === ".." || normalized.startsWith("../")) throw new Error("Context path cannot leave the repository.")
  return normalized
}

function owner(file: string): string | undefined {
  const parts = file.split("/")
  return (parts[0] === "apps" || parts[0] === "packages") && parts[1] ? `${parts[0]}/${parts[1]}` : undefined
}

function under(file: string, selected: string): boolean {
  return selected === "." || file === selected || file.startsWith(`${selected}/`)
}

function sourceFiles(record: ContextRecord): string[] {
  const files = record.evidence.flatMap((item) => item.location?.file ? [item.location.file] : [])
  if ("source" in record) files.push(record.source)
  if ("origin" in record) files.push(record.origin)
  if ("occurrences" in record) files.push(...record.occurrences.map((item) => item.file))
  if ("sourceRefs" in record) files.push(...record.sourceRefs.flatMap((item) => item.location?.file ? [item.location.file] : []))
  return [...new Set(files.map((file) => file.replace(/\\/g, "/")).filter(Boolean))].sort(compare)
}

function lexicalScore(record: ContextRecord, query: string, words: string[]): number {
  const name = "name" in record ? record.name : record.subject
  if (query.toLowerCase() === record.id.toLowerCase()) return 300
  const title = normalizeText(`${record.id} ${name}`)
  const text = normalizeText(JSON.stringify(record))
  let score = query.toLowerCase() === name.toLowerCase() ? 150 : 0
  for (const word of words) {
    if (title.includes(word)) score += 20
    else if (text.includes(word)) score += 4
  }
  return score
}

function approvedDecision(match: ContextMatch): boolean {
  return match.record.status === "approved" && match.kind !== "component" && match.kind !== "token"
}

function visible(kind: ContextKind, record: ContextRecord, includePending: boolean): boolean {
  return record.status === "approved" || (kind !== "exception" && record.status === "observed")
    || Boolean(includePending && (record.status === "inferred" || record.status === "suggested"))
}

function pathScopeMatches(patterns: string[], selected: string, allowDescendants = true): "direct" | "potential" | undefined {
  if (selected === ".") return "potential"
  const result = ignore().add(patterns).test(selected)
  if (result.ignored) return "direct"
  if (result.unignored) return undefined
  // Directory requests include decisions for descendants, even when the pattern
  // does not match the directory node itself (e.g. app/billing/**).
  if (allowDescendants && patterns.some((pattern) => {
    if (pattern.startsWith("!")) return false
    const rawPrefix = pattern.replace(/^\//, "").split(/[?*\[]/, 1)[0]!
    const prefix = rawPrefix.replace(/\/$/, "")
    return !prefix || under(prefix, selected) || under(selected, prefix)
      || (!rawPrefix.endsWith("/") && selected.startsWith(rawPrefix))
  })) return "potential"
  return undefined
}

export function validateContextOptions(options: ContextOptions) {
  const query = options.query?.trim() ?? ""
  if (query.length > 512) throw new Error("Context query must be at most 512 characters.")
  const selected = options.path === undefined ? undefined : normalizePath(options.path)
  if (!query && selected === undefined) throw new Error("Provide a context query or a repository-relative path.")
  const limit = options.limit ?? 20
  const maxChars = options.maxChars ?? 12_000
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Context limit must be an integer from 1 to 100.")
  if (!Number.isInteger(maxChars) || maxChars < 1024 || maxChars > 100_000) throw new Error("Context maxChars must be an integer from 1024 to 100000.")
  const includePending = options.includePending ?? false
  return { query, selected, limit, maxChars, includePending }
}

/** Pure canonical retrieval; an engine can attach a source check before budgeting. */
export function retrieveContext(model: CanonicalModel, options: ContextOptions = {}, check?: ContextFreshnessCheck): ContextPacket {
  const { query, selected, limit, maxChars, includePending } = validateContextOptions(options)
  const freshness: ContextFreshness = {
    canonicalUpdatedAt: model.system.updatedAt,
    lastAnalyzedAt: model.system.lastAnalyzedAt ?? null,
    recordedSyncStatus: model.system.syncStatus,
    ...(check ? {
      checked: true as const,
      checkedAt: check.checkedAt,
      sourceStatus: check.sourceChanges ? "stale" as const : "current" as const,
      syncStatus: check.syncStatus,
      sourceChanges: check.sourceChanges,
      pendingReview: check.pendingReview,
      staleGenerated: check.staleGenerated,
      ...(check.sourceChanges || check.pendingReview || check.staleGenerated ? { actions: {
        cwd: check.root,
        ...(check.sourceChanges || check.pendingReview ? { review: "bunx design-rover diff --json" } : {}),
        ...(check.sourceChanges ? { refresh: "bunx design-rover sync --yes" } : {}),
        ...(!check.sourceChanges && check.staleGenerated ? { generate: "bunx design-rover generate" } : {}),
      } } : {}),
    } : { checked: false as const }),
  }
  const freshnessWarnings = check ? [
    ...(check.sourceChanges ? ["Saved context is stale: supported source observations have changed. Review freshness.actions.review, then use freshness.actions.refresh from freshness.actions.cwd. Request context again; changes requiring explicit decisions may remain."] : []),
    ...(check.pendingReview ? ["Pending knowledge still requires explicit approval; checking freshness does not approve it."] : []),
    ...(check.staleGenerated ? ["Generated agent guidance is stale; refresh it using the supplied action before relying on those files."] : []),
  ] : ["Canonical snapshot only; freshness was not checked. Run status or request context with freshness checking enabled."]
  const words = [...new Set(lexicalWords(query))].slice(0, 32)
  const matches: ContextMatch[] = []
  const relevantComponents = new Set<string>()
  const relevantPaths = new Set<string>()
  const relevantOwners = new Set<string | undefined>()
  const relevantComponentSources = new Set<string>()
  const tokenNames = new Set<string>()
  const dependencyWarnings = new Set<string>()

  function relevance(kind: ContextKind, record: ContextRecord): ContextMatch | undefined {
    if (!visible(kind, record, includePending)) return undefined
    const files = sourceFiles(record)
    const lexical = query ? lexicalScore(record, query, words) : 0
    let pathScore = selected !== undefined && files.some((file) => under(file, selected)) ? 100 : 0
    const reasons: string[] = []
    if (kind === "component" && selected !== undefined && "usage" in record && record.usage.some((item) => under(item.file, selected))) {
      pathScore = Math.max(pathScore, 120)
      reasons.push("used-in-path")
    }
    const connected = kind === "token" && "origin" in record && (tokenNames.has(record.id)
      || (tokenNames.has(record.name) && (owner(record.origin) === undefined || relevantOwners.has(owner(record.origin)) || (selected !== undefined && owner(record.origin) === owner(selected)))))
    if (connected) { pathScore = Math.max(pathScore, 80); reasons.push("component-token") }
    const globalDecision = (kind === "convention" || kind === "pattern" || kind === "intent") && !files.length
    if (kind !== "component" && kind !== "token" && files.some((file) => relevantComponentSources.has(file))) {
      pathScore = Math.max(pathScore, 110)
      reasons.push("component-source-decision")
    }
    let applicable = false
    if (kind === "exception" && "scope" in record && typeof record.scope === "object") {
      const scope = record.scope
      const componentsMatch = !scope.components.length || scope.components.some((item) => relevantComponents.has(item))
      let pathsMatch: boolean
      let potentialScope = false
      try {
        const matched = selected !== undefined ? pathScopeMatches(scope.paths, selected) : [...relevantPaths].map((file) => pathScopeMatches(scope.paths, file, false)).find(Boolean)
        pathsMatch = !scope.paths.length || Boolean(matched)
        potentialScope = scope.paths.length > 0 && matched === "potential"
      } catch (error) {
        throw new Error(`Cannot safely resolve exception scope ${record.id}: ${String(error)}`)
      }
      const pathRelevant = scope.paths.length > 0 && pathsMatch
      applicable = Boolean((scope.paths.length || scope.components.length) && componentsMatch && pathsMatch)
      if (selected !== undefined && !applicable && !pathRelevant) return undefined
      if (applicable || pathRelevant) {
        pathScore = Math.max(pathScore, 140)
        reasons.push(potentialScope ? "path-exception-may-apply" : applicable ? "applicable-exception" : "path-exception-component-scope-unresolved")
      }
    }
    if (selected !== undefined) {
      const selectedOwner = owner(selected)
      const foreign = files.length > 0 && files.every((file) => owner(file) !== undefined && owner(file) !== selectedOwner)
      if (foreign && !pathScore && !applicable) return undefined
      if (files.length && !pathScore && lexical < 20 && !globalDecision && !applicable) return undefined
    }
    if (!lexical && !pathScore && !globalDecision) return undefined
    if (lexical) reasons.push("query-match")
    if (pathScore && !reasons.length) reasons.push("source-in-path")
    if (globalDecision) reasons.push("repository-decision")
    const name = "name" in record ? record.name : record.subject
    const explicitMatch = query.toLowerCase() === record.id.toLowerCase() || query.toLowerCase() === name.toLowerCase()
    const nameWords = lexicalWords(name)
    const requestedComponent = kind === "component" && nameWords.length > 0 && nameWords.every((word) => words.includes(word))
    const requestBoost = explicitMatch ? 3000 : requestedComponent ? 2000 : 0
    if (requestBoost) reasons.push("requested-record")
    const componentBoost = kind === "component" && !requestBoost && nameWords.some((word) => words.includes(word)) ? 400 : 0
    if (componentBoost) reasons.push("matching-component")
    const decisionBoost = record.status === "approved" && kind !== "component" && kind !== "token" ? 1000 : 0
    return { kind, score: requestBoost + componentBoost + decisionBoost + pathScore + lexical, reasons, sourceRefs: files, record }
  }

  for (const component of model.components) {
    const match = relevance("component", component)
    if (!match) continue
    matches.push(match)
    relevantComponents.add(component.id)
    relevantComponents.add(component.name)
    relevantPaths.add(component.source)
    relevantOwners.add(owner(component.source))
    relevantComponentSources.add(component.source)
    for (const usage of component.usage) relevantPaths.add(usage.file)
    for (const token of component.relatedTokens) tokenNames.add(token)
  }
  const collections = { token: model.tokens, pattern: model.patterns, convention: model.conventions, intent: model.intents, exception: model.exceptions }
  for (const kind of ["token", "pattern", "convention", "intent", "exception"] as const) {
    for (const record of collections[kind]) {
      const match = relevance(kind, record)
      if (match) matches.push(match)
    }
  }
  // Preserve aliases as declarations, and include their visible scoped inputs.
  // This is a dependency graph, not CSS cascade evaluation or a flattened value.
  const tokensByName = new Map<string, TokenRecord[]>()
  for (const token of model.tokens) {
    const values = tokensByName.get(token.name) ?? []
    values.push(token)
    tokensByName.set(token.name, values)
  }
  const tokenMatches = new Map(matches.filter((match) => match.kind === "token").map((match) => [match.record.id, match]))
  const queue = [...tokenMatches.values()].sort((left, right) => compare(left.record.id, right.record.id)).map((match) => match.record as TokenRecord)
  const processed = new Set<string>()
  const edges = new Map<string, string[]>()
  for (let index = 0; index < queue.length; index += 1) {
    if (index >= 512) { dependencyWarnings.add("Token dependency traversal exceeded 512 records; retrieve a narrower token scope before treating dependencies as complete."); break }
    const token = queue[index]!
    if (processed.has(token.id)) continue
    processed.add(token.id)
    const dependencies: string[] = []
    for (const reference of variableReferences(token.value)) {
      const candidates = (tokensByName.get(reference) ?? []).filter((candidate) => visible("token", candidate, includePending)
        && (owner(candidate.origin) === undefined || owner(candidate.origin) === owner(token.origin)))
      if (!candidates.length) dependencyWarnings.add(`No visible owner-compatible declaration for ${reference}, referenced by ${token.name}; a fallback or external declaration may apply.`)
      for (const candidate of candidates.sort((left, right) => compare(left.id, right.id))) {
        dependencies.push(candidate.id)
        if (tokenMatches.has(candidate.id)) continue
        tokenNames.add(reference)
        const match = relevance("token", candidate)
        if (!match) continue
        match.reasons.push("token-dependency")
        matches.push(match)
        tokenMatches.set(candidate.id, match)
        queue.push(candidate)
      }
    }
    edges.set(token.id, dependencies)
  }
  const completed = new Set<string>()
  const cyclic = (id: string, visiting: Set<string>): boolean => {
    if (visiting.has(id)) return true
    if (completed.has(id) || !edges.has(id)) return false
    const next = new Set(visiting).add(id)
    const found = edges.get(id)!.some((dependency) => cyclic(dependency, next))
    completed.add(id)
    return found
  }
  if ([...edges.keys()].some((id) => cyclic(id, new Set()))) dependencyWarnings.add("Token reference cycle detected; inspect the scoped dependency declarations before assuming a resolved value.")
  matches.sort((left, right) => right.score - left.score || compare(left.kind, right.kind) || compare(left.record.id, right.record.id))
  const decisionCount = matches.filter(approvedDecision).length
  function packet(items: ContextMatch[], omittedByBudget: number, omittedByLimit: number): ContextPacket {
    const returnedDecisions = items.filter(approvedDecision).length
    const omittedDecisions = decisionCount - returnedDecisions
    const result: ContextPacket = {
      version: 1,
      repository: model.system.repository.name,
      scope: { query: query || null, path: selected ?? null, includePending },
      limits: { limit, maxChars, outputChars: 0, unit: "UTF-16 code units including JSON formatting and final newline" },
      freshness,
      coverage: { matched: matches.length, returned: items.length, complete: items.length === matches.length, omittedByLimit, omittedByBudget, approvedDecisions: { matched: decisionCount, returned: returnedDecisions, omitted: omittedDecisions } },
      warnings: [...freshnessWarnings, ...[...dependencyWarnings].sort(compare)],
      matches: items,
    }
    if (omittedDecisions) result.warnings.push("Applicable approved decisions were omitted. Retrieve them before treating this context as complete.")
    if (items.length < matches.length) result.warnings.push("Whole records were omitted by the stated limits; raise the bounds or narrow the query/path. No record was sliced.")
    if (items.some((item) => item.reasons.some((reason) => reason === "path-exception-may-apply" || reason === "path-exception-component-scope-unresolved"))) result.warnings.push("Some exception scopes may apply to descendants or unresolved components. Inspect their recorded scope before applying them.")
    for (let pass = 0; pass < 4; pass += 1) {
      const length = serializeContext(result).length
      if (length === result.limits.outputChars) break
      result.limits.outputChars = length
    }
    return result
  }
  const selectedMatches: ContextMatch[] = []
  let omittedByBudget = 0
  let omittedByLimit = 0
  if (serializeContext(packet([], matches.length, 0)).length > maxChars) throw new Error("Context metadata exceeds maxChars. Increase the bound or shorten the query/path.")
  for (const match of matches) {
    if (selectedMatches.length >= limit) { omittedByLimit += 1; continue }
    const candidate = packet([...selectedMatches, match], omittedByBudget, matches.length - selectedMatches.length - 1 - omittedByBudget)
    if (serializeContext(candidate).length <= maxChars) selectedMatches.push(match)
    else omittedByBudget += 1
  }
  let result = packet(selectedMatches, omittedByBudget, omittedByLimit)
  // Metadata digits can grow as omissions accumulate. Enforce the final bound too.
  while (serializeContext(result).length > maxChars && selectedMatches.length) {
    selectedMatches.pop()
    omittedByBudget += 1
    result = packet(selectedMatches, omittedByBudget, omittedByLimit)
  }
  if (serializeContext(result).length > maxChars) throw new Error("Context metadata exceeds maxChars. Increase the bound.")
  return result
}

export function serializeContext(packet: ContextPacket): string {
  return `${JSON.stringify(packet, null, 2)}\n`
}
