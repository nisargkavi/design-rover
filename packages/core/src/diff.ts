import {
  entityId,
  type CanonicalModel,
  type ComponentRecord,
  type ConventionRecord,
  type EntityKind,
  type ExceptionRecord,
  type IntentRecord,
  type ModelChange,
  type ObservedSnapshot,
  type PatternRecord,
  type SystemDiff,
  type TokenRecord,
} from "@design-rover/model"
import { shortHash } from "./hash.ts"
import { generatedHashes } from "./context.ts"

function fingerprint(kind: string, id: string, payload: unknown): string {
  return shortHash(`${kind}:${id}:${JSON.stringify(payload)}`)
}

export function recordIdentity(kind: EntityKind, record: unknown): string {
  const item = record as { id: string; name?: string; source?: string; exportName?: string; subject?: string; scope?: string; mode?: string; origin?: string }
  if (kind === "component") return JSON.stringify([item.source, item.exportName ?? item.name])
  if (kind === "token") return JSON.stringify([item.name, item.scope ?? ":root", item.mode ?? "", item.origin])
  return item.id
}

function componentSig(record: ComponentRecord) {
  return {
    variants: [...record.variants].sort(),
    sizes: [...record.sizes].sort(),
    props: record.props.map((prop) => ({
      name: prop.name,
      type: prop.type?.replace(/\s+/g, " ").trim(),
      required: prop.required,
      defaultValue: prop.defaultValue,
      values: prop.values ? [...prop.values].sort() : undefined,
    })).sort((a, b) => a.name.localeCompare(b.name)),
    source: record.source,
    importPath: record.importPath,
    exportName: record.exportName,
  }
}

function tokenSig(record: TokenRecord) {
  return { value: record.value, category: record.category, origin: record.origin, scope: record.scope ?? ":root", mode: record.mode, important: record.important ?? false }
}

function patternSig(record: PatternRecord) {
  return {
    fingerprint: record.fingerprint,
    files: record.occurrences.map((item) => item.file).sort(),
  }
}

function conventionSig(record: ConventionRecord) {
  return {
    observed: record.observed,
    inference: record.inference,
    metric: record.metric,
  }
}

function intentSig(record: IntentRecord) {
  return {
    subject: record.subject,
    intentStatus: record.intentStatus,
    sourceRefs: record.sourceRefs.map((item) => ({ kind: item.kind, description: item.description, snippet: item.snippet })),
  }
}

function exceptionSig(record: ExceptionRecord) {
  return { evidence: record.evidence.map((item) => ({ kind: item.kind, description: item.description, file: item.location?.file })) }
}

function rejected(canonical: CanonicalModel, fp: string): boolean {
  return canonical.rejections.some((item) => item.fingerprint === fp)
}

function pushChange(
  changes: ModelChange[],
  canonical: CanonicalModel,
  change: Omit<ModelChange, "id"> & { id?: string },
) {
  const id = change.id ?? entityId("change", change.fingerprint)
  if (rejected(canonical, change.fingerprint)) return
  changes.push({ ...change, id })
}

