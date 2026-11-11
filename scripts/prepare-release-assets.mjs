import assert from "node:assert/strict"
import { createHash, timingSafeEqual } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath, pathToFileURL } from "node:url"

const registry = "https://registry.npmjs.org"
const packageName = "design-rover"

function tar(args) {
  const result = spawnSync("tar", args, { maxBuffer: 32 * 1024 * 1024, timeout: 30_000 })
  if (result.error) throw result.error
  assert.equal(result.status, 0, `Cannot read release archive: ${result.stderr.toString()}`)
  return result.stdout
}

function archiveFiles(filename) {
  const entries = tar(["-tzf", filename]).toString("utf8").trim().split("\n").filter(Boolean)
  for (const entry of entries) {
    assert(entry.startsWith("package/") && !entry.includes("\\") &&
      entry.split("/").every((part) => part !== "." && part !== ".."), `Unexpected archive path: ${entry}`)
  }
  const files = entries.filter((entry) => !entry.endsWith("/"))
  assert.equal(new Set(files).size, files.length, "Release archive contains duplicate file paths")
  assert(files.includes("package/package.json"), "Release archive has no package manifest")
  return new Map(files.sort().map((entry) => [entry, tar(["-xOzf", filename, entry])]))
}

export function verifyRegistryArtifact(metadata, bytes, version) {
  assert.equal(metadata.name, packageName, "Registry returned the wrong package")
  assert.equal(metadata.version, version, "Registry returned the wrong version")
  const tarball = new URL(metadata.dist?.tarball)
  assert.equal(tarball.href, `${registry}/${packageName}/-/${packageName}-${version}.tgz`, "Unexpected npm tarball URL")
  const integrity = metadata.dist?.integrity
  assert.match(integrity ?? "", /^sha512-[A-Za-z0-9+/]+={0,2}$/, "npm metadata must include SHA512 integrity")
  const expected = Buffer.from(integrity.slice("sha512-".length), "base64")
  const actual = createHash("sha512").update(bytes).digest()
  assert(expected.length === actual.length && timingSafeEqual(expected, actual), "Published tarball failed npm SHA512 integrity verification")
  return integrity
}

export function verifyMatchingArchives(localFilename, publishedFilename, version) {
  const local = archiveFiles(localFilename)
  const published = archiveFiles(publishedFilename)
  assert.deepEqual([...published.keys()], [...local.keys()], "Published npm files differ from this release build")
  for (const [entry, bytes] of local) {
    assert(bytes.equals(published.get(entry)), `Published npm content differs from this release build: ${entry}`)
  }
  const manifest = JSON.parse(published.get("package/package.json").toString("utf8"))
  assert.equal(manifest.name, packageName)
  assert.equal(manifest.version, version)
  assert.deepEqual(manifest.bin, { "design-rover": "./dist/bin.js" })
}

export async function prepareReleaseAssets({ version, localTarball, destination, fetchImpl = fetch }) {
  assert.match(version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, "Expected an npm release version")
  const metadataResponse = await fetchImpl(`${registry}/${packageName}/${encodeURIComponent(version)}`, {
    signal: AbortSignal.timeout(30_000),
    redirect: "error",
  })
  assert(metadataResponse.ok, `npm ${packageName}@${version} is unavailable (HTTP ${metadataResponse.status}). Publish npm first and wait for registry scanning to finish, then rerun this workflow.`)
  const metadata = await metadataResponse.json()
  // Validate identity and URL before making the tarball request.
  assert.equal(metadata.name, packageName, "Registry returned the wrong package")
  assert.equal(metadata.version, version, "Registry returned the wrong version")
  assert.equal(metadata.dist?.tarball, `${registry}/${packageName}/-/${packageName}-${version}.tgz`, "Unexpected npm tarball URL")
  const tarballResponse = await fetchImpl(metadata.dist.tarball, {
    signal: AbortSignal.timeout(30_000),
    redirect: "error",
  })
  assert(tarballResponse.ok, `Cannot download published npm tarball (HTTP ${tarballResponse.status})`)
  const bytes = Buffer.from(await tarballResponse.arrayBuffer())
  const integrity = verifyRegistryArtifact(metadata, bytes, version)
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "design-rover-release-"))
  const filename = `${packageName}-${version}.tgz`
  try {
    const publishedFilename = path.join(temporary, filename)
    await fs.writeFile(publishedFilename, bytes)
    verifyMatchingArchives(localTarball, publishedFilename, version)
    const sha256 = createHash("sha256").update(bytes).digest("hex")
    await fs.mkdir(destination, { recursive: true })
    await fs.writeFile(path.join(destination, filename), bytes, { flag: "wx" })
    await fs.writeFile(path.join(destination, "SHA256SUMS"), `${sha256}  ${filename}\n`, { flag: "wx" })
    return { package: packageName, version, filename, bytes: bytes.length, integrity, sha256, destination }
  } finally {
    await fs.rm(temporary, { recursive: true, force: true })
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
  const manifest = JSON.parse(await fs.readFile(path.join(project, "packages/cli/package.json"), "utf8"))
  const version = process.argv[2] ?? manifest.version
  assert.equal(version, manifest.version, "Release version must match the CLI manifest")
  const result = await prepareReleaseAssets({
    version,
    localTarball: path.join(project, `${packageName}-${version}.tgz`),
    destination: path.resolve(process.argv[3] ?? path.join(project, "dist/release")),
  })
  console.log(JSON.stringify(result, null, 2))
}
