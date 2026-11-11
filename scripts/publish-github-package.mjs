import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { pathToFileURL } from "node:url"

const registry = "https://npm.pkg.github.com"
const packageName = "@nisargkavi/design-rover"
const publicFiles = ["package.json", "LICENSE", "README.md", "dist/bin.js", "dist/bin.js.map"]
const requiredFiles = publicFiles.slice(0, 4)
const maximumBytes = 64 * 1024 * 1024

function command(command, args, options = {}) {
  return spawnSync(command, args, { encoding: "utf8", timeout: 60_000, maxBuffer: maximumBytes, ...options })
}

function successful(result, operation) {
  if (result.error || result.status !== 0) throw new Error(`${operation} failed (exit ${result.status ?? "unavailable"}).`)
  return result.stdout
}

function tar(args) {
  return successful(command("tar", args, { encoding: null }), "Reading package archive")
}

/** Read a bounded allowlist into memory; never unpack archive paths onto disk. */
export async function readPublicArchive(filename, { expectedName = "design-rover", version } = {}) {
  const stat = await fs.stat(filename)
  assert(stat.isFile() && stat.size <= maximumBytes, "Package archive is not a bounded regular file")
  const entries = tar(["-tzf", filename]).toString("utf8").trim().split("\n").filter(Boolean)
  const allowed = new Set(publicFiles.map((file) => `package/${file}`))
  const directories = new Set(["package/", "package/dist/"])
  assert.equal(new Set(entries).size, entries.length, "Duplicate package archive paths")
  assert(entries.every((entry) => allowed.has(entry) || directories.has(entry)), "Unexpected package archive path")
  const listing = tar(["-tvzf", filename]).toString("utf8").trim().split("\n").filter(Boolean)
  assert.equal(listing.length, entries.length, "Unsupported archive metadata")
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    const line = listing[index]
    assert(line.endsWith(` ${entry}`) && line.startsWith(directories.has(entry) ? "d" : "-"), "Package archive contains a link or unsupported file type")
  }
  const files = new Map()
  let size = 0
  for (const file of publicFiles) {
    const entry = `package/${file}`
    if (!entries.includes(entry)) continue
    const bytes = tar(["-xOzf", filename, entry])
    size += bytes.length
    assert(size <= maximumBytes, "Expanded package exceeds the supported size")
    files.set(file, bytes)
  }
  assert(requiredFiles.every((file) => files.has(file)), "Package archive is missing required public files")
  const manifest = JSON.parse(files.get("package.json").toString("utf8"))
  assert.equal(manifest.name, expectedName, "Package archive has the wrong name")
  assert.equal(manifest.version, version, "Package archive has the wrong version")
  assert.deepEqual(manifest.bin, { "design-rover": "./dist/bin.js" }, "Package archive has an unexpected CLI entrypoint")
  return { files, manifest }
}

export function scopedManifest(manifest, version) {
  assert.equal(manifest.name, "design-rover", "Expected the primary npm package")
  assert.equal(manifest.version, version, "Mirror version must match the primary package")
  assert.equal(manifest.repository?.url, "https://github.com/nisargkavi/design-rover.git", "Package repository must identify the mirror owner")
  const scoped = {
    ...manifest,
    name: packageName,
    publishConfig: { ...manifest.publishConfig, registry, access: "public", provenance: false },
  }
  delete scoped.devDependencies
  assert(!JSON.stringify(scoped).includes("workspace:"), "Public package must not depend on unpublished workspaces")
  return scoped
}

function errorCode(result) {
  try {
    const code = JSON.parse(result.stdout || result.stderr).error?.code
    return typeof code === "string" && /^[A-Z][A-Z0-9_]*$/.test(code) ? code : undefined
  } catch { return undefined }
}

