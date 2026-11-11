import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import test from "node:test"
import { prepareReleaseAssets, verifyRegistryArtifact, verifyMatchingArchives } from "./prepare-release-assets.mjs"

const version = "1.2.3"
const tarballUrl = `https://registry.npmjs.org/design-rover/-/design-rover-${version}.tgz`

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "design-rover-release-test-"))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  return directory
}

async function archive(directory, name, source = "#!/usr/bin/env node\nconsole.log('design-rover')\n", modified = new Date("2026-01-01T00:00:00Z")) {
  const contents = path.join(directory, name)
  const files = {
    "package/package.json": JSON.stringify({ name: "design-rover", version, bin: { "design-rover": "./dist/bin.js" } }),
    "package/dist/bin.js": source,
    "package/LICENSE": "MIT test fixture\n",
    "package/README.md": "Design Rover release fixture\n",
  }
  for (const [filename, content] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(contents, filename)), { recursive: true })
    await fs.writeFile(path.join(contents, filename), content)
    await fs.utimes(path.join(contents, filename), modified, modified)
  }
  const filename = path.join(directory, `${name}.tgz`)
  const result = spawnSync("tar", ["-czf", filename, "-C", contents, "package"], { encoding: "utf8" })
  assert.equal(result.status, 0, result.stderr)
  return filename
}

function metadata(bytes) {
  return {
    name: "design-rover",
    version,
    dist: { tarball: tarballUrl, integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}` },
  }
}

function registryFetch(manifest, bytes, requests) {
  return async (url, options) => {
    requests.push(url)
    assert.equal(options.redirect, "error")
    if (url === `https://registry.npmjs.org/design-rover/${version}`) return Response.json(manifest)
    assert.equal(url, tarballUrl)
    return new Response(bytes)
  }
}

test("release assets retain the exact npm bytes and include a matching SHA256 checksum", async (t) => {
  const directory = await fixture(t)
  const localTarball = await archive(directory, "local")
  const bytes = await fs.readFile(localTarball)
  const destination = path.join(directory, "assets")
  const requests = []
  const result = await prepareReleaseAssets({ version, localTarball, destination, fetchImpl: registryFetch(metadata(bytes), bytes, requests) })
  assert.deepEqual(requests, [`https://registry.npmjs.org/design-rover/${version}`, tarballUrl])
  assert.deepEqual(await fs.readFile(path.join(destination, result.filename)), bytes)
  assert.equal(result.integrity, metadata(bytes).dist.integrity)
  assert.equal(await fs.readFile(path.join(destination, "SHA256SUMS"), "utf8"), `${createHash("sha256").update(bytes).digest("hex")}  design-rover-${version}.tgz\n`)
})

test("corrupted registry content cannot become a release asset", async (t) => {
  const directory = await fixture(t)
  const localTarball = await archive(directory, "local")
  const bytes = await fs.readFile(localTarball)
  const destination = path.join(directory, "assets")
  await assert.rejects(prepareReleaseAssets({
    version, localTarball, destination,
    fetchImpl: registryFetch(metadata(bytes), Buffer.concat([bytes, Buffer.from("corrupt")]), []),
  }), /SHA512 integrity/)
  await assert.rejects(fs.stat(destination), { code: "ENOENT" })
})

test("a valid registry artifact from different source fails the tag/build comparison", async (t) => {
  const directory = await fixture(t)
  const localTarball = await archive(directory, "local")
  const differentTarball = await archive(directory, "published", "#!/usr/bin/env node\nconsole.log('different source')\n")
  const bytes = await fs.readFile(differentTarball)
  const destination = path.join(directory, "assets")
  await assert.rejects(prepareReleaseAssets({
    version, localTarball, destination, fetchImpl: registryFetch(metadata(bytes), bytes, []),
  }), /Published npm content differs.*package\/dist\/bin.js/)
  await assert.rejects(fs.stat(destination), { code: "ENOENT" })
})

test("archive metadata differences do not replace npm bytes with a local repack", async (t) => {
  const directory = await fixture(t)
  const localTarball = await archive(directory, "local")
  const publishedTarball = await archive(directory, "published", undefined, new Date("2026-02-01T00:00:00Z"))
  const localBytes = await fs.readFile(localTarball)
  const publishedBytes = await fs.readFile(publishedTarball)
  assert.notDeepEqual(localBytes, publishedBytes)
  const destination = path.join(directory, "assets")
  const result = await prepareReleaseAssets({
    version, localTarball, destination, fetchImpl: registryFetch(metadata(publishedBytes), publishedBytes, []),
  })
  assert.deepEqual(await fs.readFile(path.join(destination, result.filename)), publishedBytes)
})

test("wrong registry identity and non-npm tarball URLs are rejected before download", async () => {
  for (const changed of [
    { name: "other-package" },
    { version: "9.9.9" },
    { dist: { tarball: "https://example.com/package.tgz", integrity: "sha512-invalid" } },
  ]) {
    let requests = 0
    await assert.rejects(prepareReleaseAssets({
      version, localTarball: "unused", destination: "unused",
      fetchImpl: async () => { requests += 1; return Response.json({ ...metadata(Buffer.from("test")), ...changed }) },
    }), /wrong package|wrong version|Unexpected npm tarball URL/)
    assert.equal(requests, 1)
  }
})

test("unavailable npm versions explain the publish-first requirement", async () => {
  await assert.rejects(prepareReleaseAssets({
    version, localTarball: "unused", destination: "unused", fetchImpl: async () => new Response("not found", { status: 404 }),
  }), /Publish npm first and wait for registry scanning/)
})

test("archive identity and npm integrity are required even when files match", async (t) => {
  const directory = await fixture(t)
  const filename = await archive(directory, "package")
  const bytes = await fs.readFile(filename)
  assert.throws(() => verifyMatchingArchives(filename, filename, "9.9.9"))
  assert.throws(() => verifyRegistryArtifact({ ...metadata(bytes), dist: { tarball: tarballUrl } }, bytes, version), /SHA512 integrity/)
})
