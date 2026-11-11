import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { analyzeRepository, createEngine, emptyCanonical } from "@design-rover/core"
import { explain } from "../packages/core/src/explain.ts"

const roots: string[] = []
async function repo(files: Record<string, string>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "rover-types-"))
  roots.push(root)
  for (const [file, content] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true })
    await fs.writeFile(path.join(root, file), content)
  }
  return root
}
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))) })

const button = (type: string, imports = "") => `${imports}\nexport function Button(props: ${type}) { return <button>{props.label}</button> }`

async function component(files: Record<string, string>) {
  const root = await repo(files)
  const result = await analyzeRepository(root)
  return { root, ...result, component: result.snapshot.components.find((item) => item.name === "Button")! }
}

describe("local TypeScript props resolution", () => {
  it("resolves JSONC/baseUrl aliases, type barrels, utility intersections and defaults", async () => {
    const { component: found } = await component({
      "tsconfig.json": '{ // JSONC is standard TypeScript configuration\n "compilerOptions": { "baseUrl": "./src", "paths": { "@types/*": ["types/*"], }, }, }',
      "src/types/base.ts": 'export interface BaseProps { label?: string; disabled?: boolean; tone: "primary" | "quiet" }',
      "src/types/index.ts": 'export type { BaseProps as ButtonProps } from "./base"',
      "src/components/ui/Button.tsx": 'import type { ButtonProps as UiButtonProps } from "@types/index"; type Props = Required<Pick<UiButtonProps, "tone">> & Omit<Partial<UiButtonProps>, "tone"> & { count: number }; export function Button({ tone, label = "Save", count }: Props) { return <button>{label}</button> }',
    })
    expect(found.propsResolution).toEqual({ status: "resolved", issues: [] })
    expect(found.props).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "count", type: "number", required: true }),
      expect.objectContaining({ name: "tone", values: ["primary", "quiet"], required: true }),
      expect.objectContaining({ name: "label", type: "string", required: false, defaultValue: '"Save"' }),
      expect.objectContaining({ name: "disabled", type: "false | true", required: false }),
    ]))
  })

  it("resolves inherited interfaces, namespace type imports and generic aliases", async () => {
    const { component: found } = await component({
      "types/base.ts": 'export interface Base<T> { value: T; tone?: "quiet" | "loud" }; export interface TextProps extends Base<string> { label: string }',
      "types/index.ts": 'export * from "./base"',
      "components/ui/Button.tsx": button("Types.TextProps", 'import type * as Types from "../../types"'),
    })
    expect(found.propsResolution?.status).toBe("resolved")
    expect(found.props).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "value", type: "string", required: true }),
      expect.objectContaining({ name: "label", type: "string", required: true }),
      expect.objectContaining({ name: "tone", values: ["loud", "quiet"], required: false }),
    ]))
  })

  it("refreshes dependent props and drift when only an imported type file changes", async () => {
    const root = await repo({
      "types.ts": "export interface ButtonProps { label?: string }",
      "components/ui/Button.tsx": button("ButtonProps", 'import type { ButtonProps } from "../../types"'),
    })
    const engine = await createEngine(root)
    await engine.init({ approve: true, generate: false })
    const before = await fs.readFile(path.join(root, "components/ui/Button.tsx"), "utf8")
    await fs.writeFile(path.join(root, "types.ts"), "export interface ButtonProps { label: number }")
    const preview = await engine.syncPreview({ incremental: true })
    expect(await fs.readFile(path.join(root, "components/ui/Button.tsx"), "utf8")).toBe(before)
    expect(preview.snapshot.components[0]?.props).toContainEqual(expect.objectContaining({ name: "label", type: "number", required: true }))
    expect(preview.diff.changes.filter((item) => item.entity === "component")).toHaveLength(1)
    expect((await engine.check()).report.diagnostics.some((item) => item.title === "Button API changed")).toBe(true)
  })

  it("retains proven local fields and explains unsupported external types", async () => {
    const { root, component: found } = await component({
      "components/ui/Button.tsx": 'import type { NativeProps } from "external-ui"; interface Props extends NativeProps { label: string }; export function Button(props: Props) { return <button>{props.label}</button> }',
    })
    expect(found.propsResolution?.status).toBe("partial")
    expect(found.props).toEqual([expect.objectContaining({ name: "label", type: "string", required: true })])
    expect(found.propsResolution?.issues.join(" ")).toContain("external-ui")
    const model = emptyCanonical(root, "test")
    model.components = [found]
    const text = explain(model, found.id)
    expect(text).toContain("partial")
    expect(text).toContain("external-ui")
  })

  it("recovers only independently proven intersection fields when an import is unresolved", async () => {
    const { component: found } = await component({
      "components/ui/Button.tsx": 'import type { MissingProps } from "missing-package"; type Props = MissingProps & { label: string }; export function Button(props: Props) { return <button /> }',
    })
    expect(found.propsResolution?.status).toBe("partial")
    expect(found.props).toEqual([expect.objectContaining({ name: "label", type: "string" })])
  })

  it("does not guess one branch of ambiguous type star exports", async () => {
    const files = {
      "types/a.ts": "export interface Props { fromA: string }",
      "types/b.ts": "export interface Props { fromB: number }",
      "types/index.ts": 'export * from "./a"; export * from "./b"',
    }
    const unresolved = await component({ ...files, "components/ui/Button.tsx": button("Props", 'import type { Props } from "../../types"') })
    expect(unresolved.component.propsResolution?.status).toBe("unresolved")
    expect(unresolved.component.propsResolution?.issues.join(" ")).toContain("Ambiguous")
    expect(unresolved.component.props).toEqual([])
    const partial = await component({ ...files, "components/ui/Button.tsx": button("Props & { label: string }", 'import type { Props } from "../../types"') })
    expect(partial.component.propsResolution?.status).toBe("partial")
    expect(partial.component.props).toEqual([expect.objectContaining({ name: "label", type: "string" })])
  })

  it("resolves local import-type expressions and refuses ambiguous import-type branches", async () => {
    const files = {
      "types/a.ts": "export interface Props { alpha: string }; export const defaults = { alpha: '' }",
      "types/b.ts": "export interface Props { beta: number }; export const defaults = { beta: 1 }",
      "types/ambiguous.ts": 'export * from "./a"; export * from "./b"',
    }
    const local = await component({ ...files, "components/ui/Button.tsx": button('import("../../types/a").Props') })
    expect(local.component.propsResolution?.status).toBe("resolved")
    expect(local.component.props).toEqual([expect.objectContaining({ name: "alpha", type: "string" })])
    for (const expression of ['import("../../types/ambiguous").Props', 'typeof import("../../types/ambiguous").defaults']) {
      const result = await component({ ...files, "components/ui/Button.tsx": button(expression) })
      expect(result.component.propsResolution?.status).toBe("unresolved")
      expect(result.component.propsResolution?.issues.join(" ")).toContain("Ambiguous")
      expect(result.component.props).toEqual([])
    }
    const partial = await component({ ...files, "components/ui/Button.tsx": 'type Props = import("../../types/ambiguous").Props & { label: string }; export function Button(props: Props){return <button/>}' })
    expect(partial.component.propsResolution?.status).toBe("partial")
    expect(partial.component.props).toEqual([expect.objectContaining({ name: "label", type: "string" })])
    const external = await component({ "components/ui/Button.tsx": button('import("external-package").Props') })
    expect(external.component.propsResolution?.status).toBe("unresolved")
    expect(external.component.props).toEqual([])
  })

  it.each(["string", "number", "boolean"])("does not enumerate primitive %s members as component props", async (type) => {
    const { component: found } = await component({ "components/ui/Button.tsx": button(type) })
    expect(found.props).toEqual([])
    expect(found.propsResolution?.status).toBe("unresolved")
    expect(found.propsResolution?.issues.join(" ")).toContain("non-object")
  })

  it("reports cyclic aliases and generic unknowns without hanging or inventing fields", async () => {
    const cycle = await component({ "components/ui/Button.tsx": 'type A = B; type B = A; export function Button(props: A) { return <button /> }' })
    expect(cycle.component.propsResolution?.status).toBe("unresolved")
    expect(cycle.component.propsResolution?.issues.join(" ")).toMatch(/circular|concrete/)
    const generic = await component({ "components/ui/Button.tsx": 'interface Props<T> { value: T }; export function Button<T>(props: Props<T>) { return <button /> }' })
    expect(generic.component.propsResolution?.status).toBe("partial")
    expect(generic.component.propsResolution?.issues.join(" ")).toContain("generic")
  })

  it("reads React-style annotations and wrapper type arguments without loading React", async () => {
    const root = await repo({
      "components/ui/Label.tsx": 'import type React from "react"; interface Props { label: string }; export const Label: React.FC<Props> = ({label}) => <span>{label}</span>',
      "components/ui/Button.tsx": 'import { forwardRef } from "react"; interface Props { label: string }; export const Button = forwardRef<unknown, Props>((props, ref) => <button>{props.label}</button>)',
    })
    const { snapshot } = await analyzeRepository(root)
    expect(snapshot.components).toHaveLength(2)
    for (const found of snapshot.components) {
      expect(found.propsResolution).toEqual({ status: "resolved", issues: [] })
      expect(found.props).toEqual([expect.objectContaining({ name: "label", type: "string", required: true })])
    }
  })

  it("keeps explicit public props when a typed callback ignores its parameter", async () => {
    const root = await repo({
      "components/ui/Label.tsx": 'type FC<P> = (props: P) => unknown; interface Props { label: string }; export const Label: FC<Props> = () => <span />',
      "components/ui/Button.tsx": 'import { forwardRef, memo } from "react"; interface Props { label: string }; export const Button = forwardRef<unknown, Props>(() => <button />); export const MemoButton = memo<Props>(() => <button />)',
    })
    const { snapshot } = await analyzeRepository(root)
    expect(snapshot.components).toHaveLength(3)
    for (const found of snapshot.components) {
      expect(found.propsResolution?.status).toBe("resolved")
      expect(found.props).toEqual([expect.objectContaining({ name: "label", type: "string", required: true })])
    }
  })

  it("does not claim complete class contracts with unresolved inherited members", async () => {
    const { component: found } = await component({ "components/ui/Button.tsx": 'declare class Base extends MissingBase {}; class Props extends Base { label = "" }; export function Button(props: Props){return <button/>}' })
    expect(found.propsResolution?.status).toBe("partial")
    expect(found.propsResolution?.issues.join(" ")).toContain("MissingBase")
    expect(found.propsResolution?.issues.join(" ")).toContain("Class-based")
    expect(found.props).toEqual([expect.objectContaining({ name: "label", type: "string" })])
  })

  it("surfaces relevant type syntax errors instead of claiming a complete API", async () => {
    const { component: found } = await component({ "components/ui/Button.tsx": 'type Props = { label: string age: number }; export function Button(props: Props){return <button/>}' })
    expect(found.propsResolution?.status).toBe("partial")
    expect(found.propsResolution?.issues.join(" ")).toContain("expected")
  })

  it("labels untyped destructuring honestly and does not assume an unused Props interface", async () => {
    const { component: found } = await component({ "components/ui/Button.tsx": 'interface ButtonProps { invented: number }; export function Button({ label = "Save", ...rest }) { return <button>{label}</button> }' })
    expect(found.propsResolution?.status).toBe("untyped")
    expect(found.props).toEqual([expect.objectContaining({ name: "label", required: false, defaultValue: '"Save"' })])
    expect(found.props.some((prop) => prop.name === "rest" || prop.name === "invented")).toBe(false)
  })

  it("never executes source or TypeScript configuration", async () => {
    const root = await repo({
      "components/ui/Button.tsx": 'import fs from "node:fs"; fs.writeFileSync("executed.txt", "bad"); interface Props { label: string }; export function Button(props: Props) { return <button /> }',
      "tsconfig.ts": 'throw new Error("config executed")',
    })
    const result = await analyzeRepository(root)
    expect(result.snapshot.components[0]?.propsResolution?.status).toBe("resolved")
    await expect(fs.stat(path.join(root, "executed.txt"))).rejects.toMatchObject({ code: "ENOENT" })
  })
})

