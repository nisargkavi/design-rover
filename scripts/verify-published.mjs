import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { spawn, spawnSync } from "node:child_process"
import { EventEmitter } from "node:events"
import { fileURLToPath } from "node:url"

const workspace = fileURLToPath(new URL("../", import.meta.url))
const manifest = JSON.parse(await fs.readFile(path.join(workspace, "packages/cli/package.json"), "utf8"))
const registry = "https://registry.npmjs.org"
const response = await fetch(`${registry}/${encodeURIComponent(manifest.name)}/latest`, {
  headers: { accept: "application/json" },
  signal: AbortSignal.timeout(30_000),
})
assert.equal(response.ok, true, `Cannot read the published package: registry returned ${response.status}`)
const published = await response.json()
assert.equal(published.name, manifest.name)
assert.equal(published.version, manifest.version, "The public latest tag must match this release")
assert.ok(published.dist?.integrity?.startsWith("sha512-"), "Registry integrity is missing")
assert.equal(new URL(published.dist.tarball).origin, registry, "Verification must use the public npm tarball")

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "design-rover-registry-"))
const project = path.join(temporary, "fresh-project")
const cache = path.join(temporary, "bun-cache")
const runtimeTemporary = path.join(temporary, "runtime-temp")

const workspacePath = path.resolve(workspace)
const cleanPath = (process.env.PATH ?? "").split(path.delimiter).filter((entry) => {
  if (!entry) return false
  const absolute = path.resolve(entry)
  if (absolute === workspacePath || absolute.startsWith(`${workspacePath}${path.sep}`)) return false
  return !/(?:^|[\\/])node_modules[\\/]\.bin(?:[\\/]|$)/.test(entry)
}).join(path.delimiter)
const environment = {
  ...process.env,
  PATH: cleanPath,
  BUN_INSTALL_CACHE_DIR: cache,
  TMPDIR: runtimeTemporary,
  TMP: runtimeTemporary,
  TEMP: runtimeTemporary,
  npm_config_registry: registry,
  NPM_CONFIG_REGISTRY: registry,
}
for (const key of ["NODE_PATH", "NODE_OPTIONS", "BUN_OPTIONS", "INIT_CWD", "npm_config_local_prefix", "npm_package_json", "NODE_AUTH_TOKEN", "NPM_TOKEN", "BUN_AUTH_TOKEN"]) delete environment[key]

function bunx(args) {
  const result = spawnSync("bunx", [manifest.name, ...args], {
    cwd: project,
    env: environment,
    encoding: "utf8",
    timeout: 120_000,
  })
  if (result.error) throw result.error
  assert.equal(result.status, 0, `bunx ${manifest.name} ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`)
  return result.stdout
}

async function records(kind) {
  const directory = path.join(project, ".design-rover", kind)
  const files = (await fs.readdir(directory)).filter((file) => file.endsWith(".json"))
  return Promise.all(files.map(async (file) => JSON.parse(await fs.readFile(path.join(directory, file), "utf8"))))
}

function startRegistryWatch() {
  // Own the launcher and CLI process as one group so cleanup cannot leave a
  // background Node process behind if bunx delegates execution.
  const grouped = process.platform !== "win32"
  const child = spawn("bunx", [manifest.name, "watch", "--interval", "100", "--debounce", "100", "--json"], { cwd: project, env: environment, detached: grouped, stdio: ["ignore", "pipe", "pipe"] })
  const events = []
  const changes = new EventEmitter()
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
        try { events.push(JSON.parse(line)) } catch { failure = new Error(`Published watch did not emit NDJSON: ${line}`) }
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
    const timer = setTimeout(() => { cleanup(); reject(new Error(`Published watch did not emit ${type}: ${JSON.stringify(events)}\n${stderr}`)) }, 15000)
    const cleanup = () => { clearTimeout(timer); changes.off("change", check) }
    const check = () => {
      const event = events.slice(after).find((item) => item.type === type && (type !== "updated" || item.applied > 0))
      if (failure) { cleanup(); reject(failure) }
      else if (event) { cleanup(); resolve(event) }
      else if (ended || events.slice(after).some((item) => item.type === "error")) { cleanup(); reject(new Error(`Published watch stopped or failed before ${type}: ${JSON.stringify(events)}\n${stderr}`)) }
    }
    changes.on("change", check)
    check()
  })
  const signal = (name) => {
    try {
      if (grouped && child.pid) process.kill(-child.pid, name)
      else child.kill(name)
    } catch (error) { if (error.code !== "ESRCH") throw error }
  }
  const stop = async () => {
    if (!ended) signal("SIGTERM")
    const killer = setTimeout(() => { if (!ended) signal("SIGKILL") }, 3000)
    try { return await exit } finally { clearTimeout(killer) }
  }
  return { events, wait, stop }
}

