import path from "node:path"
import type { FileEvidence, RepoEvidence } from "./evidence.ts"
import { localModules } from "./local-modules.ts"

type ComponentIdentity = { name: string; source: string; exportName: string; importPath?: string }
const withoutExtension = (file: string) => file.replace(/\.(?:tsx?|jsx?|mts|cts|mjs|cjs)$/, "")

function targets(evidence: RepoEvidence, file: string, source: string): string[] {
  if (source.startsWith(".")) return [path.posix.normalize(path.posix.join(path.posix.dirname(file), source))]
  const found: string[] = []
  for (const [alias, values] of Object.entries(evidence.tsconfigPaths)) {
    const star = alias.indexOf("*")
    if (star < 0) {
      if (alias === source) found.push(...values)
    } else {
      const prefix = alias.slice(0, star)
      const suffix = alias.slice(star + 1)
      if (source.startsWith(prefix) && source.endsWith(suffix)) {
        const rest = source.slice(prefix.length, suffix ? -suffix.length : undefined)
        found.push(...values.map((value) => value.replace("*", rest)))
      }
    }
  }
  return found.map((value) => path.posix.normalize(value.replace(/^\.\//, "")))
}

/** Resolve a JSX tag by import binding and module. Ambiguous or unsupported imports stay unresolved. */
export function resolveComponent<T extends ComponentIdentity>(
  evidence: RepoEvidence,
  file: FileEvidence,
  tag: string,
  components: T[],
  options: { allowUnbound?: boolean } = {},
): T | undefined {
  if (tag.split(".").length > 2) return undefined
  const [local, member] = tag.split(".")
  const imports = file.imports.filter((item) => !item.isTypeOnly)
  let bound = false
  const matches = new Set<T>()
  const graph = localModules(evidence)
  for (const item of imports) {
    const bindings: { local: string; imported: string; isTypeOnly?: boolean }[] = item.bindings ?? [
      ...item.names.map((name) => ({ local: name, imported: name })),
      ...(item.defaultName ? [{ local: item.defaultName, imported: "default" }] : []),
    ]
    const binding = bindings.find((value) => value.local === local)
    if (!binding) continue
    bound = true
    if (binding.isTypeOnly) continue
    if ((binding.imported === "*") !== Boolean(member)) continue
    const exported = member ?? binding.imported
    const resolution = graph.resolveExport(file.relative, item.source, exported, "value")
    if (resolution.module) {
      if (resolution.issues.length || resolution.targets.length !== 1) continue
      const target = resolution.targets[0]!
      for (const component of components) if (component.source === target.file && component.name === target.name) matches.add(component)
      continue
    }
    const modules = targets(evidence, file.relative, item.source)
    for (const component of components) {
      const moduleMatch = (!item.source.startsWith(".") && component.importPath === item.source) || modules.some((target) => {
        const source = withoutExtension(component.source)
        return source === withoutExtension(target) || source === `${target}/index`
      })
      if (!moduleMatch || component.source === file.relative) continue
      if (component.exportName === exported || (exported !== "default" && component.name === exported)) matches.add(component)
    }
  }
  if (matches.size === 1) return [...matches][0]
  if (bound || matches.size > 1) return undefined
  const localComponents = components.filter((item) => item.source === file.relative && item.name === tag)
  if (localComponents.length === 1) return localComponents[0]
  if (!options.allowUnbound) return undefined
  const candidates = components.filter((item) => item.name === tag)
  return candidates.length === 1 ? candidates[0] : undefined
}
