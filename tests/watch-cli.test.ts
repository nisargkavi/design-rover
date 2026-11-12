import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { spawn, execFile } from "node:child_process"
import { EventEmitter } from "node:events"
import { promisify } from "node:util"
import { afterEach, describe, expect, it } from "vitest"
import { createEngine, loadCanonical } from "@design-rover/core"

const execute = promisify(execFile)
const entry = path.join(process.cwd(), "packages/cli/src/bin.ts")
const roots: string[] = []
const children: ReturnType<typeof watch>[] = []
const initialButton = 'export function Button({ label }: { label: string }) { return <button className="px-4">{label}</button> }\n'
const updatedButton = 'export function Button({ label, disabled }: { label: string; disabled?: boolean }) { return <button className="px-4" disabled={disabled}>{label}</button> }\n'
type WatchEvent = { type: string; cwd: string; at: string; applied: number; pendingChanges: number; pendingReview: number; staleGenerated: number; actions?: { review?: string }; error?: string }

afterEach(async () => {
  for (const child of children.splice(0)) await child.close()
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

async function project() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "design rover watch cli "))
  roots.push(root)
  await fs.mkdir(path.join(root, "components"))
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ private: true, dependencies: { react: "19.0.0", tailwindcss: "4.0.0" } }))
  await fs.writeFile(path.join(root, "components/Button.tsx"), initialButton)
  const engine = await createEngine(root)
  await engine.init({ generate: false })
  return { root, engine }
}

function watch(root: string, extra: string[] = []) {
  const child = spawn("bun", [entry, "watch", "--cwd", root, "--interval", "100", "--debounce", "100", "--json", ...extra], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] })
  const events: WatchEvent[] = []
  const notifications = new EventEmitter()
  let output = ""
  let pending = ""
  let stderr = ""
  let parseError: Error | undefined
  let exited = false
  child.stdout.on("data", (chunk) => {
    output += String(chunk)
    pending += String(chunk)
    while (pending.includes("\n")) {
      const index = pending.indexOf("\n")
      const line = pending.slice(0, index)
      pending = pending.slice(index + 1)
      if (!line.trim()) continue
      try { events.push(JSON.parse(line) as WatchEvent) }
      catch { parseError = new Error(`Watch stdout is not NDJSON: ${line}`) }
      notifications.emit("change")
    }
  })
  child.stderr.on("data", (chunk) => { stderr += String(chunk) })
  const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once("error", reject)
    child.once("close", (code, signal) => { exited = true; notifications.emit("change"); resolve({ code, signal }) })
  })
  const waitFor = (predicate: (event: WatchEvent) => boolean, after = 0) => new Promise<WatchEvent>((resolve, reject) => {
    const timeout = setTimeout(() => { cleanup(); reject(new Error(`Timed out waiting for a watch event.\nstdout: ${output}\nstderr: ${stderr}`)) }, 10_000)
    const cleanup = () => { clearTimeout(timeout); notifications.off("change", check) }
    const check = () => {
      if (parseError) { cleanup(); reject(parseError); return }
      const event = events.slice(after).find(predicate)
      if (event) { cleanup(); resolve(event); return }
      if (exited) { cleanup(); reject(new Error(`Watch exited before its expected event.\nstdout: ${output}\nstderr: ${stderr}`)) }
    }
    notifications.on("change", check)
    check()
  })
  const close = async () => {
    if (!exited) child.kill("SIGTERM")
    const killer = setTimeout(() => { if (!exited) child.kill("SIGKILL") }, 3000)
    try { return await exit } finally { clearTimeout(killer) }
  }
  const session = { child, events, exit, waitFor, close, output: () => output }
  children.push(session)
  return session
}

async function savedRevision(root: string) {
  return Promise.all(["system.json", "history/events.jsonl"].map((file) => fs.readFile(path.join(root, ".design-rover", file), "utf8")))
}

