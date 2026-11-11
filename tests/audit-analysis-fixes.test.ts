import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { analyzeRepository, emptyCanonical, retrieveContext, serializeContext } from "@design-rover/core"
import { ComponentRecordSchema, TokenRecordSchema } from "@design-rover/model"
import type { RepoEvidence } from "../packages/core/src/evidence.ts"
import { extractFileEvidence } from "../packages/core/src/parse.ts"
import { analyzeComponents } from "../packages/core/src/analyzers/components.ts"
import { localModules } from "../packages/core/src/local-modules.ts"
import { classReferencesToken } from "../packages/core/src/token-usage.ts"
import { clearCache, loadCache } from "../packages/core/src/cache.ts"

const directories: string[] = []
async function repo(files: Record<string, string> = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "rover-audit-analysis-"))
  directories.push(root)
  for (const [relative, content] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, relative)), { recursive: true })
    await fs.writeFile(path.join(root, relative), content)
  }
  return root
}
afterEach(async () => { await Promise.all(directories.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))) })

function evidence(files: Record<string, string>, options: Partial<RepoEvidence> = {}): RepoEvidence {
  return {
    root: process.cwd(), tsconfigPaths: { "@/*": ["./*"] },
    files: Object.entries(files).map(([relative, content]) => extractFileEvidence({ relative, content, hash: relative, kind: relative.endsWith(".css") ? "style" : "script" })),
    ...options,
  }
}

describe("component export and import identities", () => {
  it.each([
    ["export { Card }", "Card"],
    ["export { Card as Panel }", "Panel"],
    ["export default Card", "default"],
  ])("discovers local export lists and assignments: %s", (statement, exported) => {
    const result = analyzeComponents(evidence({ "components/layout/Card.tsx": `function Card(props: { label: string }) { return <article>{props.label}</article> }; ${statement}` }), [])
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ name: "Card", exportName: exported, propsResolution: { status: "resolved" }, props: [{ name: "label", type: "string", required: true }] })
  })

  it("keeps public aliases distinct and attributes direct/default/barrel usage to the terminal export", () => {
    const result = analyzeComponents(evidence({
      "components/layout/Card.tsx": 'function Card(props: { label: string }) { return <article>{props.label}</article> }; export { Card, Card as Panel, Card as default }',
      "components/index.ts": 'export { Panel as DisplayPanel } from "./layout/Card"',
      "App.tsx": 'import Original, { Card } from "./components/layout/Card"; import { DisplayPanel } from "./components"; export function App() { return <><Original label="a"/><Card label="b"/><DisplayPanel label="c"/></> }',
    }), []).filter((component) => component.source === "components/layout/Card.tsx")
    expect(result).toHaveLength(3)
    expect(result.map((component) => component.exportName).sort()).toEqual(["Card", "Panel", "default"])
    expect(new Set(result.map((component) => component.id)).size).toBe(3)
    for (const component of result) {
      expect(component.usage).toEqual([{ file: "App.tsx", count: 1 }])
      expect(component.props).toEqual([{ name: "label", type: "string", required: true, values: undefined, defaultValue: undefined }])
    }
  })

  it("does not treat type-only local exports as runtime component exports", () => {
    expect(analyzeComponents(evidence({ "Card.tsx": "function Card() { return <article/> }; export type { Card }" }), [])).toEqual([])
  })

  it("preserves nested UI and feature paths and verifies alias imports against their source", () => {
    const input = evidence({
      "components/ui/forms/input.tsx": "export function Input() { return <input/> }",
      "app/settings/components/ProfileForm.tsx": "export function ProfileForm() { return <form/> }",
    }, { componentsJson: { aliases: { ui: "@/components/ui", components: "@/components" } } })
    const result = analyzeComponents(input, [])
    expect(result.find((item) => item.name === "Input")?.importPath).toBe("@/components/ui/forms/input")
    expect(result.find((item) => item.name === "ProfileForm")?.importPath).toBe("@/app/settings/components/ProfileForm")
    for (const component of result) expect(localModules(input).resolveModule("__request__.tsx", component.importPath!)).toBe(component.source)
  })

  it("recognizes src/ui as shared and honors baseUrl while deriving a roundtripping import", () => {
    const input = evidence({
      "tsconfig.json": '{ "compilerOptions": { "baseUrl": "./src", "paths": { "@/*": ["./*"] } } }',
      "src/ui/Badge.tsx": "export function Badge() { return <span/> }",
    }, { componentsJson: { aliases: { ui: "@/ui" } } })
    const component = analyzeComponents(input, [])[0]!
    expect(component).toMatchObject({ architecture: "shared", importPath: "@/ui/Badge" })
    expect(localModules(input).resolveModule("__request__.tsx", component.importPath!)).toBe(component.source)
  })

  it("records only explicit static inline-style keys and rejects malformed cached style evidence", async () => {
    const root = await repo({ "Button.tsx": 'export function Button() { return <button style={{ padding: size(), "marginTop": 2, [computed]: 3, ...unknown }}/> }' })
    const { evidence: observed } = await analyzeRepository(root)
    expect(observed.files.find((file) => file.relative === "Button.tsx")?.jsx[0]?.styleProperties).toEqual(["padding", "marginTop"])
    const cachePath = path.join(root, ".design-rover/cache/evidence.json")
    const cached = JSON.parse(await fs.readFile(cachePath, "utf8"))
    cached.files.find((file: { relative: string }) => file.relative === "Button.tsx").jsx[0].styleProperties = "padding"
    await fs.writeFile(cachePath, JSON.stringify(cached))
    expect(await loadCache(root)).toBeUndefined()
  })
})