export function diffModels(
  observed: ObservedSnapshot,
  canonical: CanonicalModel | undefined,
  generated?: { stale: string[] },
): SystemDiff {
  const changes: ModelChange[] = []
  if (!canonical) {
    return {
      syncStatus: "uninitialized",
      changes: [],
      counts: countsOf(observed),
      generated: { stale: [], changed: [] },
    }
  }

  diffCollection({
    kind: "token",
    observed: observed.tokens,
    canonical: canonical.tokens,
    sig: tokenSig,
    name: (item) => item.name,
    inventory: true,
    changes,
    model: canonical,
  })
  diffCollection({
    kind: "component",
    observed: observed.components,
    canonical: canonical.components,
    sig: componentSig,
    name: (item) => item.name,
    inventory: true,
    changes,
    model: canonical,
    details: (before, after) => componentDetails(before, after),
  })
  diffCollection({
    kind: "pattern",
    observed: observed.patterns,
    canonical: canonical.patterns,
    sig: patternSig,
    name: (item) => item.name,
    inventory: false,
    changes,
    model: canonical,
  })
  diffCollection({
    kind: "convention",
    observed: observed.conventions,
    canonical: canonical.conventions,
    sig: conventionSig,
    name: (item) => item.name,
    inventory: false,
    changes,
    model: canonical,
  })
  diffCollection({
    kind: "intent",
    observed: observed.intents,
    canonical: canonical.intents,
    sig: intentSig,
    name: (item) => item.subject,
    inventory: false,
    changes,
    model: canonical,
  })
  diffCollection({
    kind: "exception",
    observed: observed.exceptions,
    canonical: canonical.exceptions,
    sig: exceptionSig,
    name: (item) => item.name,
    inventory: false,
    changes,
    model: canonical,
  })

  const stale = generated?.stale ?? []
  for (const file of stale) {
    pushChange(changes, canonical, {
      kind: "stale",
      entity: "projection",
      name: file,
      summary: `Stale generated context: ${file}`,
      details: ["Canonical model and generated AI context are out of date."],
      fingerprint: fingerprint("projection", file, file),
      confidence: "high",
      status: "observed",
      certain: true,
    })
  }

  const pending = [canonical.patterns, canonical.conventions, canonical.intents, canonical.exceptions]
    .some((items) => items.some((item) => item.status === "suggested" || item.status === "inferred"))
  const hasDrift = changes.some((change) => change.kind === "stale" || change.before !== change.after)

  return {
    syncStatus:
      changes.length === 0 && !pending
        ? "synchronized"
        : hasDrift
          ? "drift"
          : "pending-review",
    changes,
    counts: {
      components: canonical.components.length,
      tokens: canonical.tokens.length,
      patterns: canonical.patterns.length,
      conventions: canonical.conventions.length,
      intents: canonical.intents.length,
      exceptions: canonical.exceptions.length,
    },
    generated: { stale, changed: stale },
  }
}

function countsOf(observed: ObservedSnapshot) {
  return {
    components: observed.components.length,
    tokens: observed.tokens.length,
    patterns: observed.patterns.length,
    conventions: observed.conventions.length,
    intents: observed.intents.length,
    exceptions: observed.exceptions.length,
  }
}

function componentDetails(before: ComponentRecord, after: ComponentRecord): string[] {
  const details: string[] = []
  const addedVariants = after.variants.filter((item) => !before.variants.includes(item))
  const removedVariants = before.variants.filter((item) => !after.variants.includes(item))
  const addedSizes = after.sizes.filter((item) => !before.sizes.includes(item))
  if (addedVariants.length) details.push(`Added variant: ${addedVariants.join(", ")}`)
  if (removedVariants.length) details.push(`Removed variant: ${removedVariants.join(", ")}`)
  if (addedSizes.length) details.push(`Added size: ${addedSizes.join(", ")}`)
  const removedSizes = before.sizes.filter((item) => !after.sizes.includes(item))
  if (removedSizes.length) details.push(`Removed size: ${removedSizes.join(", ")}`)
  for (const prop of after.props) {
    const previous = before.props.find((item) => item.name === prop.name)
    if (!previous) details.push(`Added ${prop.required ? "required " : ""}prop: ${prop.name}`)
    else if (JSON.stringify(previous) !== JSON.stringify(prop)) details.push(`Changed prop contract: ${prop.name}`)
  }
  for (const prop of before.props) {
    if (!after.props.some((item) => item.name === prop.name)) details.push(`Removed prop: ${prop.name}`)
  }
  if (before.source !== after.source) details.push(`Source moved to ${after.source}`)
  return details
}

