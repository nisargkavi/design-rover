import { describe, expect, it } from "vitest"
import { checkSnippet, emptyCanonical } from "@design-rover/core"
import { explain, searchModel } from "../packages/core/src/explain.ts"
import { looksLikeSpacingOverride, stripVariant } from "../packages/core/src/classes.ts"
function model() {
  const data = emptyCanonical("/tmp/test", "test")
  data.components.push({
    id: "component.card-panel",
    name: "Card",
    exportName: "Panel",
    source: "components/Card.tsx",
    importPath: "./components/Card",
    props: [],
    variants: [],
    sizes: ["sm", "lg"],
    composition: [],
    dependencies: [],
    relatedTokens: [],
    usage: [],
    examples: [],
    architecture: "shared",
    local: false,
    status: "observed",
    confidence: "high",
    originKind: "implementation",
    evidence: [],
  })
  return data
}
describe("developer-facing audit regressions", () => {
  it("allows layout sizing and recognizes important sizing utilities", () => {
    expect(looksLikeSpacingOverride("w-full")).toBe(false)
    expect(looksLikeSpacingOverride("hover:w-auto")).toBe(false)
    expect(looksLikeSpacingOverride("!h-20")).toBe(true)
    expect(looksLikeSpacingOverride("hover:h-20!")).toBe(true)
    expect(stripVariant("data-[state=open]:hover:!h-20")).toBe("h-20")
  })
  it("finds public export aliases by their callable name", () => {
    expect(searchModel(model(), "Panel").components).toHaveLength(1)
    expect(explain(model(), "Panel")).toContain("Export: Panel")
  })
  it("detects inline padding while allowing layout width", () => {
    expect(
      checkSnippet(
        'import { Panel } from "./components/Card"; const page=<Panel className="w-full"/>',
        "App.tsx",
        model(),
      ),
    ).toEqual([])
    for (const style of ["padding:20", "padding"]) {
      const findings = checkSnippet(
        `import { Panel } from "./components/Card"; const page=<Panel style={{${style}}}/>`,
        "App.tsx",
        model(),
      )
      expect(findings).toHaveLength(1)
      expect(findings[0]?.related).toContain("style:padding")
    }
    expect(
      checkSnippet(
        'import { Panel } from "./components/Card"; const page=<Panel className="!h-20"/>',
        "App.tsx",
        model(),
      ),
    ).toHaveLength(1)
  })
})
