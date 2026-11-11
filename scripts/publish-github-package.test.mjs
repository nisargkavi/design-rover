import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import test from "node:test"
import { publishGithubPackage, readPublicArchive, scopedManifest } from "./publish-github-package.mjs"

const version = "1.2.3"
const name = "@nisargkavi/design-rover"
const manifest = {
  name: "design-rover", version,
  repository: { type: "git", url: "https://github.com/nisargkavi/design-rover.git", directory: "packages/cli" },
  bin: { "design-rover": "./dist/bin.js" },
  dependencies: { typescript: "^5.9.2" },
  scripts: { prepublishOnly: 'throw new Error("Do not execute")' },
}

function tar(args) {
  const result = spawnSync("tar", args, { encoding: "utf8" })
  assert.equal(result.status, 0, result.stderr)
}

async function fixture(t, extra = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "rover-github-mirror-test-"))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const source = path.join(root, "source/package")
  const files = {
    "package.json": JSON.stringify(manifest), "README.md": "Public CLI instructions\n", LICENSE: "MIT\n",
    "dist/bin.js": "#!/usr/bin/env node\nconsole.log('source remains unchanged')\n", "dist/bin.js.map": '{"version":3,"sources":[]}',
    ...extra,
  }
  for (const [relative, bytes] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(source, relative)), { recursive: true })
    await fs.writeFile(path.join(source, relative), bytes)
  }
  const archive = path.join(root, "primary.tgz")
  tar(["-czf", archive, "-C", path.dirname(source), "package"])
  return { root, source, archive }
}

async function packStaged(cwd, output) {
  // Simulate a package manager without running lifecycle hooks or network calls.
  const parent = path.join(output, "layout")
  await fs.mkdir(parent)
  await fs.cp(cwd, path.join(parent, "package"), { recursive: true })
  const archive = path.join(output, "scoped.tgz")
  tar(["-czf", archive, "-C", parent, "package"])
  await fs.rm(parent, { recursive: true })
  return archive
}

function runner({ view = { status: 1, stdout: JSON.stringify({ error: { code: "E404" } }) }, existingMismatch = false } = {}) {
  const calls = []
  let temporary
  let planned
  const runCommand = async (command, args, options) => {
    calls.push({ command, args, options })
    temporary ??= command === "bun" ? path.dirname(options.cwd) : options.cwd
    if (command === "bun") {
      assert.equal(options.env.NODE_AUTH_TOKEN, undefined)
      planned = await packStaged(options.cwd, args.at(-1))
      return { status: 0, stdout: "packed" }
    }
    assert.equal(command, "npm")
    assert.equal(options.env.NODE_AUTH_TOKEN, "fake-test-token")
    const npmrc = options.env.NPM_CONFIG_USERCONFIG
    assert.equal((await fs.stat(npmrc)).mode & 0o777, 0o600)
    assert.equal(await fs.readFile(npmrc, "utf8"), '//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}\n')
    if (args[0] === "view") return view
    if (args[0] === "pack") {
      const destination = args.at(-1)
      const filename = "existing.tgz"
      if (existingMismatch) {
        const layout = path.join(destination, "layout")
        await fs.mkdir(layout)
        await fs.cp(path.join(temporary, "package"), path.join(layout, "package"), { recursive: true })
        await fs.writeFile(path.join(layout, "package/dist/bin.js"), "different source\n")
        tar(["-czf", path.join(destination, filename), "-C", layout, "package"])
      } else await fs.copyFile(planned, path.join(destination, filename))
      return { status: 0, stdout: JSON.stringify([{ filename }]) }
    }
    assert.equal(args[0], "publish")
    return { status: 0, stdout: "published" }
  }
  return { calls, runCommand, get temporary() { return temporary } }
}

test("scoping preserves the CLI entrypoint, repository, dependencies and primary identity", () => {
  const result = scopedManifest(manifest, version)
  assert.equal(result.name, name)
  assert.equal(result.version, version)
  assert.deepEqual(result.repository, manifest.repository)
  assert.deepEqual(result.bin, manifest.bin)
  assert.deepEqual(result.dependencies, manifest.dependencies)
  assert.deepEqual(result.publishConfig, { registry: "https://npm.pkg.github.com", access: "public", provenance: false })
  assert.equal(manifest.name, "design-rover")
  assert.throws(() => scopedManifest({ ...manifest, version: "9.9.9" }, version), /version/)
  assert.throws(() => scopedManifest({ ...manifest, dependencies: { secret: "workspace:*" } }, version), /workspaces/)
})

