import { serve } from "@hono/node-server"
import { Hono } from "hono"
import { timingSafeEqual } from "node:crypto"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { CanonicalModelSchema, PRODUCT_NAME, type CanonicalModel } from "@design-rover/model"

type Snapshot = { org: string; repo: string; model: CanonicalModel; uploadedAt: string }

/** Local repository knowledge remains authoritative; hosted storage is ephemeral. */
export function createHostedApp(options: { token: string }) {
  if (!options.token.trim()) throw new Error("Set DESIGN_ROVER_TOKEN before starting the hosted server.")
  const expected = Buffer.from(`Bearer ${options.token}`)
  const snapshots = new Map<string, Snapshot>()
  const policies = new Map<string, Record<string, unknown>>()
  const key = (org: string, repo: string) => JSON.stringify([org, repo])
  const app = new Hono()

  app.get("/health", (c) => c.json({ ok: true, canonical: "repository", persistence: "memory" }))
  app.use("/v1/*", async (c, next) => {
    const supplied = Buffer.from(c.req.header("authorization") ?? "")
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return c.json({ error: "unauthorized" }, 401)
    c.header("Cache-Control", "no-store")
    await next()
  })

  app.post("/v1/orgs/:org/repos/:repo/snapshots", async (c) => {
    const parsed = CanonicalModelSchema.safeParse(await c.req.json().catch(() => undefined))
    if (!parsed.success) return c.json({ error: "invalid canonical model", issues: parsed.error.issues }, 400)
    const org = c.req.param("org")
    const repo = c.req.param("repo")
    const record = { org, repo, model: parsed.data, uploadedAt: new Date().toISOString() }
    snapshots.set(key(org, repo), record)
    return c.json({ ok: true, note: "Snapshot stored in memory. The repository remains authoritative.", uploadedAt: record.uploadedAt })
  })

  app.get("/v1/orgs/:org/repos/:repo/snapshot", (c) => {
    const record = snapshots.get(key(c.req.param("org"), c.req.param("repo")))
    if (!record) return c.json({ error: "not found" }, 404)
    return c.json(record)
  })

  // There is deliberately no unscoped /v1/snapshot endpoint selecting an arbitrary tenant.
  app.put("/v1/orgs/:org/repos/:repo/policy", async (c) => {
    const body: unknown = await c.req.json().catch(() => undefined)
    if (!body || typeof body !== "object" || Array.isArray(body)) return c.json({ error: "policy must be a JSON object" }, 400)
    policies.set(key(c.req.param("org"), c.req.param("repo")), body as Record<string, unknown>)
    return c.json({ ok: true })
  })
  app.get("/v1/orgs/:org/repos/:repo/policy", (c) => c.json(policies.get(key(c.req.param("org"), c.req.param("repo"))) ?? {}))
  return app
}

export function startHostedServer(env: NodeJS.ProcessEnv = process.env) {
  const app = createHostedApp({ token: env.DESIGN_ROVER_TOKEN ?? "" })
  const port = Number(env.PORT ?? 4311)
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("PORT must be an integer from 0 to 65535.")
  const server = serve({ fetch: app.fetch, port })
  console.log(`${PRODUCT_NAME} hosted layer on :${port} (ephemeral; repository remains canonical)`)
  return server
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) startHostedServer()
