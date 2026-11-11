import { describe, expect, it } from "vitest"
import { emptyCanonical, retrieveContext, serializeContext } from "@design-rover/core"
import type { CanonicalModel, ComponentRecord, ConventionRecord, ExceptionRecord, TokenRecord } from "@design-rover/model"

const metadata = { status: "approved" as const, confidence: "high" as const, originKind: "implementation" as const, evidence: [] }
function component(id: string, source: string, usage: string[] = []): ComponentRecord {
  return { ...metadata, id, name: "Button", source, exportName: "Button", importPath: `./${source}`, props: [{ name: "label", type: "string", required: true }], variants: ["primary"], sizes: ["lg"], composition: [], dependencies: [], relatedTokens: ["--color-primary"], usage: usage.map((file) => ({ file, count: 1 })), examples: [], architecture: "shared", local: false }
}
function token(id: string, origin: string, value: string): TokenRecord {
  return { ...metadata, id, name: "--color-primary", category: "semantic-color", origin, value, scope: ":root", usageCount: 1 }
}
function convention(id: string, guidance = "Use approved primitives."): ConventionRecord {
  return { ...metadata, id, name: id, category: "styling", observed: "Observed behavior", inference: "Inferred preference", suggestion: "Review preference", guidance }
}
function exception(id: string, paths: string[], components: string[] = []): ExceptionRecord {
  return { ...metadata, id, name: id, reason: "Approved scoped styling", allows: ["restyle-spacing"], scope: { paths, components } }
}
function fixture(): CanonicalModel {
  const model = emptyCanonical("/repo", "context")
  model.components = [component("component.store-button", "apps/store/Button.tsx"), component("component.admin-button", "apps/admin/Button.tsx", ["apps/admin/src/page.tsx"]), component("component.shared-button", "packages/ui/Button.tsx", ["apps/admin/src/page.tsx"])]
  model.tokens = [token("token.admin-primary", "apps/admin/theme.css", "blue"), token("token.store-primary", "apps/store/theme.css", "red"), token("token.shared-primary", "packages/ui/theme.css", "green")]
  return model
}

