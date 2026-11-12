import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { createEngine, emptyCanonical, loadCanonical, saveCanonical } from "@design-rover/core"
import type { ComponentRecord, PatternRecord } from "@design-rover/model"
import { createMcpServer } from "./index.ts"

const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

async function session() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "design-rover mcp-"))
  cleanups.push(() => fs.rm(root, { recursive: true, force: true }))
  const server = await createMcpServer(root)
  const client = new Client({ name: "test-client", version: "1.0.0" })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  cleanups.push(() => server.close(), () => client.close())
  return { root, client }
}

function pattern(id: string, status: PatternRecord["status"]): PatternRecord {
  return { id, name: id.slice(8), status, confidence: "high", originKind: "implementation", evidence: [], occurrences: [], implementation: "colocated", architecture: "do-not-extract", similarity: 1, fingerprint: id, guidance: "Existing composition" }
}

function button(id: string, source: string): ComponentRecord {
  return { id, name: "Button", source, exportName: "Button", importPath: `./${source}`, status: "observed", confidence: "high", originKind: "implementation", evidence: [], props: [], variants: [], sizes: [], composition: [], dependencies: [], relatedTokens: [], usage: [], examples: [], architecture: "shared", local: false }
}

function content(result: Awaited<ReturnType<Client["callTool"]>>) {
  const blocks = result.content as { type: string; text?: string }[]
  return JSON.parse(blocks.find((block) => block.type === "text")!.text!)
}

async function savedFiles(root: string) {
  const files: Record<string, string> = {}
  async function visit(relative = "") {
    for (const entry of await fs.readdir(path.join(root, ".design-rover", relative), { withFileTypes: true })) {
      const child = path.join(relative, entry.name)
      if (child === "cache") continue
      if (entry.isDirectory()) await visit(child)
      else files[child] = await fs.readFile(path.join(root, ".design-rover", child), "utf8")
    }
  }
  await visit()
  return files
}