describe("watch CLI", () => {
  it("documents watch and rejects invalid startup options without initializing a project", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "design rover watch startup "))
    roots.push(root)
    const help = JSON.parse((await execute("bun", [entry, "watch", "--help", "--json", "--cwd", root], { cwd: process.cwd() })).stdout)
    expect(help.help).toContain("--interval")
    expect(help.help).toContain("--generate")
    expect(help.help).toMatch(/approv/i)
    for (const [options, message] of [
      [["--interval", "99"], /interval/i],
      [["--interval", "invalid"], /interval/i],
      [["--debounce", "0"], /debounce/i],
      [["--approve"], /approv/i],
      [["--yes"], /yes/i],
      [[], /not initialized/i],
    ] as const) {
      await expect(execute("bun", [entry, "watch", "--cwd", root, "--json", ...options], { cwd: process.cwd(), timeout: 5000 })).rejects.toMatchObject({ code: 1, stdout: expect.stringMatching(message) })
    }
    await expect(fs.stat(path.join(root, ".design-rover"))).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("keeps observed APIs live through edits, additions, renames and deletions without approving policies", async () => {
    const { root, engine } = await project()
    const original = (await engine.load())!
    expect(original.conventions.some((record) => record.status === "inferred")).toBe(true)
    const session = watch(root)
    const ready = await session.waitFor((event) => event.type === "ready")
    expect(ready.cwd).toBe(root)
    expect(Number.isNaN(Date.parse(ready.at))).toBe(false)

    let after = session.events.length
    await fs.writeFile(path.join(root, "components/Button.tsx"), updatedButton)
    const updated = await session.waitFor((event) => event.type === "updated" && event.applied > 0, after)
    expect(updated.pendingReview).toBeGreaterThan(0)
    const packet = await engine.context({ query: "Button", checkFreshness: false, maxChars: 16000 })
    const button = packet.matches.find((match) => match.kind === "component" && "name" in match.record && match.record.name === "Button")!
    expect("props" in button.record && button.record.props.some((prop) => prop.name === "disabled")).toBe(true)

    after = session.events.length
    await fs.writeFile(path.join(root, "components/Card.tsx"), "export function Card() { return <section /> }\n")
    await session.waitFor((event) => event.type === "updated" && event.applied > 0, after)
    expect((await loadCanonical(root))!.components.some((record) => record.name === "Card")).toBe(true)

    after = session.events.length
    await fs.rename(path.join(root, "components/Card.tsx"), path.join(root, "components/RenamedCard.tsx"))
    await session.waitFor((event) => event.type === "updated" && event.applied > 0, after)
    expect((await loadCanonical(root))!.components.find((record) => record.name === "Card")?.source).toBe("components/RenamedCard.tsx")

    after = session.events.length
    await fs.rm(path.join(root, "components/RenamedCard.tsx"))
    await session.waitFor((event) => event.type === "updated" && event.applied > 0, after)
    const final = (await loadCanonical(root))!
    expect(final.components.some((record) => record.name === "Card")).toBe(false)
    expect(final.conventions).toEqual(original.conventions)
    expect(final.history.filter((event) => event.type === "approved")).toEqual(original.history.filter((event) => event.type === "approved"))
    expect(await fs.readFile(path.join(root, "components/Button.tsx"), "utf8")).toBe(updatedButton)
    await expect(fs.stat(path.join(root, "AGENTS.md"))).rejects.toMatchObject({ code: "ENOENT" })

    const revision = await savedRevision(root)
    const updateCount = session.events.filter((event) => event.type === "updated").length
    await new Promise((resolve) => setTimeout(resolve, 700))
    expect(await savedRevision(root)).toEqual(revision)
    expect(session.events.filter((event) => event.type === "updated")).toHaveLength(updateCount)
    session.child.kill("SIGINT")
    await session.waitFor((event) => event.type === "stopped")
    expect(await session.exit).toEqual({ code: 0, signal: null })
    expect(session.output().trim().split("\n").every((line) => JSON.parse(line).type)).toBe(true)
  })

  it("leaves approved APIs and pending decisions intact while reporting review actions", async () => {
    const { root, engine } = await project()
    const observed = (await engine.load())!.components.find((record) => record.name === "Button")!
    await engine.applyChanges([observed.id], { generate: false })
    const before = (await engine.load())!
    const approved = before.components.find((record) => record.id === observed.id)!
    expect(approved.status).toBe("approved")
    const session = watch(root)
    await session.waitFor((event) => event.type === "ready")
    const after = session.events.length
    await fs.writeFile(path.join(root, "components/Button.tsx"), updatedButton)
    await fs.writeFile(path.join(root, "components/Card.tsx"), "export function Card() { return <section /> }\n")
    const event = await session.waitFor((item) => item.type === "updated" && item.applied > 0, after)
    expect(event.pendingChanges).toBeGreaterThan(0)
    expect(event.actions?.review).toBe("bunx design-rover diff --json")
    expect(await session.close()).toEqual({ code: 0, signal: null })
    const saved = (await loadCanonical(root))!
    expect(saved.components.find((record) => record.id === approved.id)).toEqual(approved)
    expect(saved.components.find((record) => record.name === "Card")?.status).toBe("observed")
    expect(saved.conventions).toEqual(before.conventions)
    expect(saved.history.filter((item) => item.type === "approved")).toEqual(before.history.filter((item) => item.type === "approved"))
    expect(session.events.at(-1)?.type).toBe("stopped")
  })

  it("retains the last good map on incomplete syntax and resumes after a valid save", async () => {
    const { root, engine } = await project()
    const session = watch(root)
    await session.waitFor((event) => event.type === "ready")
    const original = (await engine.load())!
    const revision = await savedRevision(root)
    let after = session.events.length
    await fs.writeFile(path.join(root, "components/Button.tsx"), "export function Button({ label: ) { return <button>\n")
    const failed = await session.waitFor((event) => event.type === "error", after)
    expect(failed.error).toContain("Button.tsx")
    expect(await loadCanonical(root)).toEqual(original)
    expect(await savedRevision(root)).toEqual(revision)
    after = session.events.length
    await fs.writeFile(path.join(root, "components/Button.tsx"), updatedButton)
    await session.waitFor((event) => event.type === "updated" && event.applied > 0, after)
    expect((await engine.load())!.components.find((record) => record.name === "Button")?.props.some((prop) => prop.name === "disabled")).toBe(true)
    expect(await session.close()).toEqual({ code: 0, signal: null })
  })

  it("regenerates guidance only when explicitly requested and preserves human notes", async () => {
    const { root, engine } = await project()
    await fs.writeFile(path.join(root, "AGENTS.md"), "# Maintainer notes\nKeep feature logic close to its screen.\n")
    const session = watch(root, ["--generate"])
    await session.waitFor((event) => event.type === "ready")
    const after = session.events.length
    await fs.writeFile(path.join(root, "components/Card.tsx"), "export function Card() { return <section /> }\n")
    await session.waitFor((event) => event.type === "updated" && event.applied > 0, after)
    expect(await session.close()).toEqual({ code: 0, signal: null })
    const guidance = await fs.readFile(path.join(root, "AGENTS.md"), "utf8")
    expect(guidance).toContain("# Maintainer notes\nKeep feature logic close to its screen.")
    expect(guidance).toContain("<!-- design-rover:start -->")
    expect(guidance).toContain("<!-- design-rover:end -->")
    expect((await engine.load())!.conventions.some((record) => record.status === "inferred")).toBe(true)
  })
})
