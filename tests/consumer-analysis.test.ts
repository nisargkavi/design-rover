import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { analyzeRepository, createEngine, emptyCanonical, retrieveContext } from "@design-rover/core"
import { classReferencesToken } from "../packages/core/src/token-usage.ts"

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))) })
async function repo(files: Record<string, string>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "rover-consumer-"))
  roots.push(root)
  for (const [file, content] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true })
    await fs.writeFile(path.join(root, file), content)
  }
  return root
}

describe("consumer token relationships", () => {
  it("retrieves the Tailwind 4 tokens actually used in ordinary component JSX", async () => {
    const root = await repo({
      "theme.css": '@theme { --color-text-subtle: #64748b; --color-border-subtle: #e7e4dc; --color-danger: #dc2626; --color-danger-subtle: #fef2f2; --font-sans: system-ui; --ease-out: ease-out; --radius-card: 1rem; --spacing-panel: 1rem; --color-unused: blue; } :root { --private-color: purple; --color-not-theme: green; } .native { color: var(--color-text-subtle); }',
      "components/Controls.tsx": 'export function Controls() { return <section className="font-sans rounded-card p-panel border-border-subtle text-text-subtle hover:bg-danger/20 ease-out bg-[var(--private-color)] bg-not-theme"/> }',
      "components/Notice.tsx": 'export const Notice = () => <p className="bg-danger-subtle"/>',
    })
    const { snapshot } = await analyzeRepository(root)
    const controls = snapshot.components.find((item) => item.name === "Controls")!
    expect(controls.relatedTokens).toEqual(["--color-border-subtle", "--color-danger", "--color-text-subtle", "--ease-out", "--font-sans", "--private-color", "--radius-card", "--spacing-panel"])
    expect(snapshot.components.find((item) => item.name === "Notice")?.relatedTokens).toEqual(["--color-danger-subtle"])
    expect(snapshot.tokens.find((item) => item.name === "--color-text-subtle")?.usageCount).toBe(2)
    expect(snapshot.tokens.find((item) => item.name === "--color-unused")?.usageCount).toBe(0)
    const model = emptyCanonical(root, "consumer")
    model.components = snapshot.components
    model.tokens = snapshot.tokens
    const context = retrieveContext(model, { path: "components/Controls.tsx", maxChars: 20000 })
    const tokens = context.matches.filter((match) => match.kind === "token").map((match) => (match.record as { name: string }).name)
    expect(tokens).toContain("--color-text-subtle")
    expect(tokens).not.toContain("--color-danger-subtle")
    expect(tokens).not.toContain("--color-unused")
  })

  it("keeps nested and sibling component classes separate and refreshes old parser caches", async () => {
    const root = await repo({
      "theme.css": '@theme { --color-parent: red; --color-child: blue; --color-sibling: green; }',
      "components/ui/Panel.tsx": 'export function Panel() { function Child() { return <div className="bg-child"/> }; return <div className="bg-parent"><Child/></div> }; export function Sibling(){ return <div className="bg-sibling"/> }',
    })
    const first = await analyzeRepository(root)
    expect(first.snapshot.components.find((item) => item.name === "Panel")?.relatedTokens).toEqual(["--color-parent"])
    expect(first.snapshot.components.find((item) => item.name === "Child")?.relatedTokens).toEqual(["--color-child"])
    expect(first.snapshot.components.find((item) => item.name === "Sibling")?.relatedTokens).toEqual(["--color-sibling"])
    const cachePath = path.join(root, ".design-rover/cache/evidence.json")
    const cache = JSON.parse(await fs.readFile(cachePath, "utf8"))
    cache.version = 4
    for (const file of cache.files) for (const component of file.components) component.classNames = []
    await fs.writeFile(cachePath, JSON.stringify(cache))
    const next = await analyzeRepository(root, { incremental: true })
    expect(next.snapshot.components.find((item) => item.name === "Panel")?.relatedTokens).toEqual(["--color-parent"])
  })

  it("matches complete utility values across variants without guessing longer or arbitrary tokens", () => {
    expect(classReferencesToken("data-[state=open]:hover:!bg-danger/20", "--color-danger", true)).toBe(true)
    expect(classReferencesToken("bg-danger-subtle", "--color-danger", true)).toBe(false)
    expect(classReferencesToken("bg-color-danger", "--color-danger", true)).toBe(false)
    expect(classReferencesToken("text-(color:--brand)", "--brand")).toBe(true)
    expect(classReferencesToken("text-[var(--brand-muted)]", "--brand")).toBe(false)
    expect(classReferencesToken("rounded-t-card", "--radius-card", true)).toBe(true)
    expect(classReferencesToken("md:p-4", "--breakpoint-md", true)).toBe(true)
    expect(classReferencesToken("p-4", "--spacing", true)).toBe(true)
    expect(classReferencesToken("w-1/2", "--spacing", true)).toBe(false)
    expect(classReferencesToken("bg-brand", "--color-brand", false)).toBe(false)
    expect(classReferencesToken("bg-brand", "--brand", false)).toBe(false)
    expect(classReferencesToken("content-['(--brand)']", "--brand", false)).toBe(false)
    expect(classReferencesToken("content-['var(--brand)']", "--brand", false)).toBe(false)
    expect(classReferencesToken("bg-[url(--brand)]", "--brand", false)).toBe(false)
  })

  it("keeps complete conditional template classes without inventing unknown fragments", async () => {
    const root = await repo({
      "theme.css": '@theme { --color-primary: blue; --color-secondary: green; --color-border: gray; --color-unknown: red; }',
      "components/Choice.tsx": 'export function Choice({selected, tone}: {selected: boolean; tone: string}) { return <div className={`border-border ${selected ? "text-primary" : "text-secondary"} bg-${tone}`}/> }',
    })
    const { snapshot, evidence } = await analyzeRepository(root)
    expect(snapshot.components[0]?.relatedTokens).toEqual(["--color-border", "--color-primary", "--color-secondary"])
    const classes = evidence.files.find((item) => item.relative === "components/Choice.tsx")!.components[0]!.classNames
    expect(classes).toEqual(expect.arrayContaining(["border-border", "text-primary", "text-secondary"]))
    expect(classes).not.toContain("bg-")
    expect(classes).not.toContain("unknown")
  })

  it("lets existing models sync new token links and usage without calling them API changes", async () => {
    const root = await repo({
      "theme.css": '@theme { --color-brand: blue; }',
      "components/Button.tsx": 'export function Button(){return <button className="bg-brand"/>}',
      "App.tsx": 'import { Button } from "./components/Button"; export function App(){ return <Button/> }',
    })
    const engine = await createEngine(root)
    const initialized = await engine.init({ generate: false })
    const button = initialized.model.components.find((item) => item.name === "Button")!
    button.relatedTokens = []
    button.usage = []
    await engine.save(initialized.model)
    const preview = await engine.syncPreview()
    const update = preview.diff.changes.find((item) => item.entity === "component" && item.name === "Button")!
    expect(update.kind).toBe("update")
    expect(update.details).toContain("Related design tokens changed.")
    const check = await engine.check()
    expect(check.report.diagnostics.some((item) => item.title === "Button API changed")).toBe(false)
    expect(check.report.diagnostics.some((item) => item.title === "Button design context changed")).toBe(true)
    await engine.applyChanges([button.id], { generate: false })
    const saved = (await engine.load())!.components.find((item) => item.id === button.id)!
    expect(saved.relatedTokens).toEqual(["--color-brand"])
    expect(saved.usage).toEqual([{ file: "App.tsx", count: 1 }])
  })
})

describe("runtime reuse classification", () => {
  it("retains test evidence without treating tests or stories as runtime reuse", async () => {
    const root = await repo({
      "components/Controls.tsx": 'export function Controls() { return <button/> }',
      "App.tsx": 'import { Controls } from "./components/Controls"; export function App(){ return <Controls/> }',
      "components/Controls.test.tsx": 'import { Controls } from "./Controls"; const sample = <Controls/>',
      "components/Controls.stories.tsx": 'import { Controls } from "./Controls"; const sample = <Controls/>',
    })
    const initial = await analyzeRepository(root)
    const controls = initial.snapshot.components.find((item) => item.name === "Controls")!
    expect(controls.usage).toHaveLength(3)
    expect(controls.architecture).toBe("feature-local")
    await fs.writeFile(path.join(root, "Settings.tsx"), 'import { Controls } from "./components/Controls"; export function Settings(){return <Controls/>}')
    const next = await analyzeRepository(root, { incremental: true })
    expect(next.snapshot.components.find((item) => item.name === "Controls")?.architecture).toBe("shared")
  })
})
