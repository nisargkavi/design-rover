import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createEngine, watchRepository } from "@design-rover/core"

const roots: string[] = []
const watchers: { controller: AbortController; done: Promise<void> }[] = []
const buttonSource = 'export function Button({ label }: { label: string }) { return <button className="px-4">{label}</button> }\n'

afterEach(async () => {
  for (const watcher of watchers.splice(0)) {
    watcher.controller.abort()
    await watcher.done
  }
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

async function project() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "design rover watch core "))
  roots.push(root)
  await fs.mkdir(path.join(root, "components"))
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ private: true, dependencies: { react: "19.0.0", tailwindcss: "4.0.0" } }))
  await fs.writeFile(path.join(root, "components/Button.tsx"), buttonSource)
  await fs.writeFile(path.join(root, "theme.css"), ":root { --brand-color: blue; }\n")
  const engine = await createEngine(root)
  await engine.init({ generate: false })
  return { root, engine }
}

async function start(root: string, options: { generate?: boolean } = {}) {
  const events: { type: string; applied: number; pendingChanges: number; error?: string }[] = []
  const controller = new AbortController()
  const done = watchRepository(root, { signal: controller.signal, intervalMs: 100, debounceMs: 100, ...options, onEvent: (event) => { events.push(event) } })
  watchers.push({ controller, done })
  await vi.waitFor(() => expect(events.some((event) => event.type === "ready")).toBe(true), { timeout: 6000, interval: 25 })
  return { events, controller, done }
}

async function durableFiles(root: string) {
  const files: Record<string, string> = {}
  async function visit(relative = "") {
    for (const entry of await fs.readdir(path.join(root, ".design-rover", relative), { withFileTypes: true })) {
      const child = path.join(relative, entry.name)
      if (child === "cache") continue
      if (entry.isDirectory()) await visit(child)
      else if (entry.isFile()) files[child] = await fs.readFile(path.join(root, ".design-rover", child), "utf8")
    }
  }
  await visit()
  return files
}

