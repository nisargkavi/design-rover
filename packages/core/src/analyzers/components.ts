import path from "node:path"
import { entityId, type ComponentRecord } from "@design-rover/model"
import type { ExtractedComponent, RepoEvidence } from "../evidence.ts"
import { shortHash } from "../hash.ts"
import { resolveComponent } from "../component-resolution.ts"

function isUiPath(file: string): boolean {
  return /(^|\/)(components\/ui|ui\/|components\/primitives)\//.test(file)
}

function isFeatureLocal(file: string): boolean {
  return (
    /(^|\/)app\/.*\/_components\//.test(file) ||
    /(^|\/)app\/.*\/components\//.test(file) ||
    /(^|\/)features\//.test(file)
  )
}

function isPageFile(file: string): boolean {
  return /(^|\/)(page|layout|route|template)\.(t|j)sx?$/.test(file)
}

function importPathFor(
  evidence: RepoEvidence,
  file: string,
  name: string,
): string {
  const aliases = (evidence.componentsJson?.aliases ?? {}) as Record<string, string>
  if (aliases.ui && isUiPath(file)) {
    const base = path.posix.basename(file).replace(/\.(tsx|jsx|ts|js)$/, "")
    return `${aliases.ui}/${base}`
  }
  if (aliases.components && file.includes("components/")) {
    const rest = file.split("components/")[1]?.replace(/\.(tsx|jsx|ts|js)$/, "")
    if (rest) return `${aliases.components}/${rest}`
  }
  const paths = evidence.tsconfigPaths
  const at = paths["@/*"]?.[0]
  if (at) {
    const prefix = at.replace(/\*$/, "").replace(/^\.\//, "")
    if (file.startsWith(prefix)) {
      return `@/${file.slice(prefix.length).replace(/\.(tsx|jsx|ts|js)$/, "")}`
    }
  }
  return `./${file.replace(/\.(tsx|jsx|ts|js)$/, "")}`
}

function componentUsages(evidence: RepoEvidence, candidates: { name: string; source: string; exportName: string }[]) {
  const usages = new Map<string, Map<string, number>>()
  for (const file of evidence.files) {
    for (const jsx of file.jsx) {
      const resolved = resolveComponent(evidence, file, jsx.tag, candidates)
      if (!resolved || resolved.source === file.relative) continue
      const key = JSON.stringify([resolved.source, resolved.exportName])
      const usage = usages.get(key) ?? new Map<string, number>()
      usage.set(file.relative, (usage.get(file.relative) ?? 0) + 1)
      usages.set(key, usage)
    }
  }
  return new Map([...usages].map(([key, usage]) => [key, [...usage.entries()]
    .map(([file, count]) => ({ file, count })).sort((a, b) => a.file.localeCompare(b.file))]))
}

function relatedTokens(classNames: string[], tokenNames: string[]): string[] {
  const related = new Set<string>()
  for (const cls of classNames) {
    for (const token of tokenNames) {
      const needle = token.replace(/^--/, "")
      if (cls.includes(needle)) related.add(token)
    }
  }
  return [...related].sort()
}

export function analyzeComponents(
  evidence: RepoEvidence,
  tokenNames: string[],
): ComponentRecord[] {
  const records: ComponentRecord[] = []
  const candidates = evidence.files.flatMap((file) => file.components.map((component) => ({
    name: component.name, source: file.relative, exportName: component.isDefault ? "default" : component.exportName,
  })))
  const usages = componentUsages(evidence, candidates)

  for (const file of evidence.files) {
    for (const component of file.components) {
      if (!component.exported && isPageFile(file.relative)) continue
      if (!component.exported && !isUiPath(file.relative) && !isFeatureLocal(file.relative)) {
        continue
      }

      const exportName = component.isDefault ? "default" : component.exportName
      const usage = usages.get(JSON.stringify([file.relative, exportName])) ?? []
      const architecture = isUiPath(file.relative)
        ? "shared"
        : isFeatureLocal(file.relative)
          ? "feature-local"
          : isPageFile(file.relative)
            ? "colocated"
            : usage.length >= 2
              ? "shared"
              : "feature-local"

      const local = architecture !== "shared"
      const identity = `${file.relative}:${exportName}`
      const key = entityId("component", `${component.name}-${shortHash(identity, 16)}`)

      records.push(toRecord(evidence, component, usage, architecture, local, key, tokenNames))
    }
  }

  return records.sort((a, b) => a.id.localeCompare(b.id))
}

function toRecord(
  evidence: RepoEvidence,
  component: ExtractedComponent,
  usage: { file: string; count: number }[],
  architecture: ComponentRecord["architecture"],
  local: boolean,
  id: string,
  tokenNames: string[],
): ComponentRecord {
  return {
    id,
    name: component.name,
    source: component.file,
    importPath: importPathFor(evidence, component.file, component.name),
    exportName: component.isDefault ? "default" : component.exportName,
    props: component.props.map((prop) => ({
      name: prop.name,
      type: prop.type,
      required: prop.required,
      values: prop.values,
    })),
    variants: component.variants,
    sizes: component.sizes,
    composition: component.composition,
    dependencies: component.composition,
    relatedTokens: relatedTokens(component.classNames, tokenNames),
    usage,
    examples: usage.slice(0, 3).map((item) => item.file),
    architecture,
    local,
    status: "observed",
    confidence: "high",
    originKind: "implementation",
    evidence: [
      {
        id: `${id}:source`,
        kind: "component-declaration",
        description: `${component.name} declared in ${component.file}`,
        location: { file: component.file, startLine: component.startLine },
        count: usage.length,
      },
    ],
  }
}
