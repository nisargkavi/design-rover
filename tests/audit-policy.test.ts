import { describe, expect, it } from "vitest"
import { checkSystem, emptyCanonical } from "@design-rover/core"
import type { ComponentRecord, ObservedSnapshot, CanonicalModel, IntentRecord } from "@design-rover/model"
function button(): ComponentRecord {
  return {
    id: "component.button",
    name: "Button",
    source: "Button.tsx",
    importPath: "./Button",
    exportName: "Button",
    status: "approved",
    confidence: "high",
    originKind: "implementation",
    evidence: [],
    props: [{ name: "label", type: "string", required: false }],
    propsResolution: { status: "resolved", issues: [] },
    variants: [],
    sizes: [],
    composition: [],
    dependencies: [],
    relatedTokens: [],
    usage: [],
    examples: [],
    architecture: "shared",
    local: false,
  }
}
function observed(model: CanonicalModel): ObservedSnapshot {
  return {
    analyzedAt: "2026-11-11T00:00:00Z",
    filesAnalyzed: 1,
    incremental: false,
    changedFiles: [],
    framework: { name: "react" },
    styling: { systems: [] },
    componentLibraries: [],
    documentation: [],
    components: model.components.map((item) => structuredClone(item)),
    tokens: [],
    patterns: [],
    conventions: [],
    intents: model.intents.map((item) => structuredClone(item)),
    exceptions: [],
  }
}
describe("reviewed contract gate policy", () => {
  it("fails confirmed approved contract regressions and removals", () => {
    const model = emptyCanonical("/tmp", "test")
    model.components = [button()]
    const next = observed(model)
    next.components[0]!.props[0]!.required = true
    expect(checkSystem(next, model).diagnostics[0]).toMatchObject({ severity: "error", certainty: "certain" })
    next.components = []
    expect(checkSystem(next, model).diagnostics[0]).toMatchObject({ severity: "error", certainty: "certain" })
  })
  it.each(["partial", "unresolved"] as const)(
    "keeps %s lost fields advisory instead of inventing a confirmed break",
    (status) => {
      const model = emptyCanonical("/tmp", "test")
      model.components = [button()]
      const next = observed(model)
      next.components[0]!.props = []
      next.components[0]!.propsResolution = { status, issues: ["External declarations not loaded"] }
      expect(checkSystem(next, model).diagnostics[0]).toMatchObject({
        severity: "info",
        certainty: "inferred",
        title: "Button API needs review",
      })
    },
  )
  it("does not turn resolution-only or observed changes into errors", () => {
    const model = emptyCanonical("/tmp", "test")
    model.components = [button()]
    const next = observed(model)
    next.components[0]!.propsResolution = { status: "partial", issues: ["Unknown dependency"] }
    expect(checkSystem(next, model).diagnostics.every((d) => d.severity !== "error")).toBe(true)
    model.components[0]!.status = "observed"
    next.components[0]!.propsResolution = { status: "resolved", issues: [] }
    next.components[0]!.props[0]!.required = true
    expect(checkSystem(next, model).diagnostics.every((d) => d.severity !== "error")).toBe(true)
  })
  it("does not share intent baselines across different IDs or files", () => {
    const model = emptyCanonical("/tmp", "test")
    const make = (id: string, file: string): IntentRecord => ({
      id,
      subject: "Hero.visual",
      type: "image",
      required: true,
      optional: false,
      placeholderAllowed: false,
      productionAssetRequired: true,
      intentStatus: "placeholder",
      status: "approved",
      confidence: "high",
      originKind: "implementation",
      evidence: [{ id: id + ":source", kind: "image", description: "Placeholder", location: { file } }],
      sourceRefs: [],
    })
    model.intents = [make("intent.a", "a.tsx"), make("intent.b", "b.tsx")]
    const next = observed(model)
    const first = checkSystem(next, model).diagnostics
    expect(first).toHaveLength(2)
    expect(first[0]!.fingerprint).not.toBe(first[1]!.fingerprint)
    model.baseline = {
      capturedAt: "2026-11-11",
      findings: [{ fingerprint: first[0]!.fingerprint, kind: "warning", summary: "first" }],
    }
    expect(checkSystem(next, model).diagnostics.map((d) => d.baseline)).toEqual([true, false])
  })
})
