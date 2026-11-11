import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import ts from "typescript"
import { setReleaseVersion } from "./release-version.mjs"

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "rover-release-version-"))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const files = {
    "packages/cli/package.json": JSON.stringify({ name: "design-rover", version: "0.3.1", metadata: { version: "0.3.1" } }, null, 2) + "\n",
    "packages/core/package.json": '{"name":"@design-rover/core","version":"0.2.0"}\n',
    "packages/model/src/constants.ts": 'export const MODEL_VERSION = 1 as const\nexport const CLI_VERSION = "0.3.1"\nexport const OTHER_VERSION = "0.3.1"\n',
    "bun.lock": `{
  // Keep this comment and its "version": "0.3.1" example.
  "lockfileVersion": 2,
  "workspaces": {
    "packages/core": { "name": "@design-rover/core", "version": "0.3.1", },
    "packages/cli": {
      "name": "design-rover",
      "version": "0.2.0", // Previously stale CLI workspace identity.
      "dependencies": { "example": "^0.3.1", },
    },
  },
  "packages": { "example": ["example@0.3.1", "", {}, "integrity"], },
}
`,
    "README.md": 'Use bunx design-rover@0.3.1.\n[0.3.1 release notes](docs/releases/v0.3.1.md)\nKeep 0.3.10, 0.3.1-beta.1 and 0.3.1+build examples.\n',
    "docs/usage.md": 'bunx design-rover@0.3.1\n{"args":["design-rover@0.3.1","mcp"]}\n',
    "docs/development.md": 'design-rover-0.3.1.tgz\n[Release notes](releases/v0.3.1.md)\n',
    "packages/cli/README.md": 'Install design-rover@0.3.1.\n',
    "docs/releases/v0.3.1.md": '# Historical 0.3.1\nUse design-rover@0.3.1.\n',
    "docs/releases/v0.3.2.md": '# Current 0.3.2\n',
  }
  for (const [file, content] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true })
    await fs.writeFile(path.join(root, file), content)
  }
  return { root, files }
}

async function contents(root, files) {
  return Object.fromEntries(await Promise.all(Object.keys(files).map(async (file) => [file, await fs.readFile(path.join(root, file), "utf8")])))
}

test("release preparation updates public identity and current docs without rewriting unrelated data", async (t) => {
  const { root, files } = await fixture(t)
  const result = await setReleaseVersion("0.3.2", root)
  assert.equal(result.previousVersion, "0.3.1")
  assert.equal(result.version, "0.3.2")
  const after = await contents(root, files)
  const manifest = JSON.parse(after["packages/cli/package.json"])
  assert.equal(manifest.version, "0.3.2")
  assert.equal(manifest.metadata.version, "0.3.1")
  assert.match(after["packages/model/src/constants.ts"], /CLI_VERSION = "0\.3\.2"/)
  assert.match(after["packages/model/src/constants.ts"], /OTHER_VERSION = "0\.3\.1"/)
  const expectedLock = files["bun.lock"].replace('"version": "0.2.0", // Previously stale CLI workspace identity.', '"version": "0.3.2", // Previously stale CLI workspace identity.')
  assert.equal(after["bun.lock"], expectedLock, "Only the CLI workspace string token changes; JSONC formatting stays byte-for-byte intact")
  assert.deepEqual(ts.parseJsonText("bun.lock", after["bun.lock"]).parseDiagnostics, [])
  assert.equal(after["packages/core/package.json"], files["packages/core/package.json"])
  assert.equal(after["docs/releases/v0.3.1.md"], files["docs/releases/v0.3.1.md"])
  assert.equal(after["docs/releases/v0.3.2.md"], files["docs/releases/v0.3.2.md"])
  assert.match(after["README.md"], /\[0\.3\.2 release notes\]\(docs\/releases\/v0\.3\.2\.md\)/)
  assert.match(after["README.md"], /Keep 0\.3\.10, 0\.3\.1-beta\.1 and 0\.3\.1\+build/)
  assert.match(after["docs/usage.md"], /design-rover@0\.3\.2/)
  assert.match(after["docs/development.md"], /design-rover-0\.3\.2\.tgz/)
  assert.match(after["docs/development.md"], /releases\/v0\.3\.2\.md/)
  assert.match(after["packages/cli/README.md"], /design-rover@0\.3\.2/)
})

