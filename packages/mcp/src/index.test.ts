import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { emptyCanonical, saveCanonical } from "@design-rover/core"
import type { ComponentRecord, PatternRecord } from "@design-rover/model"
import { createMcpServer } from "./index.ts"

const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

async function session() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "design-rover-mcp-"))
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
    const response = await client.callTool({ name: "get_context", arguments: { query: "Button", path: "apps/admin", maxChars: 5000 } })
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
})
