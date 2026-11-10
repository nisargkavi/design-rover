import { describe, expect, it } from "vitest"
import { checkSnippet } from "@design-rover/core"
import { emptyCanonical } from "@design-rover/core"

describe("snippet check", () => {
  it("points at existing Button sizes instead of inventing a new API", () => {
    const model = emptyCanonical("/tmp", "demo")
    model.components.push({
      id: "component.button",
      name: "Button",
      source: "components/ui/button.tsx",
      importPath: "@/components/ui/button",
      exportName: "Button",
      props: [],
      variants: ["default"],
      sizes: ["sm", "default", "lg"],
      composition: [],
      dependencies: [],
      relatedTokens: [],
      usage: [],
      examples: [],
      architecture: "shared",
      local: false,
      status: "approved",
      confidence: "high",
      originKind: "implementation",
      evidence: [],
    })
    const diagnostics = checkSnippet(`<Button className="p-8">Save</Button>`, "page.tsx", model)
    expect(diagnostics.some((item) => /size/i.test(item.why) || /size/i.test(item.related ?? ""))).toBe(true)
  })
})
