import { nowIso, type CanonicalModel, type ModelChange, type ObservedSnapshot } from "@design-rover/model"
import { diffAgainstRepo } from "./diff.ts"
import { writeGenerated } from "./context.ts"
import { saveCanonical } from "./store.ts"

export type ApplyOptions = {
  ids?: string[]
  reject?: boolean
  approveInferred?: boolean
  generate?: boolean
}

const COLLECTIONS = {
  component: "components", token: "tokens", pattern: "patterns",
  convention: "conventions", intent: "intents", exception: "exceptions",
} as const
type KnowledgeRecord = CanonicalModel[typeof COLLECTIONS[keyof typeof COLLECTIONS]][number]

function updateCollection(model: CanonicalModel, entity: ModelChange["entity"], update: (items: KnowledgeRecord[]) => KnowledgeRecord[]): CanonicalModel {
  const collection = COLLECTIONS[entity as keyof typeof COLLECTIONS]
  if (!collection) return model
  return { ...model, [collection]: update(model[collection]) } as CanonicalModel
}

function isPending(item: { status: string }) {
  return item.status === "suggested" || item.status === "inferred"
}

export function applyChange(
  model: CanonicalModel,
  change: ModelChange,
  reject = false,
): CanonicalModel {
  if (reject) {
    const before = change.before as KnowledgeRecord | undefined
    if (before && isPending(before)) {
      model = updateCollection(model, change.entity, (items) => items.map((item) =>
        item.id === before.id ? { ...item, status: "rejected" as const } : item))
    }
    model = {
      ...model,
      rejections: [
        ...model.rejections.filter((item) => item.fingerprint !== change.fingerprint),
        {
          fingerprint: change.fingerprint,
          kind: change.entity,
          summary: change.summary,
          rejectedAt: nowIso(),
        },
      ],
    }
  } else if ((change.kind === "add" || change.kind === "update") && change.after) {
    const incoming = change.after as KnowledgeRecord
    const before = change.before as KnowledgeRecord | undefined
    model = updateCollection(model, change.entity, (items) => {
      const targetId = before?.id ?? incoming.id
      const current = items.find((item) => item.id === targetId)
      const inventory = change.entity === "component" || change.entity === "token"
      const accepted = {
        ...current, ...incoming, id: targetId,
        status: current?.status === "approved" || !inventory ? "approved" as const : incoming.status,
        approvedAt: current?.approvedAt ?? nowIso(),
        ...(current?.notes !== undefined ? { notes: current.notes } : {}),
        ...(current?.approvedBy !== undefined ? { approvedBy: current.approvedBy } : {}),
        ...(change.entity === "convention" && current?.status === "approved" && "guidance" in current
          ? { guidance: current.guidance } : {}),
        ...(change.entity === "pattern" && current?.status === "approved" && "occurrences" in current
          ? { guidance: current.guidance, architecture: current.architecture, implementation: current.implementation } : {}),
        ...(change.entity === "intent" && current?.status === "approved" && "productionAssetRequired" in current
          ? { required: current.required, optional: current.optional, placeholderAllowed: current.placeholderAllowed, productionAssetRequired: current.productionAssetRequired } : {}),
        ...(change.entity === "exception" && current?.status === "approved" && "allows" in current
          ? { reason: current.reason, allows: current.allows, scope: current.scope } : {}),
      } as KnowledgeRecord
      return [...items.filter((item) => item.id !== targetId), accepted].sort((a, b) => a.id.localeCompare(b.id))
    })
  } else if (change.kind === "remove" && change.before) {
    const id = (change.before as { id: string }).id
    model = updateCollection(model, change.entity, (items) => items.filter((item) => item.id !== id))
  }

  return {
    ...model,
    history: [
      ...model.history,
      {
        ts: nowIso(),
        type: reject ? "rejected" : change.kind,
        entity: change.name,
        summary: reject ? `Rejected: ${change.summary}` : change.summary,
      },
    ],
  }
}

