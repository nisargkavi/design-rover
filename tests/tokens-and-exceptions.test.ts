import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { analyzeRepository, createEngine, emptyCanonical, checkSnippet } from "@design-rover/core"

const dirs: string[] = []
async function repo(files: Record<string, string> = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rover-themes-"))
  dirs.push(dir)
  for (const [file, content] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(dir, file)), { recursive: true })
    await fs.writeFile(path.join(dir, file), content)
  }
  return dir
}
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }))) })

describe("scoped tokens and evidence", () => {
  it("preserves themes, media contexts and multiline values while ignoring comments", async () => {
    const dir = await repo({ "theme.css": "/* --fake: red; */\n:root { --color-primary: red; --space: calc(\n  1rem + 2px\n); }\n.dark { --color-primary: blue; }\n@media (prefers-color-scheme: dark) { :root { --color-primary: green; } }" })
    const { snapshot } = await analyzeRepository(dir)
    const colors = snapshot.tokens.filter((item) => item.name === "--color-primary")
    expect(colors).toHaveLength(3)
    expect(new Set(colors.map((item) => item.id)).size).toBe(3)
    expect(colors.map((item) => item.value).sort()).toEqual(["blue", "green", "red"])
    expect(colors.find((item) => item.value === "blue")?.mode).toBe("dark")
    expect(snapshot.tokens.some((item) => item.name === "--fake")).toBe(false)
    expect(snapshot.tokens.find((item) => item.name === "--space")?.value).toContain("1rem + 2px")
  })

  it("detects dark-mode updates separately from root values", async () => {
    const dir = await repo({ "theme.css": ":root { --color-primary: red; } .dark { --color-primary: blue; }" })
    const engine = await createEngine(dir)
    await engine.init({ generate: false })
    await fs.writeFile(path.join(dir, "theme.css"), ":root { --color-primary: red; } .dark { --color-primary: green; }")
    const { diff } = await engine.syncPreview()
    const change = diff.changes.find((item) => item.entity === "token" && item.kind === "update")
    expect(change?.after).toMatchObject({ value: "green", scope: ".dark" })
  })

  it("keeps conflicting declarations in distinct files and later same-file evidence", async () => {
    const dir = await repo({ "a.css": ":root { --color-primary: red; --color-primary: blue; }", "b.css": ":root { --color-primary: green; }" })
    const { snapshot } = await analyzeRepository(dir)
    expect(snapshot.tokens).toHaveLength(2)
    expect(snapshot.tokens.find((item) => item.origin === "a.css")?.value).toBe("blue")
    expect(snapshot.tokens.find((item) => item.origin === "a.css")?.evidence).toHaveLength(2)
  })

  it("keeps case-sensitive and punctuation-distinct custom properties separate", async () => {
    const dir = await repo({ "theme.css": ":root { --Brand: red; --brand: blue; --foo-bar: green; --foo_bar: yellow; }" })
    const { snapshot } = await analyzeRepository(dir)
    expect(snapshot.tokens).toHaveLength(4)
    expect(new Set(snapshot.tokens.map((item) => item.id)).size).toBe(4)
    expect(Object.fromEntries(snapshot.tokens.map((item) => [item.name, item.value]))).toEqual({ "--Brand": "red", "--brand": "blue", "--foo-bar": "green", "--foo_bar": "yellow" })
  })

  it("honors important declarations and retains every declaration as evidence", async () => {
    const dir = await repo({ "theme.css": ":root { --color-primary: red !important; --color-primary: blue; --color-secondary: red; --color-secondary: blue !important; --color-secondary: green !important; }" })
    const { snapshot } = await analyzeRepository(dir)
    expect(snapshot.tokens.find((item) => item.name === "--color-primary")).toMatchObject({ value: "red", important: true })
    expect(snapshot.tokens.find((item) => item.name === "--color-primary")?.evidence).toHaveLength(2)
    expect(snapshot.tokens.find((item) => item.name === "--color-secondary")).toMatchObject({ value: "green", important: true })
    expect(snapshot.tokens.find((item) => item.name === "--color-secondary")?.evidence).toHaveLength(3)
  })

  it("keeps token identity stable when another source defines the same name", async () => {
    const dir = await repo({ "a.css": ":root { --color-primary: red; }" })
    const initial = await analyzeRepository(dir)
    await fs.writeFile(path.join(dir, "b.css"), ":root { --color-primary: blue; }")
    const next = await analyzeRepository(dir, { incremental: true })
    expect(next.snapshot.tokens.find((item) => item.origin === "a.css")?.id).toBe(initial.snapshot.tokens[0]?.id)
    expect(next.snapshot.tokens).toHaveLength(2)
  })

  it("retains a legacy token ID and approved state while detecting importance changes", async () => {
    const dir = await repo({ "theme.css": ":root { --color-primary: red; }" })
    const engine = await createEngine(dir)
    await engine.init({ generate: false })
    const model = (await engine.load())!
    model.tokens[0] = { ...model.tokens[0]!, id: "token.color-primary", status: "approved", approvedAt: "2025-01-01" }
    await engine.save(model)
    expect((await engine.syncPreview()).diff.changes).toEqual([])
    await fs.writeFile(path.join(dir, "theme.css"), ":root { --color-primary: red !important; }")
    const { diff } = await engine.syncPreview()
    expect(diff.changes).toHaveLength(1)
    expect(diff.changes[0]?.after).toMatchObject({ id: "token.color-primary", important: true })
    await engine.applyChanges(undefined, { generate: false })
    expect((await engine.load())?.tokens[0]).toMatchObject({ id: "token.color-primary", status: "approved", important: true, approvedAt: "2025-01-01" })
  })

  it("does not infer architecture or Tailwind from an empty or plain-CSS project", async () => {
    const empty = await analyzeRepository(await repo())
    expect(empty.snapshot.conventions).toEqual([])
    const css = await analyzeRepository(await repo({ "App.tsx": 'export function App() { return <div className="container" /> }' }))
    expect(css.snapshot.conventions.some((item) => item.id.includes("inline-tailwind"))).toBe(false)
  })
})

