import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { pathToFileURL } from "node:url"
import { createRequire } from "node:module"

const project = process.cwd()
const manifest = JSON.parse(await fs.readFile(path.join(project, "packages/cli/package.json"), "utf8"))
const version = manifest.version
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "design-rover-package-"))

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8", timeout: 90_000,
    env: { ...process.env, BUN_INSTALL_CACHE_DIR: path.join(temporary, "bun-cache") },
    ...options,
  })
  if (result.error) throw result.error
  assert.equal(result.status, options.expectedStatus ?? 0, `${command} ${args.join(" ")}\n${result.stdout}\n${result.stderr}`)
  return result.stdout
}

try {
  // Install the unpublished release artifact in an isolated Bun project.
  const primaryTarball = `file:${path.resolve(process.argv[2] ?? path.join(project, `design-rover-${version}.tgz`))}`
  await fs.writeFile(path.join(temporary, "package.json"), JSON.stringify({
    private: true,
    dependencies: {
      "design-rover": primaryTarball,
    },
  }))
  run("bun", ["install", "--ignore-scripts", "--no-progress"], { cwd: temporary })
  const cli = path.join(temporary, "node_modules/design-rover/dist/bin.js")
  const fixture = path.join(temporary, "fixture")
  await fs.cp(path.join(project, "fixtures/next-tailwind"), fixture, { recursive: true, filter: (file) => !file.includes("node_modules") && !file.includes(".design-rover") })
  const call = (entry, args, expectedStatus = 0) => run(process.execPath, [entry, ...args, "--cwd", fixture], { expectedStatus })
  const json = (args, expectedStatus = 0, entry = cli) => JSON.parse(call(entry, [...args, "--json"], expectedStatus))

  assert.equal(call(cli, ["--version"]).trim(), version)
  assert.equal(run("bun", ["run", "design-rover", "--version"], { cwd: temporary }).trim(), version)
  const installed = JSON.parse(await fs.readFile(path.join(temporary, "node_modules/design-rover/package.json"), "utf8"))
  assert.deepEqual(installed.bin, { "design-rover": "./dist/bin.js" })
  assert.equal(installed.devDependencies, undefined, "Published manifests must omit development-only workspaces")
  assert.equal(JSON.stringify(installed).includes("workspace:"), false)
  const initialized = JSON.parse(run("bunx", ["--no-install", "design-rover", "init", "--approve", "--generate", "--cwd", fixture, "--json"], { cwd: temporary }))
  assert.equal(initialized.pending, 0)
  const status = json(["status"])
  assert.equal(status.syncStatus, "synchronized")
  assert.deepEqual(status.staleGenerated, [])
  assert.equal(json(["check"]).preservedArchitecture, true)
  const contextOutput = call(cli, ["context", "Button", "--path", "app/dashboard/page.tsx", "--max-chars", "18000", "--json"])
  const context = JSON.parse(contextOutput)
  assert.ok(contextOutput.length <= 18000)
  assert.equal(context.limits.outputChars, contextOutput.length)
  assert.equal(context.freshness.checked, true)
  assert.equal(context.freshness.sourceStatus, "current")
  assert.equal(json(["context", "Button", "--no-check-freshness"]).freshness.checked, false)
  assert.ok(context.matches.some((item) => item.kind === "component" && item.record.name === "Button"))
  assert.match(json(["context", "--path", "../outside"], 1).error, /cannot leave/)
  assert.equal(json(["ci", "--fail-on", "warning"], 1).ok, false)
  assert.equal(json(["ci", "--fail-on", "none"]).ok, true)
  assert.match(json(["ci", "--fail-on", "typo"], 1).error, /fail-on/)
  json(["baseline"])
  const baseline = await fs.readFile(path.join(fixture, ".design-rover/baseline.json"), "utf8")
  json(["init", "--generate"])
  assert.equal(await fs.readFile(path.join(fixture, ".design-rover/baseline.json"), "utf8"), baseline)
  assert.deepEqual(json(["status"]).staleGenerated, [])

  const require = createRequire(cli)
  const { Client } = await import(pathToFileURL(require.resolve("@modelcontextprotocol/sdk/client/index.js")).href)
  const { StdioClientTransport } = await import(pathToFileURL(require.resolve("@modelcontextprotocol/sdk/client/stdio.js")).href)
  const client = new Client({ name: "packaged-cli-smoke", version: "1.0.0" })
  const transport = new StdioClientTransport({ command: process.execPath, args: [cli, "mcp", "--cwd", fixture] })
  try {
    await client.connect(transport)
    assert.equal((await client.listTools()).tools.length, 10)
    const response = await client.callTool({ name: "get_system", arguments: {} })
    assert.notEqual(response.isError, true)
    const scoped = await client.callTool({ name: "get_context", arguments: { query: "Button", path: "app/dashboard/page.tsx", maxChars: 6000 } })
    assert.notEqual(scoped.isError, true)
    const scopedText = scoped.content.find((item) => item.type === "text").text
    assert.ok(scopedText.length <= 6000)
    assert.equal(JSON.parse(scopedText).limits.outputChars, scopedText.length)
    assert.equal(JSON.parse(scopedText).scope.path, "app/dashboard/page.tsx")
    assert.equal(JSON.parse(scopedText).freshness.checked, true)
    assert.equal(JSON.parse(scopedText).freshness.sourceStatus, "current")

    const systemFile = path.join(fixture, ".design-rover/system.json")
    const historyFile = path.join(fixture, ".design-rover/history/events.jsonl")
    const systemBefore = await fs.readFile(systemFile, "utf8")
    const historyBefore = await fs.readFile(historyFile, "utf8")
    await fs.writeFile(path.join(fixture, "components/ui/FreshnessBadge.tsx"), "export function FreshnessBadge() { return <span>Fresh</span> }\n")
    const staleResponse = await client.callTool({ name: "get_context", arguments: { query: "FreshnessBadge", maxChars: 6000 } })
    assert.notEqual(staleResponse.isError, true)
    const stale = JSON.parse(staleResponse.content.find((item) => item.type === "text").text)
    assert.equal(stale.freshness.sourceStatus, "stale")
    assert.equal(stale.freshness.actions.cwd, fixture)
    assert.equal(stale.freshness.actions.refresh, "bunx design-rover sync --yes")
    assert.equal(stale.matches.some((item) => item.record.name === "FreshnessBadge"), false)
    assert.equal(await fs.readFile(systemFile, "utf8"), systemBefore)
    assert.equal(await fs.readFile(historyFile, "utf8"), historyBefore)
    const [refreshCommand, ...refreshArgs] = stale.freshness.actions.refresh.split(" ")
    run(refreshCommand, refreshArgs, { cwd: stale.freshness.actions.cwd })
    const refreshedResponse = await client.callTool({ name: "get_context", arguments: { query: "FreshnessBadge", maxChars: 6000 } })
    assert.notEqual(refreshedResponse.isError, true)
    const refreshed = JSON.parse(refreshedResponse.content.find((item) => item.type === "text").text)
    assert.equal(refreshed.freshness.sourceStatus, "current")
    assert.ok(refreshed.matches.some((item) => item.record.name === "FreshnessBadge" && item.record.status === "observed"))
  } finally { await client.close() }
  console.log(`Packaged CLI ${version}: fresh-project bunx init, public manifest, generate/check, bounded freshness-aware context, explicit refresh, JSON gates, baseline preservation and stdio MCP passed.`)
} finally {
  await fs.rm(temporary, { recursive: true, force: true })
}