export async function applyChanges(
  root: string,
  model: CanonicalModel,
  changes: ModelChange[],
  options: ApplyOptions = {},
): Promise<CanonicalModel> {
  let next = model
  const matches = (change: ModelChange, id: string) => change.id === id
    || (change.before as { id?: string } | undefined)?.id === id
    || (change.after as { id?: string } | undefined)?.id === id
    || change.name === id
  for (const id of options.ids ?? []) {
    const matchesForId = changes.filter((change) => matches(change, id))
    if (!matchesForId.length) throw new Error(`No pending change or inference matches ${id}.`)
    if (matchesForId.length > 1) throw new Error(`Ambiguous change name ${id}; use an entity ID or change ID.`)
  }
  const selected = options.ids ? changes.filter((change) => options.ids!.some((id) => matches(change, id))) : changes
  for (const change of selected) {
    next = applyChange(next, change, options.reject)
  }
  if (options.approveInferred && !options.reject && !options.ids?.length) {
    next = {
      ...next,
      patterns: next.patterns.map((item) =>
        item.status === "suggested" || item.status === "inferred"
          ? { ...item, status: "approved" as const, approvedAt: nowIso() }
          : item,
      ),
      conventions: next.conventions.map((item) =>
        item.status === "suggested" || item.status === "inferred"
          ? { ...item, status: "approved" as const, approvedAt: nowIso() }
          : item,
      ),
      intents: next.intents.map((item) =>
        item.status === "suggested" || item.status === "inferred"
          ? { ...item, status: "approved" as const, approvedAt: nowIso() }
          : item,
      ),
      exceptions: next.exceptions.map((item) =>
        item.status === "suggested"
          ? { ...item, status: "approved" as const, approvedAt: nowIso() }
          : item,
      ),
    }
  }
  const unhandled = changes.filter((change) => !selected.includes(change) && !(change.before === change.after
    && Object.values(COLLECTIONS).some((key) => next[key].some((item) =>
      item.id === (change.before as { id?: string } | undefined)?.id && !isPending(item)))))
  next = {
    ...next,
    system: {
      ...next.system,
      updatedAt: nowIso(),
      lastSyncAt: nowIso(),
      syncStatus: unhandled.length ? "drift"
        : Object.values(COLLECTIONS).some((key) => next[key].some(isPending)) ? "pending-review" : "synchronized",
    },
  }
  if (options.generate !== false) {
    const generated = await writeGenerated(root, next, { writeRepoFiles: true })
    next = { ...next, system: { ...next.system, generated: generated.files } }
  }
  await saveCanonical(root, next)
  return next
}

export async function seedCanonical(
  root: string,
  name: string,
  observed: ObservedSnapshot,
  existing: CanonicalModel,
): Promise<CanonicalModel> {
  const seeded: CanonicalModel = {
    ...existing,
    system: {
      ...existing.system,
      updatedAt: nowIso(),
      lastAnalyzedAt: observed.analyzedAt,
      lastSyncAt: nowIso(),
      framework: observed.framework,
      styling: observed.styling,
      componentLibraries: observed.componentLibraries,
      documentation: observed.documentation,
      syncStatus: "pending-review",
      repository: { ...existing.system.repository, name },
    },
    tokens: observed.tokens,
    components: observed.components,
    patterns: observed.patterns,
    conventions: observed.conventions,
    intents: observed.intents,
    exceptions: observed.exceptions,
    history: [
      ...existing.history,
      {
        ts: nowIso(),
        type: "init",
        summary: `Initialized from ${observed.filesAnalyzed} files`,
      },
    ],
  }
  await saveCanonical(root, seeded)
  return seeded
}

export async function pendingDiff(root: string, observed: ObservedSnapshot, model: CanonicalModel) {
  return diffAgainstRepo(root, observed, model)
}
