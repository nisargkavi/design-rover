import { createEngine, explain, loadCanonical, retrieveContext, serializeContext } from "@design-rover/core"
import { CLI_PACKAGE, CLI_VERSION, type CanonicalModel } from "@design-rover/model"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"

export async function createMcpServer(root: string) {
  const engine = await createEngine(root)
  const server = new McpServer({
    name: CLI_PACKAGE,
    version: CLI_VERSION,
  })

  const requireModel = async () => {
    const model = await loadCanonical(root)
    if (!model) throw new Error("Design Rover is not initialized. Run `design-rover init`.")
    return model
  }

  server.tool(
    "get_system",
    "Analyze repository freshness and return the canonical Design Rover system summary.",
    {},
    async () => {
      const model = await requireModel()
      const status = await engine.status()
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ status, system: model?.system }, null, 2),
          },
        ],
      }
    },
  )

  server.tool(
    "get_component",
    "Get an approved or observed component by ID or unambiguous name. Use source to disambiguate duplicate names.",
    { name: z.string(), source: z.string().optional() },
    async ({ name, source }) => {
      const model = await requireModel()
      const components = model.components.filter(
        (item) => trusted(item) && (item.name.toLowerCase() === name.toLowerCase() || item.exportName.toLowerCase() === name.toLowerCase() || item.id.toLowerCase() === name.toLowerCase()) && (!source || item.source === source),
      )
      return {
        content: [{ type: "text", text: JSON.stringify(components.length === 1 ? components[0] : components.length ? { error: "ambiguous component", choices: components.map(({ id, source, importPath }) => ({ id, source, importPath })) } : { error: "not found" }, null, 2) }],
      }
    },
  )

  server.tool(
    "get_pattern",
    "Get an approved or observed UI pattern. Patterns are not extraction tasks.",
    { name: z.string() },
    async ({ name }) => {
      const model = await requireModel()
      const patterns = model.patterns.filter(
        (item) => trusted(item) && (item.name.toLowerCase() === name.toLowerCase() || item.id.toLowerCase() === name.toLowerCase()),
      )
      return {
        content: [{ type: "text", text: JSON.stringify(patterns.length === 1 ? patterns[0] : patterns.length ? { error: "ambiguous pattern", choices: patterns.map(({ id, name }) => ({ id, name })) } : { error: "not found" }, null, 2) }],
      }
    },
  )

  server.tool(
    "get_conventions",
    "Return approved/observed repository conventions. Include pending inferences only when explicitly reviewing them.",
    { includePending: z.boolean().optional() },
    async ({ includePending }) => {
      const model = await requireModel()
      return {
        content: [{ type: "text", text: JSON.stringify(model.conventions.filter((item) => visible(item, includePending)), null, 2) }],
      }
    },
  )

  server.tool(
    "get_intents",
    "Return approved/observed design intents; include pending suggestions only for explicit review.",
    { includePending: z.boolean().optional() },
    async ({ includePending }) => {
      const model = await requireModel()
      return {
        content: [{ type: "text", text: JSON.stringify(model.intents.filter((item) => visible(item, includePending)), null, 2) }],
      }
    },
  )

  server.tool(
    "get_exceptions",
    "Return approved exceptions; include pending suggestions only for explicit review.",
    { includePending: z.boolean().optional() },
    async ({ includePending }) => {
      const model = await requireModel()
      return {
        content: [{ type: "text", text: JSON.stringify(model.exceptions.filter((item) => item.status === "approved" || (includePending && (item.status === "suggested" || item.status === "inferred"))), null, 2) }],
      }
    },
  )

  server.tool(
    "search_system",
    "Search approved/observed design knowledge. Include pending suggestions only for explicit review.",
    { query: z.string(), includePending: z.boolean().optional() },
    async ({ query, includePending }) => {
      await requireModel()
      const result = await engine.search(query)
      const filtered = Object.fromEntries(Object.entries(result ?? {}).map(([kind, records]) => [kind, records.filter((item) => visible(item, includePending))]))
      return {
        content: [{ type: "text", text: JSON.stringify(filtered, null, 2) }],
      }
    },
  )

  server.tool(
    "check_code",
    "Check a code snippet against the canonical system without rewriting it.",
    { code: z.string(), fileName: z.string().default("snippet.tsx") },
    async ({ code, fileName }) => {
      await requireModel()
      const diagnostics = await engine.checkSnippet(code, fileName)
      return {
        content: [{ type: "text", text: JSON.stringify(diagnostics, null, 2) }],
      }
    },
  )

  server.registerTool(
    "get_context",
    {
      description: "Retrieve bounded canonical design context for a task/query and/or repository-relative path. Whole records are ranked deterministically; inspect coverage and omission warnings before relying on it. Does not scan source or check freshness.",
      inputSchema: {
        query: z.string().max(512).optional(),
        path: z.string().max(512).optional(),
        includePending: z.boolean().optional(),
        limit: z.number().int().min(1).max(100).optional(),
        maxChars: z.number().int().min(1024).max(100000).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async (options) => {
      const model = await requireModel()
      const packet = retrieveContext(model, options)
      return { content: [{ type: "text", text: serializeContext(packet) }] }
    },
  )

  server.tool(
    "explain_violation",
    "Explain a component, pattern, convention, or diagnostic in context.",
    { query: z.string() },
    async ({ query }) => {
      const model = await requireModel()
      const text = explain(approvedModel(model), query)
      return { content: [{ type: "text", text }] }
    },
  )

  return server
}

function trusted(item: { status: string }): boolean {
  return item.status === "approved" || item.status === "observed"
}

function visible(item: { status: string }, includePending?: boolean): boolean {
  return trusted(item) || Boolean(includePending && (item.status === "inferred" || item.status === "suggested"))
}

function approvedModel(model: CanonicalModel): CanonicalModel {
  return {
    ...model,
    components: model.components.filter(trusted), tokens: model.tokens.filter(trusted), patterns: model.patterns.filter(trusted),
    conventions: model.conventions.filter(trusted), intents: model.intents.filter(trusted), exceptions: model.exceptions.filter((item) => item.status === "approved"),
  }
}

export async function startMcp(root: string) {
  const server = await createMcpServer(root)
  await server.connect(new StdioServerTransport())
  return server
}

export { startMcp as default }
