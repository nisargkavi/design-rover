import { entityId, type PatternRecord } from "@design-rover/model"
import { shortHash } from "../hash.ts"
import type { RepoEvidence, SectionHit } from "../evidence.ts"

function fingerprintOf(section: SectionHit): string {
  const tags = [...new Set(section.tags)].sort().join(",")
  const comps = [...new Set(section.components)].sort().join(",")
  const fam = [...new Set(section.classFamilies)].sort().join(",")
  return `t:${tags}|c:${comps}|f:${fam}|n:${section.childCount}`
}

function tokens(fp: string): Set<string> {
  return new Set(fp.split(/[|:]+/).filter(Boolean))
}

function similarity(a: string, b: string): number {
  const left = tokens(a)
  const right = tokens(b)
  let inter = 0
  for (const item of left) if (right.has(item)) inter += 1
  const union = new Set([...left, ...right]).size
  return union === 0 ? 1 : inter / union
}

function nameFor(cluster: SectionHit[]): string {
  const hints = cluster.map((item) => item.nameHint).filter((item): item is string => Boolean(item))
  if (hints.length) {
    const counts = new Map<string, number>()
    for (const hint of hints) counts.set(hint, (counts.get(hint) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? hints[0]!
  }
  const headings = cluster.map((item) => item.heading).filter((item): item is string => Boolean(item))
  if (headings.length) {
    const first = headings[0]!.replace(/\s+/g, "")
    if (first) return first.slice(0, 48)
  }
  const dirs = cluster.map((item) => item.file.split("/").slice(-2, -1)[0] ?? "Section")
  const common = dirs[0]
  if (common && dirs.every((dir) => dir === common)) {
    return `${common[0]?.toUpperCase()}${common.slice(1)}Section`
  }
  const comps = cluster.flatMap((item) => item.components)
  if (comps[0]) return `${comps[0]}Cluster`
  return `Pattern ${shortHash(fingerprintOf(cluster[0]!), 6)}`
}

export function analyzePatterns(evidence: RepoEvidence): PatternRecord[] {
  const sections = evidence.files.flatMap((file) =>
    file.sections.map((section) => ({ ...section, fingerprint: fingerprintOf(section) })),
  )
  const used = new Set<number>()
  const records: PatternRecord[] = []

  for (let i = 0; i < sections.length; i += 1) {
    if (used.has(i)) continue
    const seed = sections[i]
    if (!seed) continue
    const cluster = [seed]
    used.add(i)
    for (let j = i + 1; j < sections.length; j += 1) {
      if (used.has(j)) continue
      const other = sections[j]
      if (!other) continue
      if (other.file === seed.file && other.startLine === seed.startLine) continue
      if (similarity(seed.fingerprint, other.fingerprint) >= 0.78) {
        cluster.push(other)
        used.add(j)
      }
    }
    if (cluster.length < 2) continue

    const files = new Set(cluster.map((item) => item.file))
    const sims = cluster.map((item) => similarity(seed.fingerprint, item.fingerprint))
    const avg = sims.reduce((sum, value) => sum + value, 0) / sims.length
    const name = nameFor(cluster)
    // A display name is not identity: separate clusters can have the same heading.
    const representative = [...cluster.map((item) => item.fingerprint)].sort()[0]!
    const id = entityId("pattern", shortHash(representative, 16))
    const fingerprint = shortHash(cluster.map((item) => item.fingerprint).sort().join("|"))

    records.push({
      id,
      name,
      occurrences: cluster
        .map((item) => ({
          file: item.file,
          nameHint: item.nameHint,
          startLine: item.startLine,
          fingerprint: item.fingerprint,
        }))
        .sort((a, b) => a.file.localeCompare(b.file)),
      implementation: "colocated",
      architecture: "do-not-extract",
      similarity: Number(avg.toFixed(3)),
      fingerprint,
      guidance:
        "This is a recurring composition, not a missing component. Keep it colocated unless the repository already extracts it.",
      status: "suggested",
      confidence: avg >= 0.9 ? "high" : avg >= 0.82 ? "medium" : "low",
      originKind: "implementation",
      evidence: [
        {
          id: `${id}:cluster`,
          kind: "structural-similarity",
          description: `${cluster.length} occurrences across ${files.size} files with ${(avg * 100).toFixed(0)}% structural similarity`,
          count: cluster.length,
        },
      ],
    })
  }

  return records.sort((a, b) => a.id.localeCompare(b.id))
}
