import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import vm from "node:vm"
import { afterEach, describe, expect, it } from "vitest"
import { emptyCanonical } from "@design-rover/core"
import { createHostedApp } from "../apps/server/src/index.ts"
import { serveStudio, studioHtml } from "../packages/cli/src/serve.ts"

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))) })

describe("hosted private model access", () => {
  it("requires explicit authentication configuration", () => {
    expect(() => createHostedApp({ token: "" })).toThrow("DESIGN_ROVER_TOKEN")
  })

  it("protects every private read and write and does not expose an arbitrary snapshot", async () => {
    const app = createHostedApp({ token: "secret" })
    const route = "/v1/orgs/private/repos/ui"
    const model = emptyCanonical("/private/repo", "private-ui")
    const auth = { authorization: "Bearer secret", "content-type": "application/json" }
    expect((await app.request(`${route}/snapshots`, { method: "POST", headers: auth, body: JSON.stringify(model) })).status).toBe(200)
    expect((await app.request(`${route}/policy`, { method: "PUT", headers: auth, body: JSON.stringify({ private: true }) })).status).toBe(200)
    for (const [url, method] of [[`${route}/snapshot`, "GET"], [`${route}/policy`, "GET"], [`${route}/policy`, "PUT"], [`${route}/snapshots`, "POST"], ["/v1/snapshot", "GET"]]) {
      const result = await app.request(url!, { method })
      expect(result.status).toBe(401)
      expect(await result.text()).not.toContain("private-ui")
    }
    expect((await app.request("/v1/snapshot", { headers: auth })).status).toBe(404)
    expect((await app.request("/v1/orgs/other/repos/ui/snapshot", { headers: auth })).status).toBe(404)
    expect((await app.request(`${route}/snapshot`, { headers: auth })).status).toBe(200)
    expect((await app.request(`${route}/snapshots`, { method: "POST", headers: auth, body: "{}" })).status).toBe(400)
    expect((await app.request(`${route}/policy`, { method: "PUT", headers: auth, body: "[]" })).status).toBe(400)
    expect((await app.request("/health")).status).toBe(200)
  })
})

describe("local Studio boundaries", () => {
  it("rejects cross-origin API reads and includes a nonce-based content policy", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "design-rover-studio-"))
    roots.push(root)
    const server = await serveStudio(root, 0, false)
    try {
      const address = server.address()
      if (!address || typeof address === "string") throw new Error("missing server address")
      const url = `http://127.0.0.1:${address.port}`
      const blocked = await fetch(`${url}/api/snapshot`, { headers: { origin: "https://untrusted.example" } })
      expect(blocked.status).toBe(403)
      expect(blocked.headers.get("access-control-allow-origin")).toBeNull()
      expect((await fetch(`${url}/api/snapshot`, { headers: { origin: url } })).status).toBe(200)
      const response = await fetch(url)
      const policy = response.headers.get("content-security-policy")
      const html = await response.text()
      expect(policy).toContain("connect-src 'self'")
      const nonce = html.match(/<script nonce="([^"]+)"/)?.[1]
      expect(nonce).toBeTruthy()
      expect(policy).toContain(`'nonce-${nonce}'`)
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    }
  })

  it("renders model and history payloads as text rather than executable markup", async () => {
    const payload = '<img src=x onerror="globalThis.exploited=true">'
    class Element {
      children: Element[] = []
      textContent = ""
      className = ""
      onclick?: () => void
      append(...items: Element[]) { this.children.push(...items) }
      replaceChildren(...items: Element[]) { this.children = items }
      set innerHTML(_value: string) { throw new Error("unsafe markup rendering") }
    }
    const nav = new Element()
    const view = new Element()
    const document = { createElement: () => new Element(), getElementById: (id: string) => id === "nav" ? nav : view }
    const script = studioHtml("test-nonce").match(/<script nonce="test-nonce">([\s\S]*?)<\/script>/)?.[1]
    expect(script).toBeTruthy()
    const context = vm.createContext({ document, fetch: async () => ({ ok: true, json: async () => ({ components: [{ name: payload, guidance: payload }] }) }) })
    vm.runInContext(script!, context)
    await new Promise((resolve) => setImmediate(resolve))
    const text = view.children.flatMap((row) => row.children.map((child) => child.textContent))
    expect(text).toContain(payload)
    expect(context.exploited).toBeUndefined()
  })
})
