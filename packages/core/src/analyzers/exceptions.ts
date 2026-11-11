import { entityId, type ExceptionRecord } from "@design-rover/model"
import { isArbitrary, isRawPaletteColor } from "../classes.ts"
import type { RepoEvidence } from "../evidence.ts"
import { shortHash } from "../hash.ts"
import { normalizeEvidence } from "../knowledge-identity.ts"

const EXPLICIT =
  /design-rover(?:-ignore|:exception|:allow)/i

export function analyzeExceptions(evidence: RepoEvidence): ExceptionRecord[] {
  const exceptions: ExceptionRecord[] = []
  const anchors = new Map<string, number>()

  for (const file of evidence.files) {
    for (const comment of file.comments) {
      if (!EXPLICIT.test(comment.text)) continue
      const anchor = `${file.relative}-${shortHash(normalizeEvidence(comment.text), 16)}`
      const occurrence = (anchors.get(anchor) ?? 0) + 1
      anchors.set(anchor, occurrence)
      const id = entityId("exception", `${anchor}${occurrence > 1 ? `-${occurrence}` : ""}`)
      exceptions.push({
        id,
        name: `Explicit exception in ${file.relative}`,
        reason: comment.text.replace(/^\/\*+|^\s*\/\/|^\s*\*|^\s+/gm, "").trim(),
        allows: ["local-override"],
        scope: { paths: [file.relative], components: [] },
        status: "suggested",
        confidence: "high",
        originKind: "implementation",
        evidence: [
          {
            id: `${id}:comment`,
            kind: "exception-comment",
            description: comment.text.trim(),
            location: { file: file.relative, startLine: comment.startLine },
          },
        ],
      })
    }
  }

  const marketing = evidence.files.filter((file) =>
    /(^|\/)(marketing|campaigns|promo)\//.test(file.relative),
  )
  for (const file of marketing) {
    const raw = file.classes.flatMap((hit) => hit.classes).filter(isRawPaletteColor)
    const arbitrary = file.classes.flatMap((hit) => hit.classes).filter(isArbitrary)
    if (!raw.length && !arbitrary.length) continue
    const id = entityId("exception", `marketing-${file.relative}`)
    exceptions.push({
      id,
      name: `Marketing-specific styling in ${file.relative}`,
      reason: "Campaign or marketing routes often use one-off colors by design.",
      allows: [...new Set([...raw, ...arbitrary])].slice(0, 12),
      scope: { paths: [file.relative], components: [] },
      status: "suggested",
      confidence: "medium",
      originKind: "implementation",
      evidence: [
        {
          id: `${id}:raw`,
          kind: "marketing-style",
          description: `${raw.length} raw palette colors, ${arbitrary.length} arbitrary values`,
          location: { file: file.relative },
          count: raw.length + arbitrary.length,
        },
      ],
    })
  }

  return exceptions.sort((a, b) => a.id.localeCompare(b.id))
}