describe("precise snippet diagnostics", () => {
  function model() {
    const canonical = emptyCanonical("/tmp", "demo")
    canonical.components.push({ id: "component.button", name: "Button", source: "components/button.tsx", importPath: "@/components/button", exportName: "Button", props: [], variants: [], sizes: ["sm", "lg"], composition: [], dependencies: [], relatedTokens: [], usage: [], examples: [], architecture: "shared", local: false, status: "approved", confidence: "high", originKind: "implementation", evidence: [] })
    return canonical
  }
  it("does not apply another element's padding to Button", () => {
    expect(checkSnippet('<><Button /><div className="p-8" /></>', "app/page.tsx", model())).toEqual([])
  })
  it("resolves aliased imports and supports JSX expressions", () => {
    const result = checkSnippet('import { Button as Save } from "@/components/button"; export const Page = () => <Save className={"p-8"} />', "app/page.tsx", model())
    expect(result).toHaveLength(1)
    expect(result[0]?.title).toBe("Button")
  })
  it("limits exceptions by component, path and allowed rule", () => {
    const canonical = model()
    canonical.exceptions.push({ id: "exception.color", name: "Other color", reason: "Marketing accent", allows: ["bg-red-500"], scope: { paths: ["app/**"], components: ["Other"] }, status: "approved", confidence: "high", originKind: "human", evidence: [] })
    const code = '<Button className="p-8" />'
    expect(checkSnippet(code, "app/page.tsx", canonical)).toHaveLength(1)
    canonical.exceptions[0]!.scope.components = ["Button"]
    expect(checkSnippet(code, "app/page.tsx", canonical)).toHaveLength(1)
    canonical.exceptions[0]!.allows = ["restyle-spacing"]
    expect(checkSnippet(code, "app/page.tsx", canonical)).toEqual([])
    expect(checkSnippet(code, "other/page.tsx", canonical)).toHaveLength(1)
  })
  it("does not guess an unbound same-named component", () => {
    const canonical = model()
    canonical.components.push({ ...canonical.components[0]!, id: "component.other-button", source: "other/button.tsx", importPath: "@/other/button" })
    expect(checkSnippet('<Button className="p-8" />', "app/page.tsx", canonical)).toEqual([])
  })
  it("does not treat a deep namespace member as its parent component", () => {
    expect(checkSnippet('import * as UI from "@/components/button"; export const Page = () => <UI.Button.Icon className="p-8" />', "app/page.tsx", model())).toEqual([])
  })
  it("resolves relative imports from the caller rather than root metadata", () => {
    const canonical = model()
    canonical.components[0]!.importPath = "./components/button"
    expect(checkSnippet('import { Button } from "./components/button"; export const Page = () => <Button className="p-8" />', "app/page.tsx", canonical)).toEqual([])
    expect(checkSnippet('import { Button } from "../components/button"; export const Page = () => <Button className="p-8" />', "app/page.tsx", canonical)).toHaveLength(1)
  })
})
