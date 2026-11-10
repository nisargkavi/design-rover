import { describe, expect, it } from "vitest"
import { checkSystem, emptyCanonical } from "@design-rover/core"
import type { IntentRecord, ObservedSnapshot } from "@design-rover/model"

const placeholder: IntentRecord = {
  id: "intent.hero", subject: "Hero.visual", type: "image", required: true, optional: false,
  placeholderAllowed: true, productionAssetRequired: true, intentStatus: "placeholder",
  status: "approved", confidence: "high", originKind: "implementation", sourceRefs: [],
  evidence: [{ id: "hero-source", kind: "image", description: "Placeholder", location: { file: "app/page.tsx" } }],
}
function report(intents: IntentRecord[]) {
  const model = emptyCanonical("/tmp", "demo")
  model.intents = [placeholder]
  const observed: ObservedSnapshot = {
    analyzedAt: "2026-11-10", filesAnalyzed: 1, incremental: false, changedFiles: [],
    tokens: [], components: [], patterns: [], conventions: [], exceptions: [], intents,
    framework: { name: "react" }, styling: { systems: [] }, componentLibraries: [], documentation: [],
  }
  return checkSystem(observed, model).diagnostics.filter((item) => item.id === "intent-intent.hero")
}
describe("current design intent evidence", () => {
  it("does not report a resolved observed visual as a current placeholder", () => {
    expect(report([{ ...placeholder, intentStatus: "resolved" }])).toEqual([])
  })
  it("reports vanished placeholder evidence as uncertain review rather than a present asset", () => {
    expect(report([])).toMatchObject([{ severity: "info", certainty: "inferred" }])
  })
  it("does not use an unrelated route with the same subject as evidence", () => {
    const other = { ...placeholder, id: "intent.other", evidence: [{ ...placeholder.evidence[0]!, location: { file: "other/page.tsx" } }] }
    expect(report([other])).toMatchObject([{ severity: "info", certainty: "inferred" }])
  })
})