describe("configuration tokens and dependency context", () => {
  it("keeps Tailwind 3 hierarchical DEFAULT names and includes all scoped variable dependencies", async () => {
    const root = await repo({
      "tailwind.config.ts": 'const config = { theme: { extend: { colors: { foreground: "hsl(var(--foreground))", primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" }, muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" } } } } } satisfies Config; export default config',
      "theme.css": ":root { --foreground: 0 0% 10%; --primary: 0 0% 20%; --primary-foreground: 0 0% 30%; --muted: 0 0% 40%; --muted-foreground: 0 0% 50%; } .dark { --primary: 0 0% 80%; --muted-foreground: 0 0% 70%; }",
      "components/Hint.tsx": 'export function Hint() { return <span className="text-muted-foreground bg-primary"/> }',
    })
    const { snapshot } = await analyzeRepository(root)
    const configTokens = snapshot.tokens.filter((token) => token.origin === "tailwind.config.ts")
    expect(configTokens.map((token) => token.name).sort()).toEqual(["foreground", "muted", "muted-foreground", "primary", "primary-foreground"])
    expect(configTokens.find((token) => token.name === "muted-foreground")?.value).toBe("hsl(var(--muted-foreground))")
    expect(snapshot.components.find((component) => component.name === "Hint")?.relatedTokens).toEqual(["muted-foreground", "primary"])
    expect(snapshot.tokens.filter((token) => token.name === "--primary").every((token) => token.usageCount > 0)).toBe(true)
    const model = { ...emptyCanonical(root), components: snapshot.components, tokens: snapshot.tokens }
    const packet = retrieveContext(model, { query: "Hint" })
    const returned = packet.matches.filter((match) => match.kind === "token").map((match) => match.record)
    expect(returned.filter((token) => token.name === "--primary")).toHaveLength(2)
    expect(returned.filter((token) => token.name === "--muted-foreground")).toHaveLength(2)
    expect(returned.some((token) => token.name === "foreground" || token.name === "primary-foreground")).toBe(false)
    expect(serializeContext(packet).length).toBeLessThanOrEqual(12000)
  })

  it("matches whole configuration utility values rather than foreground suffixes", () => {
    expect(classReferencesToken("text-muted-foreground", "foreground")).toBe(false)
    expect(classReferencesToken("text-muted-foreground", "muted-foreground")).toBe(true)
    expect(classReferencesToken("hover:!text-primary-foreground/80", "primary-foreground")).toBe(true)
    expect(classReferencesToken("p-primary-foreground", "primary-foreground")).toBe(false)
  })

  it("never executes configuration and labels named dynamic values unresolved", async () => {
    const root = await repo({
      "tailwind.config.js": 'throw new Error("Do not execute"); module.exports = { theme: { colors: { brand: "#fff", dynamic: makeColor() } } }',
      "components/Button.tsx": 'export function Button() { return <button className="bg-dynamic bg-brand"/> }',
    })
    const { snapshot } = await analyzeRepository(root)
    expect(snapshot.tokens.find((token) => token.name === "dynamic")).toMatchObject({ status: "inferred", notes: expect.stringMatching(/unresolved/i) })
    const model = { ...emptyCanonical(root), components: snapshot.components, tokens: snapshot.tokens }
    expect(retrieveContext(model, { query: "Button" }).matches.some((match) => match.kind === "token" && match.record.name === "dynamic")).toBe(false)
  })

  it("preserves v4 alias declarations and follows scoped dependencies with cycle and missing-reference warnings", async () => {
    const root = await repo({
      "theme.css": "@theme inline { --color-primary: var(--brand); --color-cyclic: var(--a); --color-missing: var(--missing, red); } :root { --brand: var(--base); --base: red; --a: var(--b); --b: var(--a); } .dark { --base: blue; }",
      "components/Button.tsx": 'export function Button() { return <button className="bg-primary text-cyclic border-missing"/> }',
    })
    const { snapshot } = await analyzeRepository(root)
    const model = { ...emptyCanonical(root), components: snapshot.components, tokens: snapshot.tokens }
    const packet = retrieveContext(model, { query: "Button", maxChars: 20000 })
    expect(packet.matches.filter((match) => match.kind === "token" && match.record.name === "--base")).toHaveLength(2)
    expect(packet.warnings.join(" ")).toMatch(/cycle/i)
    expect(packet.warnings.join(" ")).toContain("--missing")
    expect(snapshot.tokens.find((token) => token.name === "--color-primary")?.value).toBe("var(--brand)")
  })

  it("prioritizes relevant reusable components over auxiliary tokens within the default budget", () => {
    const metadata = { status: "observed", confidence: "high", originKind: "implementation", evidence: [] }
    const model = emptyCanonical("/repo", "ranking")
    const tokenNames = Array.from({ length: 8 }, (_, index) => `--color-neutral-${index}`)
    model.components = [
      ComponentRecordSchema.parse({ ...metadata, id: "component.settings", name: "SettingsView", source: "components/SettingsView.tsx", importPath: "@/components/SettingsView", exportName: "SettingsView", relatedTokens: tokenNames }),
      ComponentRecordSchema.parse({ ...metadata, id: "component.provider", name: "ProviderSelector", source: "components/ProviderSelector.tsx", importPath: "@/components/ProviderSelector", exportName: "ProviderSelector", notes: "Reusable provider dropdown" }),
    ]
    model.tokens = tokenNames.map((name, index) => TokenRecordSchema.parse({ ...metadata, id: `token.neutral-${index}`, name, category: "color", origin: "theme.css", value: "#333", evidence: [{ id: `evidence-${index}`, kind: "css-variable", description: "x".repeat(600) }] }))
    const options = { query: "update the settings view provider dropdown", path: "components/SettingsView.tsx" }
    const packet = retrieveContext(model, options)
    expect(packet.matches.findIndex((match) => match.record.id === "component.provider")).toBeGreaterThanOrEqual(0)
    expect(packet.matches.findIndex((match) => match.record.id === "component.provider")).toBeLessThan(packet.matches.findIndex((match) => match.kind === "token"))
    expect(packet.coverage.omittedByBudget).toBeGreaterThan(0)
    expect(serializeContext(packet).length).toBeLessThanOrEqual(12000)
    expect(retrieveContext(model, options)).toEqual(packet)
  })
})

it("refuses cache reads, writes and clearing through an external symlink", async () => {
  const root = await repo({ "Button.tsx": "export function Button() { return <button/> }" })
  const outside = await repo()
  await fs.mkdir(path.join(root, ".design-rover"))
  await fs.symlink(outside, path.join(root, ".design-rover/cache"))
  await expect(analyzeRepository(root)).rejects.toThrow(/symlink/i)
  await expect(clearCache(root)).rejects.toThrow(/symlink/i)
  expect(await fs.readdir(outside)).toEqual([])
})
