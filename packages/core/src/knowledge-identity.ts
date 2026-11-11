import type { ExceptionRecord, IntentRecord } from "@design-rover/model"

export function normalizeEvidence(text: string): string {
  return text.replace(/^\s*(?:\/\*+|\*\/|\*|\/\/)\s?/gm, "").replace(/\s+/g, " ").trim()
}

/** Line-independent evidence used only for unambiguous legacy reassociation. */
export function decisionAnchor(kind: "exception" | "intent", record: ExceptionRecord | IntentRecord): string | undefined {
  const file = record.evidence.find((item) => item.location?.file)?.location?.file
    ?? ("sourceRefs" in record ? record.sourceRefs.find((item) => item.location?.file)?.location?.file : undefined)
  if (!file) return undefined
  if (kind === "exception" && "reason" in record) {
    const comment = record.evidence.find((item) => item.kind === "exception-comment")?.description
    return comment ? JSON.stringify([file, normalizeEvidence(comment)]) : undefined
  }
  if (kind === "intent" && "subject" in record) {
    const comment = record.type === "accessibility" ? record.evidence.find((item) => item.kind === "todo-comment")?.description
      : record.sourceRefs.find((item) => item.snippet)?.snippet
    return JSON.stringify([file, record.type, record.subject, normalizeEvidence(comment ?? "")])
  }
  return undefined
}