describe("live observed inventory", () => {
  it("refreshes added, edited, renamed and deleted components while leaving policy pending", async () => {
    const { root, engine } = await project()
    const before = (await engine.load())!
    const pending = before.conventions.map(({ id, status }) => ({ id, status }))
    expect(pending.some((item) => item.status === "inferred")).toBe(true)
    const { events } = await start(root)
    const source = path.join(root, "components/NewAction.tsx")
    await fs.writeFile(source, "export function NewAction() { return <button>Continue</button> }\n")
    await vi.waitFor(async () => expect((await engine.load())!.components.find((item) => item.name === "NewAction")?.status).toBe("observed"), { timeout: 6000 })
    await fs.writeFile(source, "export function NewAction({ disabled }: { disabled?: boolean }) { return <button disabled={disabled}>Continue</button> }\n")
    await vi.waitFor(async () => expect((await engine.load())!.components.find((item) => item.name === "NewAction")?.props.some((prop) => prop.name === "disabled")).toBe(true), { timeout: 6000 })
    await fs.rename(source, path.join(root, "components/MovedAction.tsx"))
    await vi.waitFor(async () => expect((await engine.load())!.components.find((item) => item.name === "NewAction")?.source).toBe("components/MovedAction.tsx"), { timeout: 6000 })
    await fs.rm(path.join(root, "components/MovedAction.tsx"))
    await vi.waitFor(async () => expect((await engine.load())!.components.some((item) => item.name === "NewAction")).toBe(false), { timeout: 6000 })
    const after = (await engine.load())!
    expect(after.conventions.map(({ id, status }) => ({ id, status }))).toEqual(pending)
    expect(after.history.filter((event) => event.type === "approved")).toEqual(before.history.filter((event) => event.type === "approved"))
    expect(events.some((event) => event.type === "updated" && event.applied > 0)).toBe(true)
    expect(await fs.readFile(path.join(root, "components/Button.tsx"), "utf8")).toBe(buttonSource)
  })

  it("updates observed tokens without approving them", async () => {
    const { root, engine } = await project()
    await start(root)
    await fs.writeFile(path.join(root, "theme.css"), ":root { --brand-color: red; --space-control: 8px; }\n")
    await vi.waitFor(async () => {
      const model = (await engine.load())!
      expect(model.tokens.find((item) => item.name === "--brand-color")?.value).toBe("red")
      expect(model.tokens.find((item) => item.name === "--space-control")?.status).toBe("observed")
    }, { timeout: 6000 })
  })

  it("tracks ignored but active tsconfig aliases and rejects malformed configuration", async () => {
    const { root, engine } = await project()
    await fs.mkdir(path.join(root, "types-old"))
    await fs.mkdir(path.join(root, "types-new"))
    await fs.writeFile(path.join(root, "types-old/ButtonProps.ts"), "export interface ButtonProps { label: string; oldOnly?: boolean }\n")
    await fs.writeFile(path.join(root, "types-new/ButtonProps.ts"), "export interface ButtonProps { label: string; newOnly?: boolean }\n")
    await fs.writeFile(path.join(root, "components/Button.tsx"), 'import type { ButtonProps } from "@/ButtonProps"; export function Button(props: ButtonProps) { return <button>{props.label}</button> }\n')
    await fs.writeFile(path.join(root, "support.cts"), "export = function utility() { return 1 }\n")
    await fs.writeFile(path.join(root, ".gitignore"), "tsconfig.json\n")
    const config = (directory: string) => JSON.stringify({ compilerOptions: { paths: { "@/*": [`${directory}/*`] } } })
    await fs.writeFile(path.join(root, "tsconfig.json"), config("types-old"))
    const preview = await engine.syncPreview()
    const componentChange = preview.diff.changes.find((change) => change.entity === "component" && change.name === "Button")!
    await engine.applyChanges([componentChange.id], { generate: false })
    expect((await engine.load())!.components[0]!.props.some((prop) => prop.name === "oldOnly")).toBe(true)
    const { events } = await start(root)
    await fs.writeFile(path.join(root, "tsconfig.json"), config("types-new"))
    await vi.waitFor(async () => {
      const props = (await engine.load())!.components[0]!.props.map((prop) => prop.name)
      expect(props).toContain("newOnly")
      expect(props).not.toContain("oldOnly")
    }, { timeout: 6000 })
    expect(events.some((event) => event.type === "error")).toBe(false)
    const saved = await durableFiles(root)
    await fs.writeFile(path.join(root, "tsconfig.json"), "{")
    await vi.waitFor(() => expect(events.some((event) => event.type === "error")).toBe(true), { timeout: 6000 })
    expect(await durableFiles(root)).toEqual(saved)
  })

  it("reconciles the discovered inventory when ignore rules change", async () => {
    const { root, engine } = await project()
    await start(root)
    await fs.writeFile(path.join(root, ".gitignore"), "components/Button.tsx\n")
    await vi.waitFor(async () => expect((await engine.load())!.components.some((item) => item.name === "Button")).toBe(false), { timeout: 6000 })
    await fs.writeFile(path.join(root, ".gitignore"), "")
    await vi.waitFor(async () => expect((await engine.load())!.components.find((item) => item.name === "Button")?.status).toBe("observed"), { timeout: 6000 })
  })

  it("keeps approved APIs and human-annotated observed tokens unchanged for explicit review", async () => {
    const { root, engine } = await project()
    const model = (await engine.load())!
    await engine.applyChanges([model.components[0]!.id], { generate: false })
    const approved = (await engine.load())!
    await engine.save({ ...approved, tokens: approved.tokens.map((item) => ({ ...item, notes: "Team-owned token" })) })
    const saved = (await engine.load())!
    const { events } = await start(root)
    await fs.writeFile(path.join(root, "components/Button.tsx"), 'export function Button() { return <button>Changed API</button> }\n')
    await fs.writeFile(path.join(root, "theme.css"), ":root { --brand-color: red; }\n")
    await vi.waitFor(() => expect(events.some((event) => event.type === "review" && event.pendingChanges > 0)).toBe(true), { timeout: 6000 })
    const after = (await engine.load())!
    expect(after.components).toEqual(saved.components)
    expect(after.tokens).toEqual(saved.tokens)
    expect(after.history).toEqual(saved.history)
    const reviews = events.filter((event) => event.type === "review").length
    await fs.writeFile(path.join(root, "components/Button.tsx"), 'export function Button({ loading }: { loading?: boolean }) { return <button disabled={loading}>Another API</button> }\n')
    await vi.waitFor(() => expect(events.filter((event) => event.type === "review").length).toBeGreaterThan(reviews), { timeout: 6000 })
    expect((await engine.load())!.components).toEqual(saved.components)
    await fs.rm(path.join(root, "components/Button.tsx"))
    await delay(400)
    expect((await engine.load())!.components).toEqual(saved.components)
  })

  it.each(["inferred", "rejected", "deprecated"] as const)("does not replace %s component decisions", async (status) => {
    const { root, engine } = await project()
    const model = (await engine.load())!
    await engine.save({ ...model, components: model.components.map((item) => ({ ...item, status })) })
    const saved = (await engine.load())!
    await start(root)
    await fs.writeFile(path.join(root, "components/Button.tsx"), 'export function Button() { return <button>Changed</button> }\n')
    await delay(500)
    expect((await engine.load())!.components).toEqual(saved.components)
    expect((await engine.load())!.history).toEqual(saved.history)
  })

  it("does not rewrite durable state when idle or reacting to ignored cache/dependency files", async () => {
    const { root } = await project()
    const { events } = await start(root)
    const saved = await durableFiles(root)
    await fs.mkdir(path.join(root, "node_modules/fake"), { recursive: true })
    await fs.writeFile(path.join(root, "node_modules/fake/Fake.tsx"), "export function Fake() { return <div /> }")
    await fs.writeFile(path.join(root, ".design-rover/cache/Fake.tsx"), "export function Fake() { return <div /> }")
    await delay(450)
    expect(await durableFiles(root)).toEqual(saved)
    expect(events.filter((event) => event.type === "updated")).toEqual([])
    await expect(fs.stat(path.join(root, "AGENTS.md"))).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("waits for a burst of edits to settle before saving an observed API", async () => {
    const { root, engine } = await project()
    await start(root)
    const history = (await engine.load())!.history
    const source = path.join(root, "components/Button.tsx")
    await fs.writeFile(source, 'export function Button({ draft }: { draft?: boolean }) { return <button>Draft</button> }\n')
    await delay(30)
    await fs.writeFile(source, 'export function Button({ finalLabel }: { finalLabel: string }) { return <button>{finalLabel}</button> }\n')
    await vi.waitFor(async () => expect((await engine.load())!.components[0]!.props.map((prop) => prop.name)).toEqual(["finalLabel"]), { timeout: 6000 })
    const addedHistory = (await engine.load())!.history.slice(history.length)
    expect(addedHistory.filter((event) => event.type === "update" && event.entity === "Button")).toHaveLength(1)
  })

  it.each([
    ["components/Button.tsx", "export function Button( { return <button />"],
    ["theme.css", ":root { --brand-color: red;"],
    ["package.json", '{ "dependencies": '],
  ])("preserves saved inventory during malformed %s and recovers after a valid edit", async (relative, invalid) => {
    const { root, engine } = await project()
    const { events } = await start(root)
    const saved = await durableFiles(root)
    const source = path.join(root, relative)
    const original = await fs.readFile(source, "utf8")
    await fs.writeFile(source, invalid)
    await vi.waitFor(() => expect(events.some((event) => event.type === "error")).toBe(true), { timeout: 6000 })
    expect(await durableFiles(root)).toEqual(saved)
    const errorIndex = events.findIndex((event) => event.type === "error")
    await fs.writeFile(source, original)
    await vi.waitFor(() => expect(events.slice(errorIndex + 1).some((event) => event.type !== "error" && event.type !== "stopped")).toBe(true), { timeout: 6000 })
    expect(await durableFiles(root)).toEqual(saved)
    await fs.writeFile(path.join(root, "components/Recovery.tsx"), "export function Recovery() { return <div /> }\n")
    await vi.waitFor(async () => expect((await engine.load())!.components.some((item) => item.name === "Recovery")).toBe(true), { timeout: 6000 })
  })

  it("stops cleanly on cancellation and does not apply later edits", async () => {
    const { root, engine } = await project()
    const { events, controller, done } = await start(root)
    controller.abort()
    await done
    expect(events.at(-1)?.type).toBe("stopped")
    const saved = await durableFiles(root)
    await fs.writeFile(path.join(root, "components/AfterStop.tsx"), "export function AfterStop() { return <div /> }\n")
    await delay(250)
    expect((await engine.load())!.components.some((item) => item.name === "AfterStop")).toBe(false)
    expect(await durableFiles(root)).toEqual(saved)
  })
})
