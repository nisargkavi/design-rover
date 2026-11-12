import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { spawn, spawnSync } from "node:child_process"
import { EventEmitter } from "node:events"
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

function startWatch(cli, cwd) {
  const child = spawn(process.execPath, [cli, "watch", "--cwd", cwd, "--interval", "100", "--debounce", "100", "--json"], { stdio: ["ignore", "pipe", "pipe"] })
  const changes = new EventEmitter()
  const events = []
  let pending = ""
  let stderr = ""
  let failure
  let ended = false
  child.stdout.on("data", (chunk) => {
    pending += String(chunk)
    while (pending.includes("\n")) {
      const boundary = pending.indexOf("\n")
      const line = pending.slice(0, boundary)
      pending = pending.slice(boundary + 1)
      if (line.trim()) {
        try { events.push(JSON.parse(line)) } catch { failure = new Error(`Watch output was not NDJSON: ${line}`) }
        changes.emit("change")
      }
    }
  })
  child.stderr.on("data", (chunk) => { stderr += String(chunk) })
  const exit = new Promise((resolve, reject) => {
    child.once("error", reject)
    child.once("close", (code, signal) => { ended = true; changes.emit("change"); resolve({ code, signal }) })
  })
  const wait = (type, after = 0) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error(`Watch did not emit ${type}: ${JSON.stringify(events)}\n${stderr}`)) }, 15000)
    const cleanup = () => { clearTimeout(timer); changes.off("change", check) }
    const check = () => {
      const event = events.slice(after).find((item) => item.type === type && (type !== "updated" || item.applied > 0))
      if (failure) { cleanup(); reject(failure) }
      else if (event) { cleanup(); resolve(event) }
      else if (ended || events.slice(after).some((item) => item.type === "error")) { cleanup(); reject(new Error(`Watch stopped or failed before ${type}: ${JSON.stringify(events)}\n${stderr}`)) }
    }
    changes.on("change", check)
    check()
  })
  const stop = async () => {
    if (!ended) child.kill("SIGINT")
    const killer = setTimeout(() => { if (!ended) child.kill("SIGKILL") }, 3000)
    try { return await exit } finally { clearTimeout(killer) }
  }
  return { events, wait, stop }
}

async function readRecords(root, kind) {
  const directory = path.join(root, ".design-rover", kind)
  const files = (await fs.readdir(directory)).filter((file) => file.endsWith(".json")).sort()
  return Promise.all(files.map(async (file) => JSON.parse(await fs.readFile(path.join(directory, file), "utf8"))))
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

  // Execute the installed artifact with this matrix job's Node runtime.
  const watchRoot = path.join(temporary, "watch project")
  await fs.mkdir(watchRoot)
  const buttonSource = 'export function WatchButton({ label }: { label: string }) { return <button className="px-4">{label}</button> }\n'
  await fs.writeFile(path.join(watchRoot, "package.json"), JSON.stringify({ private: true, dependencies: { react: "19.0.0", tailwindcss: "4.0.0" } }))
  await fs.writeFile(path.join(watchRoot, "WatchButton.tsx"), buttonSource)
  const watchJson = (args) => JSON.parse(run(process.execPath, [cli, ...args, "--cwd", watchRoot, "--json"]))
  watchJson(["init"])
  const observedButton = (await readRecords(watchRoot, "components")).find((record) => record.name === "WatchButton")
  watchJson(["approve", observedButton.id])
  const approvedButton = (await readRecords(watchRoot, "components")).find((record) => record.name === "WatchButton")
  assert.equal(approvedButton.status, "approved")
  const pendingConventions = await readRecords(watchRoot, "conventions")
  assert.ok(pendingConventions.some((record) => record.status === "inferred"))
  const watching = startWatch(cli, watchRoot)
  try {
    await watching.wait("ready")
    let after = watching.events.length
    const changedButton = buttonSource.replace("label: string", "label: string; disabled?: boolean")
    await fs.writeFile(path.join(watchRoot, "WatchButton.tsx"), changedButton)
    await fs.writeFile(path.join(watchRoot, "LiveBadge.tsx"), "export function LiveBadge() { return <span>Live</span> }\n")
    const updated = await watching.wait("updated", after)
    assert.ok(updated.pendingChanges > 0, "Approved API drift must remain pending")
    assert.equal(updated.actions.review, "bunx design-rover diff --json")
    let live = watchJson(["context", "LiveBadge", "--no-check-freshness"])
    assert.ok(live.matches.some((match) => match.record.name === "LiveBadge" && match.record.status === "observed"))
    after = watching.events.length
    await fs.writeFile(path.join(watchRoot, "LiveBadge.tsx"), "export function LiveBadge({ label }: { label: string }) { return <span>{label}</span> }\n")
    await watching.wait("updated", after)
    live = watchJson(["context", "LiveBadge", "--no-check-freshness"])
    assert.ok(live.matches.some((match) => match.record.name === "LiveBadge" && match.record.props.some((prop) => prop.name === "label")))
    assert.deepEqual((await readRecords(watchRoot, "components")).find((record) => record.name === "WatchButton"), approvedButton)
    assert.deepEqual(await readRecords(watchRoot, "conventions"), pendingConventions)
    assert.equal(await fs.readFile(path.join(watchRoot, "WatchButton.tsx"), "utf8"), changedButton)
  } finally {
    assert.deepEqual(await watching.stop(), { code: 0, signal: null })
  }
  assert.equal(watching.events.at(-1).type, "stopped")
  console.log(`Packaged CLI ${version}: fresh-project bunx init, public manifest, generate/check, bounded freshness-aware context, explicit refresh, JSON gates, baseline preservation, stdio MCP and live watch with explicit approvals passed.`)
} finally {
  await fs.rm(temporary, { recursive: true, force: true })
}