test("preparing the same release twice is idempotent", async (t) => {
  const { root, files } = await fixture(t)
  await setReleaseVersion("0.3.2", root)
  const before = await contents(root, files)
  const result = await setReleaseVersion("0.3.2", root)
  assert.deepEqual(result.files, [])
  assert.deepEqual(await contents(root, files), before)
})

test("current release links fall back to GitHub when generated local notes are absent", async (t) => {
  const { root, files } = await fixture(t)
  await fs.rm(path.join(root, "docs/releases/v0.3.2.md"))
  await setReleaseVersion("0.3.2", root)
  assert.match(await fs.readFile(path.join(root, "README.md"), "utf8"), /\[0\.3\.2 release notes\]\(https:\/\/github\.com\/nisargkavi\/design-rover\/releases\/tag\/v0\.3\.2\)/)
  assert.match(await fs.readFile(path.join(root, "docs/development.md"), "utf8"), /\[Release notes\]\(https:\/\/github\.com\/nisargkavi\/design-rover\/releases\/tag\/v0\.3\.2\)/)
  assert.equal(await fs.readFile(path.join(root, "docs/releases/v0.3.1.md"), "utf8"), files["docs/releases/v0.3.1.md"])
  await assert.rejects(fs.stat(path.join(root, "docs/releases/v0.3.2.md")), { code: "ENOENT" })
})

test("invalid versions fail before mutating any file", async (t) => {
  const { root, files } = await fixture(t)
  const invalid = [undefined, null, "v0.3.2", "0.03.2", "01.2.3", "1.2", "1.2.3.4", "1.2.3-beta.1", "1.2.3+build", "1.2.3\n", "9007199254740992.0.0"]
  for (const version of invalid) await assert.rejects(setReleaseVersion(version, root), /stable major\.minor\.patch/)
  assert.deepEqual(await contents(root, files), files)
})

test("a missing CLI constant fails before package or lockfile mutation", async (t) => {
  const { root, files } = await fixture(t)
  files["packages/model/src/constants.ts"] = 'export const MODEL_VERSION = 1 as const\n'
  await fs.writeFile(path.join(root, "packages/model/src/constants.ts"), files["packages/model/src/constants.ts"])
  await assert.rejects(setReleaseVersion("0.3.2", root), /Expected one exported CLI_VERSION/)
  assert.deepEqual(await contents(root, files), files)
})

test("a mismatched constant refuses to prepare a mixed release identity", async (t) => {
  const { root, files } = await fixture(t)
  files["packages/model/src/constants.ts"] = files["packages/model/src/constants.ts"].replace('CLI_VERSION = "0.3.1"', 'CLI_VERSION = "0.3.0"')
  await fs.writeFile(path.join(root, "packages/model/src/constants.ts"), files["packages/model/src/constants.ts"])
  await assert.rejects(setReleaseVersion("0.3.2", root), /public package version disagree/)
  assert.deepEqual(await contents(root, files), files)
})

test("a missing CLI lock entry fails before any source changes", async (t) => {
  const { root, files } = await fixture(t)
  files["bun.lock"] = files["bun.lock"].replace('"packages/cli": {', '"packages/other": {')
  await fs.writeFile(path.join(root, "bun.lock"), files["bun.lock"])
  await assert.rejects(setReleaseVersion("0.3.2", root), /exactly one packages\/cli property/)
  assert.deepEqual(await contents(root, files), files)
})

test("a missing required current document fails before any source changes", async (t) => {
  const { root, files } = await fixture(t)
  await fs.rm(path.join(root, "docs/usage.md"))
  const remaining = { ...files }
  delete remaining["docs/usage.md"]
  await assert.rejects(setReleaseVersion("0.3.2", root), { code: "ENOENT" })
  assert.deepEqual(await contents(root, remaining), remaining)
})