/** Publish only after the caller has verified this primary npm artifact. */
export async function publishGithubPackage({ tarball, version, token = process.env.GH_PACKAGES_TOKEN ?? process.env.NODE_AUTH_TOKEN, runCommand = command }) {
  assert.match(version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, "Expected a release version")
  assert(typeof token === "string" && token.trim(), "A GitHub Packages token is required")
  const primary = await readPublicArchive(path.resolve(tarball), { version })
  const plannedManifest = scopedManifest(primary.manifest, version)
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "design-rover-github-package-"))
  try {
    const staging = path.join(temporary, "package")
    const output = path.join(temporary, "planned")
    const existing = path.join(temporary, "existing")
    await Promise.all([fs.mkdir(staging), fs.mkdir(output), fs.mkdir(existing)])
    for (const [file, bytes] of primary.files) {
      const target = path.join(staging, file)
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.writeFile(target, file === "package.json" ? `${JSON.stringify(plannedManifest, null, 2)}\n` : bytes, { mode: file === "dist/bin.js" ? 0o755 : 0o644 })
    }
    // A literal environment substitution keeps credentials out of staged files.
    const npmrc = path.join(temporary, "auth.npmrc")
    await fs.writeFile(npmrc, '//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}\n', { mode: 0o600 })
    const publicEnvironment = { ...process.env, NODE_AUTH_TOKEN: undefined, GH_PACKAGES_TOKEN: undefined, GITHUB_TOKEN: undefined, NPM_TOKEN: undefined }
    successful(await runCommand("bun", ["pm", "pack", "--ignore-scripts", "--destination", output], { cwd: staging, env: publicEnvironment }), "Packing scoped package")
    const archives = (await fs.readdir(output)).filter((file) => file.endsWith(".tgz"))
    assert.equal(archives.length, 1, "Packing must produce exactly one scoped archive")
    const plannedPath = path.join(output, archives[0])
    const planned = await readPublicArchive(plannedPath, { expectedName: packageName, version })
    const npmOptions = { cwd: temporary, env: { ...publicEnvironment, NODE_AUTH_TOKEN: token, NPM_CONFIG_USERCONFIG: npmrc } }
    const identity = `${packageName}@${version}`
    const viewed = await runCommand("npm", ["view", identity, "--json", "--registry", registry], npmOptions)
    if (viewed.error || viewed.status !== 0) {
      const code = errorCode(viewed)
      if (viewed.error || code !== "E404") throw new Error(`Cannot check GitHub Packages version (exit ${viewed.status ?? "unavailable"}${code ? `; ${code}` : ""}).`)
    } else {
      const metadata = JSON.parse(viewed.stdout)
      assert.equal(metadata.name, packageName, "GitHub Packages returned the wrong package")
      assert.equal(metadata.version, version, "GitHub Packages returned the wrong version")
      const packed = JSON.parse(successful(await runCommand("npm", ["pack", identity, "--ignore-scripts", "--json", "--registry", registry, "--pack-destination", existing], npmOptions), "Downloading existing scoped package"))
      assert(Array.isArray(packed) && packed.length === 1, "Expected one existing scoped package")
      const filename = packed[0]?.filename
      assert(typeof filename === "string" && filename.endsWith(".tgz") && path.basename(filename) === filename && !filename.includes("\\"), "Unexpected downloaded archive filename")
      const published = await readPublicArchive(path.join(existing, filename), { expectedName: packageName, version })
      assert.deepEqual([...published.files.keys()], [...planned.files.keys()], "Existing GitHub package has different public files")
      for (const [file, bytes] of planned.files) assert(bytes.equals(published.files.get(file)), `Existing GitHub package content differs: ${file}`)
      return { name: packageName, version, published: false, verifiedExisting: true }
    }
    successful(await runCommand("npm", ["publish", plannedPath, "--registry", registry, "--access", "public", "--ignore-scripts", "--tag", "latest"], npmOptions), "Publishing scoped package")
    return { name: packageName, version, published: true, verifiedExisting: false }
  } finally {
    await fs.rm(temporary, { recursive: true, force: true })
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.length !== 4) throw new Error("Usage: node scripts/publish-github-package.mjs <verified-npm.tgz> <version>")
  console.log(JSON.stringify(await publishGithubPackage({ tarball: process.argv[2], version: process.argv[3] })))
}