describe("local component barrel attribution", () => {
  it("follows named/default chains and aliases to the declaring component", async () => {
    const root = await repo({
      "components/ui/Button.tsx": 'interface Props { label: string }; export default function Button(props: Props) { return <button /> }',
      "components/ui/step.ts": 'export { default as ActionButton } from "./Button.js"',
      "components/index.ts": 'export { ActionButton as UiButton } from "./ui/step"',
      "App.tsx": 'import { UiButton as Save } from "./components"; export function App(){ return <Save label="Save" /> }',
    })
    const { snapshot } = await analyzeRepository(root)
    const found = snapshot.components.find((item) => item.name === "Button")!
    expect(found.exportName).toBe("default")
    expect(found.usage).toEqual([{ file: "App.tsx", count: 1 }])
    expect(found.propsResolution?.status).toBe("resolved")
  })

  it("resolves a cycle with one concrete export and refuses ambiguous star exports", async () => {
    const root = await repo({
      "components/ui/a.tsx": "export function Button() { return <button /> }",
      "components/ui/b.tsx": "export function Button() { return <button /> }",
      "components/first.ts": 'export * from "./second"; export { Button } from "./ui/a"',
      "components/second.ts": 'export * from "./first"',
      "components/ambiguous.ts": 'export * from "./ui/a"; export * from "./ui/b"',
      "App.tsx": 'import { Button as Cyclic } from "./components/second"; import { Button as Ambiguous } from "./components/ambiguous"; export function App(){ return <><Cyclic/><Ambiguous/></> }',
    })
    const { snapshot } = await analyzeRepository(root)
    expect(snapshot.components.find((item) => item.source === "components/ui/a.tsx")?.usage).toEqual([{ file: "App.tsx", count: 1 }])
    expect(snapshot.components.find((item) => item.source === "components/ui/b.tsx")?.usage).toEqual([])
  })

  it("does not treat type-only imports or type-only exports as runtime components", async () => {
    const root = await repo({
      "components/ui/Button.tsx": "export function Button() { return <button /> }",
      "components/types.ts": 'export type { Button } from "./ui/Button"',
      "App.tsx": 'import { type Button as TypeImport } from "./components/ui/Button"; import { Button as TypeExport } from "./components/types"; export function App(){return <><TypeImport/><TypeExport/></>}',
    })
    const { snapshot } = await analyzeRepository(root)
    expect(snapshot.components.find((item) => item.name === "Button")?.usage).toEqual([])
  })
})
