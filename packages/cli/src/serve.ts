import http from "node:http"
import { randomBytes } from "node:crypto"
import { createEngine, loadCanonical } from "@design-rover/core"
import { PRODUCT_NAME } from "@design-rover/model"

export async function serveStudio(root: string, port: number, openBrowser: boolean) {
  const engine = await createEngine(root)
  const server = http.createServer(async (req, res) => {
    const address = server.address()
    const actualPort = typeof address === "object" && address ? address.port : port
    const allowedHosts = [`127.0.0.1:${actualPort}`, `localhost:${actualPort}`]
    const allowedOrigins = allowedHosts.map((host) => `http://${host}`)
    if (!allowedHosts.includes(req.headers.host ?? "") || (req.headers.origin !== undefined && !allowedOrigins.includes(req.headers.origin))) {
      res.writeHead(403)
      res.end("forbidden origin")
      return
    }
    res.setHeader("Cache-Control", "no-store")
    res.setHeader("X-Content-Type-Options", "nosniff")
    if (req.method !== "GET") {
      res.writeHead(405, { Allow: "GET" })
      res.end("method not allowed")
      return
    }
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${actualPort}`)
    try {
      if (url.pathname === "/api/snapshot") {
        const model = await loadCanonical(root)
        json(res, model ?? { error: "uninitialized" })
        return
      }
      if (url.pathname === "/api/status") {
        json(res, await engine.status())
        return
      }
      if (url.pathname === "/api/diff") {
        const preview = await engine.syncPreview({ incremental: true })
        json(res, preview.diff)
        return
      }
      if (url.pathname === "/api/check") {
        const result = await engine.check()
        json(res, result.report)
        return
      }
      if (url.pathname === "/api/history") {
        json(res, await engine.history())
        return
      }
      if (url.pathname === "/" || url.pathname === "/index.html") {
        const nonce = randomBytes(18).toString("base64")
        res.setHeader("Content-Security-Policy", `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'`)
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
        res.end(studioHtml(nonce))
        return
      }
      res.writeHead(404)
      res.end("not found")
    } catch (error) {
      res.writeHead(500, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
    }
  })
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(port, "127.0.0.1", () => { server.off("error", reject); resolve() })
  })
  const address = server.address()
  const href = `http://127.0.0.1:${typeof address === "object" && address ? address.port : port}`
  process.stdout.write(`${PRODUCT_NAME} Studio  ${href}\nThe repository's design model remains canonical.\n`)
  if (openBrowser) {
    const { spawn } = await import("node:child_process")
    const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open"
    spawn(cmd, [href], { stdio: "ignore", detached: true }).unref()
  }
  return server
}

function json(res: http.ServerResponse, value: unknown) {
  res.writeHead(200, { "Content-Type": "application/json" })
  res.end(`${JSON.stringify(value, null, 2)}\n`)
}

export function studioHtml(nonce: string): string {
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${PRODUCT_NAME}</title>
<style nonce="${nonce}">
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: "IBM Plex Sans", ui-sans-serif, system-ui, sans-serif; background: #141210; color: #ece7e1; }
  header { padding: 28px 32px 16px; border-bottom: 1px solid #2a2622; }
  header p { margin: 6px 0 0; color: #8a8278; font-size: 13px; }
  h1 { font-family: "IBM Plex Mono", ui-monospace, monospace; font-size: 13px; letter-spacing: 0.18em; text-transform: uppercase; font-weight: 500; margin: 0; color: #e8a54b; }
  main { display: grid; grid-template-columns: 220px 1fr; min-height: calc(100vh - 90px); }
  nav { padding: 20px; border-right: 1px solid #2a2622; }
  nav button { display: block; width: 100%; text-align: left; background: none; border: 0; color: #8a8278; padding: 8px 0; font: inherit; cursor: pointer; }
  nav button.active { color: #ece7e1; }
  section { padding: 28px 32px 64px; }
  .item { border-bottom: 1px solid #2a2622; padding: 16px 0; }
  .item h3 { margin: 0 0 6px; font-size: 16px; font-weight: 560; }
  .meta { font-family: "IBM Plex Mono", ui-monospace, monospace; font-size: 12px; color: #8a8278; }
  pre { white-space: pre-wrap; font-family: "IBM Plex Mono", ui-monospace, monospace; font-size: 12px; color: #cfc6bb; }
</style>
<header>
  <h1>${PRODUCT_NAME}</h1>
  <p>Your code is the source. Explore its recorded design knowledge.</p>
</header>
<main>
  <nav id="nav"></nav>
  <section id="view">Loading…</section>
</main>
<script nonce="${nonce}">
  const api = (p) => fetch(p).then(r => { if (!r.ok) throw new Error('Request failed: ' + r.status); return r.json() })
  const kinds = ["components","tokens","patterns","conventions","intents","exceptions","history"]
  let snap = null
  let current = "components"
  function element(tag, value, className) {
    const node = document.createElement(tag)
    if (value !== undefined) node.textContent = String(value)
    if (className) node.className = className
    return node
  }
  function showItems(view, items, history) {
    view.replaceChildren()
    for (const item of items) {
      const row = element('div', undefined, 'item')
      row.append(element('h3', history ? item.summary : (item.name || item.subject || item.id)))
      row.append(element('div', history ? item.ts : [item.source || item.origin || item.status || '', item.importPath || ''].join(' '), 'meta'))
      if (!history) row.append(element('pre', item.guidance || item.inference || item.reason || (item.variants || []).join(', ') || item.value || ''))
      view.append(row)
    }
    if (!items.length) view.append(element('p', history ? 'No history.' : 'Nothing recorded.'))
  }
  function render() {
    const nav = document.getElementById('nav')
    nav.replaceChildren()
    for (const kind of kinds) {
      const button = element('button', kind, kind === current ? 'active' : '')
      button.onclick = () => { current = kind; render() }
      nav.append(button)
    }
    const view = document.getElementById("view")
    if (current === "history") {
      api("/api/history").then(h => {
        if (current === 'history') showItems(view, h.events || [], true)
      }).catch(error => { view.textContent = error.message })
      return
    }
    const items = (snap && snap[current]) || []
    showItems(view, items, false)
  }
  api("/api/snapshot").then(s => { snap = s; render() }).catch(error => { document.getElementById('view').textContent = error.message })
</script>
</html>`
}
