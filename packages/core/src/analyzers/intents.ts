import { entityId, type IntentRecord } from "@design-rover/model"
import type { RepoEvidence } from "../evidence.ts"
import { shortHash } from "../hash.ts"
import { normalizeEvidence } from "../knowledge-identity.ts"

const TODO_RE = /TODO|FIXME|replace with production|placeholder|temp image/i

export function analyzeIntents(evidence: RepoEvidence): IntentRecord[] {
  const intents: IntentRecord[] = []
  const anchors = new Map<string, number>()
  const anchoredId = (anchor: string) => {
    const occurrence = (anchors.get(anchor) ?? 0) + 1
    anchors.set(anchor, occurrence)
    return entityId("intent", `${shortHash(anchor, 16)}${occurrence > 1 ? `-${occurrence}` : ""}`)
  }

  for (const file of evidence.files) {
    const todoComments = file.comments.filter((item) => TODO_RE.test(item.text))
    for (const image of file.images) {
      const nearbyTodo = todoComments.find(
        (item) => Math.abs(item.startLine - image.startLine) <= 8,
      )
      const placeholder = image.placeholder || Boolean(nearbyTodo)
      if (!placeholder && !nearbyTodo) continue

      const subjectBase =
        file.sections.find(
          (section) =>
            section.file === file.relative &&
            Math.abs((section.startLine ?? 0) - image.startLine) < 30,
        )?.nameHint ??
        file.sections.find((section) => section.heading)?.heading ??
        (/(^|\/)page\.(t|j)sx?$/.test(file.relative) ? "Page" : image.tag)

      const subject = `${subjectBase}.visual`
      const id = anchoredId(JSON.stringify([file.relative, subject, image.tag, image.src ?? "", normalizeEvidence(nearbyTodo?.text ?? "")]))
      intents.push({
        id,
        subject,
        type: "image",
        required: true,
        optional: false,
        placeholderAllowed: true,
        productionAssetRequired: Boolean(nearbyTodo) || image.placeholder,
        intentStatus: placeholder ? "placeholder" : "unknown",
        sourceRefs: [
          {
            id: `${id}:img`,
            kind: "image",
            description: placeholder
              ? "Placeholder visual with production asset expected"
              : "Image intent",
            location: { file: file.relative, startLine: image.startLine },
            snippet: nearbyTodo?.text.trim(),
          },
        ],
        status: "suggested",
        confidence: nearbyTodo ? "high" : "medium",
        originKind: "implementation",
        evidence: [
          {
            id: `${id}:evidence`,
            kind: nearbyTodo ? "todo-comment" : "placeholder-image",
            description: nearbyTodo
              ? nearbyTodo.text.trim()
              : `${image.tag} looks like a placeholder`,
            location: { file: file.relative, startLine: image.startLine },
          },
        ],
      })
    }

    for (const comment of todoComments) {
      if (!/a11y|aria|accessible/i.test(comment.text)) continue
      const id = anchoredId(JSON.stringify(["a11y", file.relative, normalizeEvidence(comment.text)]))
      intents.push({
        id,
        subject: `${file.relative}:accessibility`,
        type: "accessibility",
        required: true,
        optional: false,
        placeholderAllowed: false,
        productionAssetRequired: false,
        intentStatus: "missing",
        status: "suggested",
        confidence: "medium",
        originKind: "implementation",
        evidence: [
          {
            id: `${id}:comment`,
            kind: "todo-comment",
            description: comment.text.trim(),
            location: { file: file.relative, startLine: comment.startLine },
          },
        ],
        sourceRefs: [],
      })
    }
  }

  const ctaPages = evidence.files.filter((file) =>
    file.jsx.some((jsx) => jsx.tag === "Button" || jsx.tag === "Link"),
  )
  for (const file of ctaPages) {
    const empty = file.jsx.some(
      (jsx) =>
        /empty|no[- ]results|nothing here/i.test(jsx.attributes.title ?? "") ||
        file.sections.some((section) => /empty/i.test(section.nameHint ?? "")),
    )
    if (!empty) continue
    const id = entityId("intent", `empty-cta-${file.relative}`)
    intents.push({
      id,
      subject: "EmptyState.CTA",
      type: "cta",
      required: true,
      optional: false,
      placeholderAllowed: false,
      productionAssetRequired: false,
      intentStatus: "unknown",
      status: "suggested",
      confidence: "low",
      originKind: "implementation",
      evidence: [
        {
          id: `${id}:empty`,
          kind: "empty-state",
          description: `Possible empty state CTA in ${file.relative}`,
          location: { file: file.relative },
        },
      ],
      sourceRefs: [],
    })
  }

  return intents.sort((a, b) => a.id.localeCompare(b.id))
}