describe("MCP knowledge contracts", () => {
  it("reports an uninitialized model as an error rather than a clean snippet", async () => {
    const { client } = await session()
    expect((await client.listTools()).tools).toHaveLength(10)
    const result = await client.callTool({ name: "check_code", arguments: { code: "<Button />" } })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toContain("not initialized")
  })

  it("does not return rejected or unreviewed patterns as approved guidance", async () => {
    const { root, client } = await session()
    const model = emptyCanonical(root, "test")
    model.patterns = [pattern("pattern.approved", "approved"), pattern("pattern.suggested", "suggested"), pattern("pattern.rejected", "rejected")]
    await saveCanonical(root, model)
    expect(content(await client.callTool({ name: "get_pattern", arguments: { name: "approved" } })).status).toBe("approved")
    expect(content(await client.callTool({ name: "get_pattern", arguments: { name: "suggested" } })).error).toBe("not found")
    expect(content(await client.callTool({ name: "get_pattern", arguments: { name: "rejected" } })).error).toBe("not found")
    const found = content(await client.callTool({ name: "search_system", arguments: { query: "suggested" } }))
    expect(found.patterns).toEqual([])
    const review = content(await client.callTool({ name: "search_system", arguments: { query: "suggested", includePending: true } }))
    expect(review.patterns).toHaveLength(1)
  })

  it("requires a component ID or source when the name is ambiguous", async () => {
    const { root, client } = await session()
    const model = emptyCanonical(root, "test")
    model.components = [button("component.button-a", "a/Button.tsx"), button("component.button-b", "b/Button.tsx")]
    await saveCanonical(root, model)
    const ambiguous = content(await client.callTool({ name: "get_component", arguments: { name: "Button" } }))
    expect(ambiguous.error).toBe("ambiguous component")
    expect(ambiguous.choices).toHaveLength(2)
    const resolved = content(await client.callTool({ name: "get_component", arguments: { name: "Button", source: "b/Button.tsx" } }))
    expect(resolved.id).toBe("component.button-b")
  })

  it("exposes bounded path context without scanning source or returning unrelated packages", async () => {
    const { root, client } = await session()
    const model = emptyCanonical(root, "test")
    model.components = [button("component.admin", "apps/admin/Button.tsx"), button("component.store", "apps/store/Button.tsx")]
    await saveCanonical(root, model)
    const tools = (await client.listTools()).tools
    expect(tools.find((tool) => tool.name === "get_context")?.annotations?.readOnlyHint).toBe(true)
    const response = await client.callTool({ name: "get_context", arguments: { query: "Button", path: "apps/admin", maxChars: 5000, checkFreshness: false } })
    expect(response.isError).not.toBe(true)
    const packet = content(response)
    expect(packet.matches.map((item: { record: { id: string } }) => item.record.id)).toEqual(["component.admin"])
    expect(packet.freshness.checked).toBe(false)
    const text = (response.content as { type: string; text: string }[]).find((item) => item.type === "text")!.text
    expect(text.length).toBe(packet.limits.outputChars)
    expect(packet.limits.outputChars).toBeLessThanOrEqual(5000)
    await expect(fs.stat(path.join(root, ".design-rover/cache"))).rejects.toMatchObject({ code: "ENOENT" })
    const invalid = await client.callTool({ name: "get_context", arguments: { path: "../outside" } })
    expect(invalid.isError).toBe(true)
  })

  it("checks freshness by default and exposes a scoped refresh action without changing saved decisions", async () => {
    const { root, client } = await session()
    await fs.cp(path.join(process.cwd(), "fixtures/next-tailwind"), root, { recursive: true, filter: (file) => !file.includes("node_modules") && !file.includes(".design-rover") })
    await (await createEngine(root)).init({ generate: false })
    const model = (await loadCanonical(root))!
    const persisted = await savedFiles(root)
    const pending = [...model.patterns, ...model.conventions, ...model.intents, ...model.exceptions].filter((item) => item.status === "inferred" || item.status === "suggested")
    expect(pending.length).toBeGreaterThan(0)
    const fresh = content(await client.callTool({ name: "get_context", arguments: { query: "Button", path: "components/ui", maxChars: 18000 } }))
    expect(fresh.freshness).toMatchObject({ checked: true, sourceStatus: "current", sourceChanges: 0 })
    expect(fresh.freshness.pendingReview).toBeGreaterThan(0)
    expect(fresh.freshness.actions?.refresh).toBeUndefined()
    expect(Number.isNaN(Date.parse(fresh.freshness.checkedAt))).toBe(false)
    expect(await savedFiles(root)).toEqual(persisted)

    const buttonFile = path.join(root, "components/ui/button.tsx")
    const changed = (await fs.readFile(buttonFile, "utf8")).replace('ghost: "bg-transparent"', 'quiet: "bg-transparent"')
    await fs.writeFile(buttonFile, changed)
    const response = await client.callTool({ name: "get_context", arguments: { query: "Button", path: "components/ui", maxChars: 6000 } })
    expect(response.isError).not.toBe(true)
    const stale = content(response)
    expect(stale.freshness).toMatchObject({ checked: true, sourceStatus: "stale", actions: { cwd: root, review: "bunx design-rover diff --json", refresh: "bunx design-rover sync --yes" } })
    expect(stale.freshness.sourceChanges).toBeGreaterThan(0)
    expect(stale.warnings.join(" ")).toContain("Saved context is stale")
    const text = (response.content as { type: string; text: string }[]).find((item) => item.type === "text")!.text
    expect(text.length).toBe(stale.limits.outputChars)
    expect(text.length).toBeLessThanOrEqual(6000)
    const complete = content(await client.callTool({ name: "get_context", arguments: { query: "Button", path: "components/ui", maxChars: 18000 } }))
    expect(complete.matches.find((item: { record: { name: string } }) => item.record.name === "Button").record.variants).toContain("ghost")
    expect(await savedFiles(root)).toEqual(persisted)
    expect(await loadCanonical(root)).toEqual(model)
    expect(await fs.readFile(buttonFile, "utf8")).toBe(changed)
  })

  it("reports failed freshness checks as tool errors and keeps snapshot-only retrieval available", async () => {
    const { root, client } = await session()
    await fs.writeFile(path.join(root, "Button.tsx"), "export function Button() { return <button>Save</button> }\n")
    await (await createEngine(root)).init({ generate: false })
    const persisted = await savedFiles(root)
    const cache = path.join(root, ".design-rover/cache")
    await fs.rm(cache, { recursive: true, force: true })
    await fs.writeFile(cache, "Blocked cache directory\n")
    const failure = await client.callTool({ name: "get_context", arguments: { query: "Button" } })
    expect(failure.isError).toBe(true)
    expect(JSON.stringify(failure.content)).toContain("Unable to check context freshness")
    const offline = await client.callTool({ name: "get_context", arguments: { query: "Button", checkFreshness: false } })
    expect(offline.isError).not.toBe(true)
    expect(content(offline).freshness.checked).toBe(false)
    expect(await savedFiles(root)).toEqual(persisted)
  })
})