test("archive reads retain exactly the known public files and source bytes", async (t) => {
  const fixtureData = await fixture(t)
  const result = await readPublicArchive(fixtureData.archive, { version })
  assert.deepEqual([...result.files.keys()], ["package.json", "LICENSE", "README.md", "dist/bin.js", "dist/bin.js.map"])
  assert.deepEqual(result.files.get("dist/bin.js"), await fs.readFile(path.join(fixtureData.source, "dist/bin.js")))
})

test("unknown archive paths and symlink entries are rejected", async (t) => {
  const unknown = await fixture(t, { "unpublished-secret.txt": "never copy this" })
  await assert.rejects(readPublicArchive(unknown.archive, { version }), /Unexpected package archive path/)
  const linked = await fixture(t)
  await fs.rm(path.join(linked.source, "README.md"))
  await fs.symlink("LICENSE", path.join(linked.source, "README.md"))
  tar(["-czf", linked.archive, "-C", path.dirname(linked.source), "package"])
  await assert.rejects(readPublicArchive(linked.archive, { version }), /link or unsupported file type/)
})

test("publishing stages an isolated scope with credential-free files and cleans up", async (t) => {
  const { archive } = await fixture(t)
  const original = await fs.readFile(archive)
  const commands = runner()
  const result = await publishGithubPackage({ tarball: archive, version, token: "fake-test-token", runCommand: commands.runCommand })
  assert.deepEqual(result, { name, version, published: true, verifiedExisting: false })
  assert.deepEqual(commands.calls.map((call) => [call.command, call.args[0]]), [["bun", "pm"], ["npm", "view"], ["npm", "publish"]])
  const publish = commands.calls.at(-1)
  assert.deepEqual(publish.args.slice(2), ["--registry", "https://npm.pkg.github.com", "--access", "public", "--ignore-scripts", "--tag", "latest"])
  assert.deepEqual(await fs.readFile(archive), original)
  await assert.rejects(fs.stat(commands.temporary), { code: "ENOENT" })
})

test("only an explicit registry E404 permits publication; auth and network failures stay failures", async (t) => {
  const { archive } = await fixture(t)
  for (const failure of [
    { status: 1, stdout: JSON.stringify({ error: { code: "E401" } }) },
    { status: 1, stdout: JSON.stringify({ error: { code: "E403" } }) },
    { status: 1, stdout: JSON.stringify({ error: { code: "ECONNRESET" } }) },
    { status: 1, stdout: "not JSON 404" },
    { status: null, stdout: "", error: new Error("missing npm") },
  ]) {
    const commands = runner({ view: failure })
    await assert.rejects(publishGithubPackage({ tarball: archive, version, token: "fake-test-token", runCommand: commands.runCommand }), /Cannot check GitHub Packages version/)
    assert.equal(commands.calls.some((call) => call.args[0] === "publish"), false)
    await assert.rejects(fs.stat(commands.temporary), { code: "ENOENT" })
  }
})

test("an existing identical scoped version is verified and skipped on retry", async (t) => {
  const { archive } = await fixture(t)
  const commands = runner({ view: { status: 0, stdout: JSON.stringify({ name, version }) } })
  const result = await publishGithubPackage({ tarball: archive, version, token: "fake-test-token", runCommand: commands.runCommand })
  assert.deepEqual(result, { name, version, published: false, verifiedExisting: true })
  assert.equal(commands.calls.some((call) => call.args[0] === "publish"), false)
  assert.equal(commands.calls.some((call) => call.args[0] === "pack"), true)
  await assert.rejects(fs.stat(commands.temporary), { code: "ENOENT" })
})

test("an existing scoped version with different files is never accepted as a successful retry", async (t) => {
  const { archive } = await fixture(t)
  const commands = runner({ view: { status: 0, stdout: JSON.stringify({ name, version }) }, existingMismatch: true })
  await assert.rejects(publishGithubPackage({ tarball: archive, version, token: "fake-test-token", runCommand: commands.runCommand }), /Existing GitHub package content differs: dist\/bin.js/)
  assert.equal(commands.calls.some((call) => call.args[0] === "publish"), false)
  await assert.rejects(fs.stat(commands.temporary), { code: "ENOENT" })
})

test("failure output cannot disclose the publishing token", async (t) => {
  const { archive } = await fixture(t)
  const commands = runner({ view: { status: 1, stdout: "fake-test-token leaked by a child", stderr: "secret value" } })
  await assert.rejects(publishGithubPackage({ tarball: archive, version, token: "fake-test-token", runCommand: commands.runCommand }), (error) => {
    assert.equal(error.message.includes("fake-test-token"), false)
    assert.equal(error.message.includes("secret value"), false)
    return true
  })
})