try {
  const freshFiles = new Map([
    ["package.json", `${JSON.stringify({ name: "fresh-react-project", private: true, type: "module", dependencies: { react: "^19.0.0" }, devDependencies: { typescript: "^5.9.0" } }, null, 2)}\n`],
    ["src/components/ui/types/props.ts", 'export interface ButtonProps { children?: string; tone: "primary" | "quiet" }\n'],
    ["src/components/ui/types/index.ts", 'export type { ButtonProps as UiButtonProps } from "./props"\n'],
    ["src/components/ui/Button.tsx", 'import type { UiButtonProps } from "./types"\nexport function Button({ children }: UiButtonProps) {\n  return <button className="text-text-subtle">{children}</button>\n}\n'],
    ["src/components/ui/index.ts", 'export { Button as ActionButton } from "./Button"\n'],
    ["src/App.tsx", 'import { ActionButton as Button } from "./components/ui"\nexport function App() { return <Button tone="primary">Save</Button> }\n'],
    ["src/theme.css", ":root { --color-primary: #123456; }\n.dark { --color-primary: #abcdef; }\n@theme { --color-text-subtle: #64748b; }\n"],
  ])
  await fs.mkdir(project, { recursive: true })
  await fs.mkdir(runtimeTemporary, { recursive: true })
  for (const [file, content] of freshFiles) {
    await fs.mkdir(path.dirname(path.join(project, file)), { recursive: true })
    await fs.writeFile(path.join(project, file), content)
  }
  const relativeProject = path.relative(workspacePath, project)
  assert.ok(relativeProject === ".." || relativeProject.startsWith(`..${path.sep}`) || path.isAbsolute(relativeProject), "Fresh project must be outside the workspace")
  for (const name of ["node_modules", ".design-rover"]) await assert.rejects(fs.stat(path.join(project, name)), { code: "ENOENT" })

  console.log(`Verifying ${published.name}@${published.version} from ${registry} with an empty Bun cache.`)
  console.log(`$ bunx ${manifest.name} init`)
  // This exact unversioned command is the user-facing registry entrypoint.
  process.stdout.write(bunx(["init"]))
  assert.equal(bunx(["--version"]).trim(), manifest.version)

  const system = JSON.parse(await fs.readFile(path.join(project, ".design-rover/system.json"), "utf8"))
  const components = await records("components")
  const tokens = await records("tokens")
  const button = components.find((item) => item.name === "Button" && item.source === "src/components/ui/Button.tsx")
  assert.ok(button, "The published CLI did not discover the actual Button source")
  assert.equal(button.propsResolution?.status, "resolved", "The published CLI did not resolve imported prop types")
  assert.ok(button.props.some((prop) => prop.name === "tone" && prop.required && prop.values?.includes("quiet")))
  assert.ok(button.usage.some((usage) => usage.file === "src/App.tsx"), "The published CLI did not follow the aliased barrel export")
  assert.ok(button.relatedTokens.includes("--color-text-subtle"), "The published CLI did not connect JSX utilities to Tailwind theme tokens")
  const primary = tokens.filter((item) => item.name === "--color-primary")
  assert.equal(primary.length, 2, "Root and dark declarations must remain distinct")
  assert.ok(primary.some((item) => item.scope === ":root" && item.value === "#123456"))
  assert.ok(primary.some((item) => item.scope === ".dark" && item.mode === "dark" && item.value === "#abcdef"))
  assert.equal(new Set(primary.map((item) => item.id)).size, 2)

  const status = JSON.parse(bunx(["status", "--json"]))
  assert.equal(status.initialized, true)
  assert.ok(status.counts.components >= 1)
  assert.ok(status.counts.tokens >= 2)
  const check = JSON.parse(bunx(["check", "--json"]))
  assert.equal(check.preservedArchitecture, true)
  assert.ok(Array.isArray(check.diagnostics))
  const contextOutput = bunx(["context", "Button", "--path", "src/App.tsx", "--max-chars", "8000", "--json"])
  const context = JSON.parse(contextOutput)
  assert.ok(contextOutput.length <= 8000, "Published context output exceeded its character budget")
  assert.equal(context.limits.outputChars, contextOutput.length)
  assert.equal(context.freshness.checked, true)
  assert.equal(context.freshness.sourceStatus, "current")
  const snapshot = JSON.parse(bunx(["context", "Button", "--no-check-freshness", "--json"]))
  assert.equal(snapshot.freshness.checked, false)
  assert.ok(context.matches.some((match) => match.kind === "component" && match.record.id === button.id), "Published path retrieval missed the component used through a barrel")
  assert.ok(context.matches.some((match) => match.kind === "token" && match.record.name === "--color-text-subtle"))

  const pendingConventions = await records("conventions")
  assert.ok(pendingConventions.some((record) => record.status === "inferred" || record.status === "suggested"))
  const watching = startRegistryWatch()
  try {
    await watching.wait("ready")
    const after = watching.events.length
    await fs.writeFile(path.join(project, "src/LiveRegistryBadge.tsx"), "export function LiveRegistryBadge() { return <span>Live registry badge</span> }\n")
    await watching.wait("updated", after)
    const live = JSON.parse(bunx(["context", "LiveRegistryBadge", "--no-check-freshness", "--json"]))
    assert.ok(live.matches.some((match) => match.record.name === "LiveRegistryBadge" && match.record.status === "observed"), "Published watch did not refresh the saved component map")
    assert.deepEqual(await records("conventions"), pendingConventions, "Published watch changed pending policy decisions")
    const events = (await fs.readFile(path.join(project, ".design-rover/history/events.jsonl"), "utf8")).split("\n").filter(Boolean).map((line) => JSON.parse(line))
    assert.equal(events.some((event) => event.type === "approved"), false, "Published watch implicitly approved knowledge")
    await assert.rejects(fs.stat(path.join(project, "AGENTS.md")), { code: "ENOENT" })
  } finally {
    const stopped = await watching.stop()
    assert.ok(stopped.code === 0 || stopped.signal === "SIGTERM", `Unexpected published watch exit: ${JSON.stringify(stopped)}`)
  }
  assert.equal(watching.events.at(-1).type, "stopped", "Published watch did not shut down gracefully")
  for (const [file, content] of freshFiles) assert.equal(await fs.readFile(path.join(project, file), "utf8"), content, `Source changed: ${file}`)
  await assert.rejects(fs.stat(path.join(project, "node_modules")), { code: "ENOENT" })

  console.log(JSON.stringify({
    verified: true,
    package: published.name,
    version: published.version,
    registry,
    integrity: published.dist.integrity,
    framework: system.framework.name,
    components: components.length,
    importedPropsResolved: true,
    barrelUsageResolved: true,
    boundedPathContextVerified: true,
    liveWatchVerified: true,
    tailwindTokenLinksVerified: true,
    scopedPrimaryTokens: primary.length,
    commands: ["bunx design-rover init", "bunx design-rover --version", "bunx design-rover status --json", "bunx design-rover check --json", "bunx design-rover context Button --path src/App.tsx --max-chars 8000 --json", "bunx design-rover watch --json"],
    projectDependencyInstalled: false,
    sourcePreserved: true,
  }, null, 2))
} finally {
  await fs.rm(temporary, { recursive: true, force: true })
}