describe("bounded canonical context retrieval", () => {
  it("scopes duplicate component names and related tokens to the requested app and proven shared dependencies", () => {
    const packet = retrieveContext(fixture(), { query: "Add a Button", path: "apps/admin/src/page.tsx", maxChars: 20000 })
    const ids = packet.matches.map((item) => item.record.id)
    expect(ids).toContain("component.admin-button")
    expect(ids).toContain("component.shared-button")
    expect(ids).toContain("token.admin-primary")
    expect(ids).toContain("token.shared-primary")
    expect(ids).not.toContain("component.store-button")
    expect(ids).not.toContain("token.store-primary")
    expect(packet.matches.find((item) => item.record.id === "component.shared-button")?.sourceRefs).toContain("packages/ui/Button.tsx")
    expect(packet.freshness.checked).toBe(false)
  })

  it("includes applicable path decisions and conservatively reports wildcard directory intersections", () => {
    const model = fixture()
    model.exceptions = [exception("exception.admin", ["apps/*/src/**/*.tsx"]), exception("exception.store", ["apps/store/**"]), exception("exception.component-scope", ["apps/admin/**"], ["UnrecordedComponent"])]
    const packet = retrieveContext(model, { path: "apps/admin", maxChars: 20000 })
    const ids = packet.matches.map((item) => item.record.id)
    expect(ids).toContain("exception.admin")
    expect(ids).toContain("exception.component-scope")
    expect(ids).not.toContain("exception.store")
    expect(packet.matches.find((item) => item.record.id === "exception.admin")?.reasons).toContain("path-exception-may-apply")
    const dotted = retrieveContext({ ...model, exceptions: [exception("exception.dotted", ["apps/admin.v2/src/**"])] }, { path: "apps/admin.v2", maxChars: 20000 })
    expect(dotted.matches.map((item) => item.record.id)).toContain("exception.dotted")
    const negated = retrieveContext({ ...model, exceptions: [exception("exception.negated", ["apps/*/src/**/*.tsx", "!apps/admin/src/page.tsx"])] }, { path: "apps/admin/src/page.tsx", maxChars: 20000 })
    expect(negated.matches.map((item) => item.record.id)).not.toContain("exception.negated")
  })

  it("requires explicit pending opt-in and never returns rejected or deprecated knowledge", () => {
    const model = fixture()
    model.components = [
      { ...component("component.pending", "apps/admin/Pending.tsx"), status: "suggested" },
      { ...component("component.rejected", "apps/admin/Rejected.tsx"), status: "rejected" },
      { ...component("component.deprecated", "apps/admin/Deprecated.tsx"), status: "deprecated" },
    ]
    expect(retrieveContext(model, { path: "apps/admin" }).matches.filter((item) => item.kind === "component")).toEqual([])
    const review = retrieveContext(model, { path: "apps/admin", includePending: true })
    expect(review.matches.filter((item) => item.kind === "component").map((item) => item.record.id)).toEqual(["component.pending"])
    expect(review.matches.find((item) => item.record.id === "component.pending")?.record.status).toBe("suggested")
  })

  it("ranks deterministically regardless of model order and prioritizes approved decisions", () => {
    const model = fixture()
    model.conventions = [convention("convention.global")]
    const first = retrieveContext(model, { query: "Improve interface", path: "apps/admin", limit: 2, maxChars: 20000 })
    model.components.reverse()
    model.tokens.reverse()
    const second = retrieveContext(model, { query: "Improve interface", path: "apps/admin", limit: 2, maxChars: 20000 })
    expect(second).toEqual(first)
    expect(first.matches[0]?.record.id).toBe("convention.global")
    expect(first.coverage.omittedByLimit).toBeGreaterThan(0)
    expect(first.coverage.complete).toBe(false)
  })

  it("bounds the complete formatted response and reports omitted approved decisions without slicing them", () => {
    const model = fixture()
    const guidance = "Preserve this approved decision 🔎. ".repeat(2000)
    model.conventions = [convention("convention.large", guidance), convention("convention.small")]
    const packet = retrieveContext(model, { query: "Button", path: "apps/admin", maxChars: 6000 })
    expect(serializeContext(packet).length).toBeLessThanOrEqual(6000)
    expect(packet.limits.outputChars).toBe(serializeContext(packet).length)
    expect(packet.coverage.omittedByBudget).toBeGreaterThan(0)
    expect(packet.coverage.approvedDecisions.omitted).toBe(1)
    expect(packet.warnings.some((warning) => warning.includes("approved decisions were omitted"))).toBe(true)
    expect(packet.matches.some((match) => match.record.id === "convention.large")).toBe(false)
    expect(model.conventions[0]?.guidance).toBe(guidance)
    expect(packet.matches.find((match) => match.record.id === "convention.small")?.record).toEqual(model.conventions[1])
  })

  it("reports decision omissions caused by the record count too", () => {
    const model = fixture()
    model.conventions = [convention("convention.one"), convention("convention.two")]
    const packet = retrieveContext(model, { query: "Improve interface", path: "apps/admin", limit: 1 })
    expect(packet.coverage.approvedDecisions).toEqual({ matched: 2, returned: 1, omitted: 1 })
    expect(packet.warnings.some((warning) => warning.includes("approved decisions were omitted"))).toBe(true)
  })

  it("returns an explicitly requested API within the default budget before large global policies", () => {
    const model = fixture()
    model.conventions = Array.from({ length: 8 }, (_, index) => convention(`convention.policy-${index}`, "Important approved policy. ".repeat(250)))
    const packet = retrieveContext(model, { query: "Add a Button", path: "apps/admin" })
    expect(packet.limits.maxChars).toBe(12000)
    expect(serializeContext(packet).length).toBeLessThanOrEqual(12000)
    expect(packet.matches.some((item) => item.kind === "component" && item.record.id === "component.admin-button")).toBe(true)
    expect(packet.matches[0]?.reasons).toContain("requested-record")
    expect(packet.coverage.approvedDecisions.omitted).toBeGreaterThan(0)
    expect(packet.warnings.some((warning) => warning.includes("approved decisions were omitted"))).toBe(true)
  })

  it("retains approved decisions attached to a retrieved shared component source", () => {
    const model = fixture()
    model.intents.push({ ...metadata, id: "intent.shared-button", subject: "Button labeling", type: "accessibility", required: true, optional: false, placeholderAllowed: false, productionAssetRequired: false, intentStatus: "resolved", sourceRefs: [{ id: "evidence.button-label", kind: "human-decision", description: "Preserve Button labels", location: { file: "packages/ui/Button.tsx", startLine: 5 } }] })
    const packet = retrieveContext(model, { path: "apps/admin/src/page.tsx", maxChars: 20000 })
    expect(packet.matches.find((item) => item.record.id === "intent.shared-button")?.reasons).toContain("component-source-decision")
    expect(packet.coverage.approvedDecisions).toEqual({ matched: 1, returned: 1, omitted: 0 })
  })

  it("does not expand unrelated local pages just because their composition mentions the requested primitive", () => {
    const model = emptyCanonical("/repo", "local-context")
    model.components = [component("component.button", "components/ui/Button.tsx", ["app/dashboard/page.tsx"]), { ...component("component.account", "app/account/page.tsx"), name: "AccountPage", composition: ["Button"] }]
    const packet = retrieveContext(model, { query: "Button", path: "app/dashboard/page.tsx" })
    expect(packet.matches.map((item) => item.record.id)).toEqual(["component.button"])
  })

  it("rejects invalid paths and limits instead of broadening the requested scope", () => {
    const model = fixture()
    for (const path of ["../apps/admin", "/repo/apps/admin", "C:\\repo\\apps\\admin", ""]) expect(() => retrieveContext(model, { path })).toThrow()
    expect(() => retrieveContext(model)).toThrow("query or")
    expect(() => retrieveContext(model, { query: "Button", limit: 0 })).toThrow("limit")
    expect(() => retrieveContext(model, { query: "Button", maxChars: 1000 })).toThrow("maxChars")
    expect(retrieveContext(model, { path: ".", maxChars: 20000 }).matches.some((item) => item.record.id === "component.store-button")).toBe(true)
  })
})
