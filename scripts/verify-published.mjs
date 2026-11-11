import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
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

try {
  const freshFiles = new Map([
    ["package.json", `${JSON.stringify({ name: "fresh-react-project", private: true, type: "module", dependencies: { react: "^19.0.0" }, devDependencies: { typescript: "^5.9.0" } }, null, 2)}\n`],
    ["src/components/ui/types/props.ts", 'export interface ButtonProps { children?: string; tone: "primary" | "quiet" }\n'],
    ["src/components/ui/types/index.ts", 'export type { ButtonProps as UiButtonProps } from "./props"\n'],
    ["src/components/ui/Button.tsx", 'import type { UiButtonProps } from "./types"\nexport function Button({ children }: UiButtonProps) {\n  return <button>{children}</button>\n}\n'],
    ["src/components/ui/index.ts", 'export { Button as ActionButton } from "./Button"\n'],
    ["src/App.tsx", 'import { ActionButton as Button } from "./components/ui"\nexport function App() { return <Button tone="primary">Save</Button> }\n'],
    ["src/theme.css", ":root { --color-primary: #123456; }\n.dark { --color-primary: #abcdef; }\n"],
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
  assert.equal(context.freshness.checked, false)
  assert.ok(context.matches.some((match) => match.kind === "component" && match.record.id === button.id), "Published path retrieval missed the component used through a barrel")
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
    scopedPrimaryTokens: primary.length,
    commands: ["bunx design-rover init", "bunx design-rover --version", "bunx design-rover status --json", "bunx design-rover check --json", "bunx design-rover context Button --path src/App.tsx --max-chars 8000 --json"],
    projectDependencyInstalled: false,
    sourcePreserved: true,
  }, null, 2))
} finally {
  await fs.rm(temporary, { recursive: true, force: true })
}
