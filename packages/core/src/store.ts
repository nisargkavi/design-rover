import fs from "node:fs/promises"
import path from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import {
  CanonicalModelSchema,
  ComponentRecordSchema,
  ConventionRecordSchema,
  ExceptionRecordSchema,
  IntentRecordSchema,
  PatternRecordSchema,
  TokenRecordSchema,
  nowIso,
  stableStringify,
  type CanonicalModel,
  type ComponentRecord,
  type ConventionRecord,
  type ExceptionRecord,
  type HistoryEvent,
  type IntentRecord,
  type PatternRecord,
  type RejectionRecord,
  type SystemRecord,
  type TokenRecord,
} from "@design-rover/model"
import { pathExists } from "./fs.ts"
import { specPaths } from "./paths.ts"
import { assertSafeWritePaths } from "./write-paths.ts"

type Parser<T> = { parse(value: unknown): T }

export class CanonicalConflictError extends Error {
  readonly code = "CANONICAL_CONFLICT"
}

async function listJsonFiles(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    return entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => path.join(dir, entry.name)).sort()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
    throw new Error(`Cannot read canonical directory ${dir}: ${String(error)}`)
  }
}

async function readJsonStrict<T>(file: string, fallback: T): Promise<T> {
  let raw: string
  try { raw = await fs.readFile(file, "utf8") }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback
    throw new Error(`Cannot read canonical file ${file}: ${String(error)}`)
  }
  try { return JSON.parse(raw) as T }
  catch { throw new Error(`Invalid JSON in canonical file ${file}. Repair it before saving or synchronizing.`) }
}

async function readRecords<T extends { id: string }>(dir: string, schema: Parser<T>): Promise<T[]> {
  const files = await listJsonFiles(dir)
  const records: T[] = []
  for (const file of files) {
    try {
      records.push(schema.parse(await readJsonStrict(file, undefined)))
    } catch (error) {
      throw new Error(`Invalid canonical record ${file}: ${String(error)}`)
    }
  }
  return records.sort((a, b) => a.id.localeCompare(b.id))
}

function recordFileName(id: string): string {
  if (!/^[a-z][a-z0-9-]*\.[a-z0-9][a-z0-9.-]*$/i.test(id) || id.includes("..")) {
    throw new Error(`Unsafe canonical record ID: ${id}`)
  }
  return `${id.slice(id.indexOf(".") + 1)}.json`
}

export function validateCanonical(model: CanonicalModel): CanonicalModel {
  const validated = CanonicalModelSchema.parse(model)
  const seen = new Set<string>()
  for (const [kind, records] of [
    ["token", validated.tokens], ["component", validated.components], ["pattern", validated.patterns],
    ["convention", validated.conventions], ["intent", validated.intents], ["exception", validated.exceptions],
  ] as const) {
    for (const record of records) {
      recordFileName(record.id)
      if (!record.id.startsWith(`${kind}.`)) throw new Error(`Invalid ${kind} record ID: ${record.id}`)
      if (seen.has(record.id)) throw new Error(`Duplicate canonical record ID: ${record.id}`)
      seen.add(record.id)
    }
  }
  return validated
}

async function readHistory(file: string): Promise<HistoryEvent[]> {
  let raw: string
  try { raw = await fs.readFile(file, "utf8") }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
    throw error
  }
  return raw.split("\n").flatMap((line, index) => {
    if (!line.trim()) return []
    try { return [JSON.parse(line) as HistoryEvent] }
    catch { throw new Error(`Invalid canonical history ${file}:${index + 1}. Repair it before saving.`) }
  })
}

export async function isInitialized(root: string): Promise<boolean> {
  return pathExists(specPaths(root).system)
}

