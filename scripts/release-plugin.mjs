import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { pathToFileURL } from "node:url"
import { setReleaseVersion } from "./release-version.mjs"
import { prepareReleaseAssets } from "./prepare-release-assets.mjs"
import { publishGithubPackage } from "./publish-github-package.mjs"

const repository = "nisargkavi/design-rover"
const registry = "https://registry.npmjs.org"

function run(command, args, cwd = process.cwd()) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", timeout: 180_000 })
  if (result.error) throw result.error
  assert.equal(result.status, 0, `${command} failed (exit ${result.status}).`)
}

export async function registryVersion(version, fetchImpl = fetch) {
  assert.match(version, /^\d+\.\d+\.\d+$/)
  const response = await fetchImpl(`${registry}/design-rover/${version}`, { redirect: "error", signal: AbortSignal.timeout(30_000) })
  if (response.status === 404) return false
  assert(response.ok, `Cannot check npm version (HTTP ${response.status}); publication was not attempted.`)
  const metadata = await response.json()
  assert.equal(metadata.name, "design-rover")
  assert.equal(metadata.version, version)
  return true
}

export async function waitForRegistry(version, {
  attempts = 90,
  delayMs = 10_000,
  fetchImpl = fetch,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
} = {}) {
  assert(Number.isInteger(attempts) && attempts > 0)
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await registryVersion(version, fetchImpl)) return
    if (attempt < attempts - 1) await sleep(delayMs)
  }
  throw new Error("npm has not made the version available yet. Resume this tagged release after registry scanning finishes.")
}

export function verifyConditions() {
  assert(process.env.GH_TOKEN || process.env.GITHUB_TOKEN, "A GitHub token is required for release tags and assets.")
}

export async function prepare(_options, { cwd = process.cwd(), nextRelease }) {
  const version = nextRelease.version
  assert.match(version, /^\d+\.\d+\.\d+$/)
  const notes = path.join(cwd, `docs/releases/v${version}.md`)
  try { await fs.access(notes) }
  catch (error) {
    if (error.code !== "ENOENT") throw error
    await fs.writeFile(notes, `# Design Rover ${version}\n\n${nextRelease.notes}\n`, { flag: "wx" })
  }
  await setReleaseVersion(version, cwd)
  run("bun", ["install", "--frozen-lockfile", "--ignore-scripts"], cwd)
  run("node", ["scripts/check-release.mjs", version], cwd)
  run("bun", ["run", "pack:cli"], cwd)
  run("node", ["scripts/smoke-cli.mjs", `design-rover-${version}.tgz`], cwd)
}

/** Also used to resume a tagged release after a registry or network failure. */
export async function publish(_options, { cwd = process.cwd(), nextRelease }) {
  const version = nextRelease.version
  assert.match(version, /^\d+\.\d+\.\d+$/)
  run("node", ["scripts/check-release.mjs", version], cwd)
  const tarball = path.join(cwd, `design-rover-${version}.tgz`)
  if (!await registryVersion(version)) {
    run("npm", ["publish", tarball, "--access", "public", "--tag", "latest", "--ignore-scripts"], cwd)
  }
  await waitForRegistry(version)
  const destination = path.join(cwd, "dist/release")
  await fs.rm(destination, { recursive: true, force: true })
  await prepareReleaseAssets({ version, localTarball: tarball, destination })
  const publishedTarball = path.join(destination, `design-rover-${version}.tgz`)
  run("node", ["scripts/smoke-cli.mjs", publishedTarball], cwd)
  await publishGithubPackage({ tarball: publishedTarball, version, token: process.env.GH_PACKAGES_TOKEN ?? process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN })

  const tag = `v${version}`
  const response = await fetch(`https://api.github.com/repos/${repository}/releases/tags/${tag}`, {
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN}` },
    redirect: "error", signal: AbortSignal.timeout(30_000),
  })
  if (response.status === 404) {
    run("gh", ["release", "create", tag, publishedTarball, path.join(destination, "SHA256SUMS"), "--repo", repository, "--verify-tag", "--title", `Design Rover ${version}`, "--notes-file", path.join(cwd, `docs/releases/${tag}.md`)], cwd)
  } else {
    assert(response.ok, `Cannot inspect GitHub release (HTTP ${response.status}).`)
    const existing = await response.json()
    assert.equal(existing.tag_name, tag)
    run("gh", ["release", "upload", tag, publishedTarball, path.join(destination, "SHA256SUMS"), "--repo", repository, "--clobber"], cwd)
  }
  return { name: "npm and GitHub", url: `https://github.com/${repository}/releases/tag/${tag}` }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  assert.equal(process.argv[2], "resume", "Usage: node scripts/release-plugin.mjs resume <version>")
  const version = process.argv[3]
  assert.match(version ?? "", /^\d+\.\d+\.\d+$/)
  run("git", ["diff", "--exit-code", `v${version}`, "HEAD"])
  run("git", ["diff", "--exit-code", "HEAD", "--"])
  run("node", ["scripts/check-release.mjs", version])
  run("bun", ["run", "pack:cli"])
  run("node", ["scripts/smoke-cli.mjs", `design-rover-${version}.tgz`])
  await publish({}, { nextRelease: { version } })
}