function diffCollection<T extends { id: string; status: ModelChange["status"]; confidence: ModelChange["confidence"] }>(opts: {
  kind: EntityKind
  observed: T[]
  canonical: T[]
  sig: (item: T) => unknown
  name: (item: T) => string
  inventory: boolean
  changes: ModelChange[]
  model: CanonicalModel
  details?: (before: T, after: T) => string[]
}) {
  for (const [label, items] of [["observed", opts.observed], ["canonical", opts.canonical]] as const) {
    const ids = new Set<string>()
    for (const item of items) {
      if (ids.has(item.id)) throw new Error(`Duplicate ${label} ${opts.kind} id: ${item.id}`)
      ids.add(item.id)
    }
  }
  const unmatched = new Set(opts.canonical)
  for (const item of opts.observed) {
    const key = recordIdentity(opts.kind, item)
    let current = [...unmatched].find((candidate) => candidate.id === item.id)
      ?? [...unmatched].find((candidate) => recordIdentity(opts.kind, candidate) === key)
    if (!current && opts.kind === "component") {
      const incoming = item as unknown as ComponentRecord
      const legacy = [...unmatched].filter((candidate) => {
        const component = candidate as unknown as ComponentRecord
        return component.source === incoming.source && component.name === incoming.name
      })
      // Old scanners stored a named function as exportName even for default exports.
      if (legacy.length === 1) current = legacy[0]
    }
    // Reconcile old name-only IDs without confusing distinct local components.
    if (!current && (opts.kind === "component" || opts.kind === "pattern")) {
      const sameName = [...unmatched].filter((candidate) => opts.name(candidate) === opts.name(item))
      const observedNames = opts.observed.filter((candidate) => opts.name(candidate) === opts.name(item))
      if (sameName.length === 1 && observedNames.length === 1) current = sameName[0]
    }
    if (!current && opts.kind === "pattern") {
      const incoming = item as unknown as PatternRecord
      const candidates = [...unmatched].filter((candidate) => {
        const pattern = candidate as unknown as PatternRecord
        return pattern.fingerprint === incoming.fingerprint || pattern.occurrences.some((occurrence) =>
          incoming.occurrences.some((other) => occurrence.file === other.file && occurrence.fingerprint === other.fingerprint))
      })
      if (candidates.length === 1) current = candidates[0]
    }
    if (!current) {
      pushChange(opts.changes, opts.model, {
        kind: "add",
        entity: opts.kind,
        name: opts.name(item),
        summary: `Add ${opts.kind} ${opts.name(item)}`,
        details: [],
        fingerprint: fingerprint(opts.kind, key, opts.sig(item)),
        confidence: item.confidence,
        status: opts.inventory ? "observed" : item.status,
        certain: opts.inventory || item.confidence === "high",
        after: item,
      })
      continue
    }
    unmatched.delete(current)
    const before = JSON.stringify(opts.sig(current))
    const after = JSON.stringify(opts.sig(item))
    if (before !== after) {
      pushChange(opts.changes, opts.model, {
        kind: "update",
        entity: opts.kind,
        name: opts.name(item),
        summary: `Update ${opts.kind} ${opts.name(item)}`,
        details: opts.details ? opts.details(current, item) : [],
        fingerprint: fingerprint(opts.kind, key, { before: opts.sig(current), after: opts.sig(item) }),
        confidence: item.confidence,
        status: current.status,
        certain: true,
        before: current,
        after: { ...item, id: current.id },
      })
    } else if (current.status === "suggested" || current.status === "inferred") {
      pushChange(opts.changes, opts.model, {
        kind: "update", entity: opts.kind, name: opts.name(current),
        summary: `Review ${opts.kind} ${opts.name(current)}`,
        details: ["Observed knowledge is awaiting approval."],
        fingerprint: fingerprint(opts.kind, key, opts.sig(current)),
        confidence: current.confidence, status: current.status, certain: false,
        before: current, after: current,
      })
    }
  }

  for (const item of unmatched) {
    const key = recordIdentity(opts.kind, item)
    const origin = (item as { originKind?: string }).originKind
    if (origin === "human") continue
    if (item.status === "approved" || item.status === "observed" || item.status === "suggested" || item.status === "inferred") {
      pushChange(opts.changes, opts.model, {
        kind: "remove",
        entity: opts.kind,
        name: opts.name(item),
        summary: `Remove ${opts.kind} ${opts.name(item)} — no longer observed`,
        details: [],
        fingerprint: fingerprint(opts.kind, key, "removed"),
        confidence: "medium",
        status: item.status,
        certain: false,
        before: item,
      })
    }
  }
}

export async function diffAgainstRepo(
  root: string,
  observed: ObservedSnapshot,
  canonical: CanonicalModel | undefined,
): Promise<SystemDiff> {
  const stale = canonical ? await generatedHashes(root, canonical).then((result) => result.stale) : []
  return diffModels(observed, canonical, { stale })
}