async function assertCanonicalStorageSafe(root: string): Promise<void> {
  const dir = specPaths(root).dir
  await assertSafeWritePaths(root, [dir])
  if (!(await pathExists(dir))) return
  const targets: string[] = []
  const visit = async (directory: string): Promise<void> => {
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return []
      throw error
    })
    for (const entry of entries) {
      const target = path.join(directory, entry.name)
      targets.push(target)
      if (entry.isDirectory()) await visit(target)
    }
  }
  await visit(dir)
  await assertSafeWritePaths(root, targets)
}

async function assertNoOrphanedKnowledge(root: string): Promise<void> {
  const paths = specPaths(root)
  const directories = [paths.tokens, paths.components, paths.patterns, paths.conventions, paths.intents, paths.exceptions]
  const hasRecords = (await Promise.all(directories.map(listJsonFiles))).some((files) => files.length > 0)
  const hasState = (await Promise.all([paths.rejections, paths.baseline, paths.sources, paths.discrepancies, paths.historyLog]
    .map(pathExists))).some(Boolean)
  if (hasRecords || hasState) throw new Error(`Canonical system metadata is missing (${paths.system}), but existing knowledge or decisions remain. Recover system.json from a backup before initializing; existing records were left unchanged.`)
}

async function assertNoInterruptedSave(root: string): Promise<void> {
  const paths = specPaths(root)
  const recoveryMarker = path.join(paths.dir, ".recovery-required.json")
  if (await pathExists(recoveryMarker)) throw new Error(`Canonical storage needs recovery. Inspect ${recoveryMarker} before continuing.`)
  for (const entry of await fs.readdir(paths.dir, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.startsWith(".write-") && await pathExists(path.join(paths.dir, entry.name, "recovery.json"))) {
      throw new Error(`Canonical storage has an interrupted save. Inspect ${path.join(paths.dir, entry.name, "recovery.json")} and recover its backup before continuing.`)
    }
  }
}

async function acquireCanonicalLock(lockFile: string): Promise<Awaited<ReturnType<typeof fs.open>>> {
  const timeoutMs = 1500
  const deadline = performance.now() + timeoutMs
  for (;;) {
    try { return await fs.open(lockFile, "wx") }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
      const remaining = deadline - performance.now()
      if (remaining <= 0) {
        throw new Error(`Canonical model is busy with another read or write (${lockFile}) after waiting ${timeoutMs}ms. Retry after it finishes. If a process stopped unexpectedly, verify no reader or writer is active before manually removing its stale lock.`)
      }
      // Keep readers exclusive too: a save replaces several canonical files.
      // A lock's age cannot prove its owner is dead, so never remove it here.
      await delay(Math.min(25, remaining))
    }
  }
}

async function loadCanonicalUnlocked(root: string): Promise<CanonicalModel | undefined> {
  const paths = specPaths(root)
  await assertNoInterruptedSave(root)
  if (!(await pathExists(paths.system))) {
    await assertNoOrphanedKnowledge(root)
    return undefined
  }
  const system = await readJsonStrict<SystemRecord | undefined>(paths.system, undefined)
  if (!system) throw new Error(`Invalid canonical system ${paths.system}.`)
  const history = await readHistory(paths.historyLog)

  const model: CanonicalModel = {
    system,
    tokens: await readRecords<TokenRecord>(paths.tokens, TokenRecordSchema),
    components: await readRecords<ComponentRecord>(paths.components, ComponentRecordSchema),
    patterns: await readRecords<PatternRecord>(paths.patterns, PatternRecordSchema),
    conventions: await readRecords<ConventionRecord>(paths.conventions, ConventionRecordSchema),
    intents: await readRecords<IntentRecord>(paths.intents, IntentRecordSchema),
    exceptions: await readRecords<ExceptionRecord>(paths.exceptions, ExceptionRecordSchema),
    rejections: await readJsonStrict<RejectionRecord[]>(paths.rejections, []),
    baseline: await readJsonStrict(paths.baseline, undefined),
    sources: await readJsonStrict(paths.sources, []),
    discrepancies: await readJsonStrict(paths.discrepancies, []),
    history,
  }
  try { return validateCanonical(model) }
  catch (error) { throw new Error(`Invalid canonical model in ${paths.dir}: ${String(error)}`) }
}

