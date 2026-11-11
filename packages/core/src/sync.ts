import { nowIso, type CanonicalModel, type ModelChange, type ObservedSnapshot } from "@design-rover/model"
import { diffAgainstRepo, explicitReviewChange } from "./diff.ts"
import { writeGenerated } from "./context.ts"
import { CanonicalConflictError, isInitialized, saveCanonical } from "./store.ts"

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

function isProtectedRemoval(change: ModelChange): boolean {
  if (change.kind !== "remove" || !change.before) return false
  const before = change.before as KnowledgeRecord
  return before.status === "approved" || before.notes !== undefined
    || before.approvedBy !== undefined || before.originKind === "human"
}

export function applyChange(
  model: CanonicalModel,
  change: ModelChange,
  reject = false,
  approve = false,
): CanonicalModel {
  const reviewOnly = change.before !== undefined && change.before === change.after
  if (reject) {
    const before = change.before as KnowledgeRecord | undefined
    if (before && (isPending(before) || reviewOnly)) {
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
        status: approve || reviewOnly || current?.status === "approved" || !inventory ? "approved" as const : incoming.status,
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
    if (reviewOnly) model = { ...model, rejections: model.rejections.filter((item) => item.fingerprint !== change.fingerprint) }
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
        type: reject ? "rejected" : approve || reviewOnly ? "approved" : change.kind,
        entity: change.name,
        summary: reject ? `Rejected: ${change.summary}` : approve || reviewOnly ? `Approved ${change.entity} ${change.name}` : change.summary,
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
  const expected = await isInitialized(root) ? model : null
  let next = model
  changes = [...changes]
  const matches = (change: ModelChange, id: string) => change.id === id
    || (change.before as { id?: string } | undefined)?.id === id
    || (change.after as { id?: string } | undefined)?.id === id
    || change.name === id
  for (const id of options.ids ?? []) {
    const requestedRemoval = changes.find((change) => isProtectedRemoval(change) && matches(change, id))
    if (!options.reject && requestedRemoval && requestedRemoval.id !== id) {
      throw new Error(`Removing protected knowledge requires explicit review of its removal change. Use approve ${requestedRemoval.id} after reviewing it; an entity ID or name cannot accept this removal.`)
    }
    const rejectingRemoval = options.reject && changes.some((change) => change.kind === "remove" && matches(change, id))
    const records = Object.entries(COLLECTIONS).flatMap(([kind, collection]) => model[collection].map((record) => ({ kind: kind as keyof typeof COLLECTIONS, record })))
    const targets = records.filter(({ record }) => record.id === id || (record.status === "rejected" && ("name" in record ? record.name : record.subject) === id))
    if (!rejectingRemoval && targets.length === 1 && (targets[0]!.record.id === id || !changes.some((change) => matches(change, id)))) {
      const { kind, record } = targets[0]!
      if (record.status === "rejected" || (!options.reject && record.status === "observed") || (options.reject && (record.status === "approved" || record.status === "observed"))) {
        const incomingUpdates = changes.filter((change) => change.kind === "update" && (change.before as { id?: string } | undefined)?.id === record.id && change.before !== change.after)
        // Explicit approval accepts the incoming observation as well as its
        // status. A status-only review must not replace newer API/context data.
        if (options.reject || !incomingUpdates.length) {
          changes = changes.filter((change) => (change.before as { id?: string } | undefined)?.id !== record.id)
          changes.push(explicitReviewChange(kind, record))
        }
      }
    }
    const matchesForId = changes.filter((change) => matches(change, id))
    if (!matchesForId.length) throw new Error(`No pending change or inference matches ${id}.`)
    if (matchesForId.length > 1) throw new Error(`Ambiguous change name ${id}; use an entity ID or change ID.`)
  }
  const selected = (options.ids ? changes.filter((change) => options.ids!.some((id) => matches(change, id))) : changes)
    .filter((change) => options.reject || !isProtectedRemoval(change) || options.ids?.includes(change.id))
  for (const change of selected) {
    const approveEntity = !options.reject && Boolean(options.ids?.some((id) => id === (change.before as { id?: string } | undefined)?.id))
    next = applyChange(next, change, options.reject, approveEntity)
  }
  if (options.approveInferred && !options.reject && !options.ids?.length) {
    const protectedMissingIds = new Set(changes.filter(isProtectedRemoval).map((change) => (change.before as KnowledgeRecord).id))
    const canApprovePending = (item: KnowledgeRecord) => isPending(item) && !protectedMissingIds.has(item.id)
    const approved = Object.entries(COLLECTIONS).flatMap(([kind, collection]) => next[collection]
      .filter(canApprovePending).map((item) => ({ ts: nowIso(), type: "approved", entity: "name" in item ? item.name : item.subject, summary: `Approved ${kind} ${"name" in item ? item.name : item.subject}` })))
    next = {
      ...next,
      history: [...next.history, ...approved],
      patterns: next.patterns.map((item) =>
        canApprovePending(item)
          ? { ...item, status: "approved" as const, approvedAt: nowIso() }
          : item,
      ),
      conventions: next.conventions.map((item) =>
        canApprovePending(item)
          ? { ...item, status: "approved" as const, approvedAt: nowIso() }
          : item,
      ),
      intents: next.intents.map((item) =>
        canApprovePending(item)
          ? { ...item, status: "approved" as const, approvedAt: nowIso() }
          : item,
      ),
      exceptions: next.exceptions.map((item) =>
        item.status === "suggested" && !protectedMissingIds.has(item.id)
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
  if (options.generate !== false) await writeGenerated(root, next, { writeRepoFiles: true, dryRun: true })
  next = await saveCanonical(root, next, { expected })
  if (options.generate !== false) {
    const persisted = next
    try {
      const generated = await writeGenerated(root, next, { writeRepoFiles: true })
      next = { ...next, system: { ...next.system, generated: generated.files } }
      next = await saveCanonical(root, next, { expected: persisted })
    } catch (error) {
      const reason = error instanceof CanonicalConflictError ? "Another writer changed the model before its projection manifest could be installed." : String(error)
      throw new Error(`Review decisions were saved, but generated guidance may be stale. Run design-rover generate after other writers finish. ${reason}`)
    }
  }
  return next
}

export async function seedCanonical(
  root: string,
  name: string,
  observed: ObservedSnapshot,
  existing: CanonicalModel,
  options: { generate?: boolean } = {},
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
  if (options.generate) await writeGenerated(root, seeded, { writeRepoFiles: true, dryRun: true })
  return saveCanonical(root, seeded, { expected: null })
}

export async function pendingDiff(root: string, observed: ObservedSnapshot, model: CanonicalModel) {
  return diffAgainstRepo(root, observed, model)
}
