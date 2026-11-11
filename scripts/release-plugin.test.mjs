import assert from "node:assert/strict"
import { test } from "node:test"
import { analyzeCommits } from "@semantic-release/commit-analyzer"
import config from "../release.config.mjs"
import { registryVersion } from "./release-plugin.mjs"

test("only an explicit registry 404 permits a new publication", async () => {
  assert.equal(await registryVersion("0.3.2", async () => ({ status: 404 })), false)
  for (const status of [401, 403, 429, 500]) {
    await assert.rejects(registryVersion("0.3.2", async () => ({ status, ok: false })), /publication was not attempted/)
  }
  await assert.rejects(registryVersion("0.3.2", async () => { throw new Error("network failed") }), /network failed/)
})
test("a successful registry lookup must match the expected identity", async () => {
  assert.equal(await registryVersion("0.3.2", async () => ({ ok: true, json: async () => ({ name: "design-rover", version: "0.3.2" }) })), true)
  await assert.rejects(registryVersion("0.3.2", async () => ({ ok: true, json: async () => ({ name: "other", version: "0.3.2" }) })))
  await assert.rejects(registryVersion("0.3.2", async () => ({ ok: true, json: async () => ({ name: "design-rover", version: "0.3.1" }) })))
})
test("registry version arguments cannot become paths or prerelease publications", async () => {
  let requests = 0
  for (const version of ["../latest", "v0.3.2", "0.3.2-beta.1"]) {
    await assert.rejects(registryVersion(version, async () => { requests += 1 }))
  }
  assert.equal(requests, 0)
})
for (const [message, expected] of [
  ["fix: preserve approvals", "patch"],
  ["feat: add a query", "minor"],
  ["feat!: replace the model", "major"],
  ["fix: replace the model\n\nBREAKING CHANGE: migration is required", "major"],
  ["docs: improve the README", null],
  ["chore(release): 0.3.2 [skip ci]", null],
]) {
  test(`release classification: ${message.split("\n")[0]}`, async () => {
    const result = await analyzeCommits(config.plugins[0][1], { cwd: process.cwd(), commits: [{ hash: "abc123", message }], logger: { log() {} } })
    assert.equal(result, expected)
  })
}