export async function loadCanonical(root: string): Promise<CanonicalModel | undefined> {
  const paths = specPaths(root)
  // Reading an uninitialized repository must not create a canonical directory.
  if (!(await pathExists(paths.dir))) return undefined
  await assertCanonicalStorageSafe(root)
  const lockFile = path.join(paths.dir, ".write.lock")
  const lock = await acquireCanonicalLock(lockFile)
  try { return await loadCanonicalUnlocked(root) }
  finally {
    await lock.close()
    await fs.rm(lockFile, { force: true })
  }
}

export async function saveCanonical(root: string, model: CanonicalModel, options: { expected?: CanonicalModel | null } = {}): Promise<CanonicalModel> {
  model = validateCanonical(model)
  const paths = specPaths(root)
  await assertCanonicalStorageSafe(root)
  await fs.mkdir(paths.dir, { recursive: true })
  const lockFile = path.join(paths.dir, ".write.lock")
  const lock = await acquireCanonicalLock(lockFile)
  let staging: string | undefined
  let retainRecovery = false
  try {
    // Refuse to overwrite or prune unreadable existing knowledge.
    const current = await loadCanonicalUnlocked(root)
    if ("expected" in options) {
      const expected = options.expected ? stableStringify(validateCanonical(options.expected)) : null
      const actual = current ? stableStringify(current) : null
      if (actual !== expected) throw new CanonicalConflictError("Canonical model changed during this operation. No decisions were saved. Reload the model and review the change again.")
    }
    // Runtime paths come from the engine root, not one developer's checkout.
    model = { ...model, system: { ...model.system, repository: { ...model.system.repository, root: "." } } }
    const writes = new Map<string, string>()
    const obsolete: string[] = []
    for (const [dir, records] of [
      [paths.tokens, model.tokens], [paths.components, model.components], [paths.patterns, model.patterns],
      [paths.conventions, model.conventions], [paths.intents, model.intents], [paths.exceptions, model.exceptions],
    ] as const) {
      const keep = new Set(records.map((record) => path.join(dir, recordFileName(record.id))))
      for (const file of await listJsonFiles(dir)) if (!keep.has(file)) obsolete.push(file)
      for (const record of records) writes.set(path.join(dir, recordFileName(record.id)), stableStringify(record))
    }
    let currentIgnore = ""
    try { currentIgnore = await fs.readFile(paths.gitignore, "utf8") }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error }
    const existingIgnore = new Set(currentIgnore.split("\n").map((line) => line.trim()))
    const missingIgnore = ["cache/", ".write*/", ".write.lock", ".recovery-required.json"].filter((entry) => !existingIgnore.has(entry))
    writes.set(paths.gitignore, currentIgnore + (currentIgnore && !currentIgnore.endsWith("\n") ? "\n" : "") + missingIgnore.map((entry) => `${entry}\n`).join(""))
    writes.set(paths.rejections, stableStringify(model.rejections))
    writes.set(paths.sources, stableStringify(model.sources))
    writes.set(paths.discrepancies, stableStringify(model.discrepancies))
    if (model.baseline) writes.set(paths.baseline, stableStringify(model.baseline))
    else if (await pathExists(paths.baseline)) obsolete.push(paths.baseline)
    const history = await readHistory(paths.historyLog)
    const seen = new Set(history.map((event) => event.ts + event.summary))
    for (const event of model.history) {
      if (!seen.has(event.ts + event.summary)) {
        history.push(event)
        seen.add(event.ts + event.summary)
      }
    }
    writes.set(paths.historyLog, history.map((event) => JSON.stringify(event)).join("\n") + (history.length ? "\n" : ""))
    // Write all bytes before replacing any file, and prune only after every replacement succeeds.
    writes.set(paths.system, stableStringify(model.system))
    await assertSafeWritePaths(root, [...writes.keys(), ...obsolete, path.join(paths.dir, ".recovery-required.json")])
    staging = await fs.mkdtemp(path.join(paths.dir, ".write-"))
    const staged: [string, string][] = []
    for (const [destination, content] of writes) {
      const temporary = path.join(staging, `new-${staged.length}`)
      await fs.writeFile(temporary, content, "utf8")
      staged.push([temporary, destination])
    }
    const recovery: { destination: string; backup: string | null }[] = []
    for (const destination of new Set([...writes.keys(), ...obsolete])) {
      const backup = path.join(staging, `old-${recovery.length}`)
      try {
        await fs.copyFile(destination, backup)
        recovery.push({ destination, backup })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
        recovery.push({ destination, backup: null })
      }
    }
    await fs.writeFile(path.join(staging, "recovery.json"), JSON.stringify({
      canonicalDirectory: paths.dir,
      files: recovery.map((item) => ({ path: path.relative(paths.dir, item.destination), backup: item.backup ? path.basename(item.backup) : null })),
    }, null, 2))
    const marker = path.join(paths.dir, ".recovery-required.json")
    const journal = await fs.open(marker, "wx")
    try {
      await journal.writeFile(JSON.stringify({ backup: staging, manifest: path.join(staging, "recovery.json"), state: "installing" }, null, 2))
      await journal.sync()
    } catch (error) {
      await fs.rm(marker, { force: true })
      throw error
    } finally { await journal.close() }
    try {
      for (const [temporary, destination] of staged) {
        await fs.mkdir(path.dirname(destination), { recursive: true })
        await fs.rename(temporary, destination)
      }
      for (const file of obsolete) await fs.rm(file)
      await fs.mkdir(paths.generated, { recursive: true })
      await fs.rm(marker)
    } catch (error) {
      const failures: unknown[] = []
      for (const [index, item] of recovery.entries()) {
        try {
          if (item.backup === null) await fs.rm(item.destination, { force: true })
          else {
            const temporary = path.join(staging, `restore-${index}`)
            await fs.copyFile(item.backup, temporary)
            await fs.mkdir(path.dirname(item.destination), { recursive: true })
            await fs.rename(temporary, item.destination)
          }
        } catch (rollbackError) { failures.push(rollbackError) }
      }
      if (failures.length) {
        retainRecovery = true
        await fs.writeFile(marker, JSON.stringify({ backup: staging, manifest: path.join(staging, "recovery.json") }, null, 2))
        throw new AggregateError([error, ...failures], `Canonical save and rollback failed. Retained recovery backup at ${staging}; inspect ${marker}.`)
      }
      await fs.rm(marker, { force: true })
      throw error
    }
    return { ...model, history }
  } finally {
    if (staging && !retainRecovery) await fs.rm(staging, { recursive: true, force: true })
    await lock.close()
    await fs.rm(lockFile, { force: true })
  }
}

export function emptyCanonical(root: string, name: string): CanonicalModel {
  const ts = nowIso()
  return {
    system: {
      version: 1,
      createdAt: ts,
      updatedAt: ts,
      repository: { name, root: "." },
      framework: { name: "unknown" },
      styling: { systems: [] },
      componentLibraries: [],
      documentation: [],
      syncStatus: "uninitialized",
      enforcement: {},
      generated: [],
      privacy: { network: "off" },
      generate: {
        agentsMd: true,
        claudeMd: true,
        cursorRules: true,
        skill: true,
      },
    },
    tokens: [],
    components: [],
    patterns: [],
    conventions: [],
    intents: [],
    exceptions: [],
    rejections: [],
    sources: [],
    discrepancies: [],
    history: [],
  }
}

export async function appendHistory(root: string, event: HistoryEvent): Promise<void> {
  const model = await loadCanonical(root)
  if (!model) throw new Error("Cannot append history before initialization.")
  await saveCanonical(root, { ...model, history: [...model.history, event] })
}
