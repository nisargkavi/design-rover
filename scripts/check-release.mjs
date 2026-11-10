import assert from "node:assert/strict"
import fs from "node:fs/promises"

const primary = JSON.parse(await fs.readFile("packages/cli/package.json", "utf8"))
const constants = await fs.readFile("packages/model/src/constants.ts", "utf8")
assert.equal(primary.name, "design-rover")
assert.equal(constants.match(/CLI_VERSION = "([^"]+)"/)?.[1], primary.version)
if (process.argv[2]) assert.equal(process.argv[2], primary.version, "Release tag must match the package version")
console.log(`Release identity verified: design-rover ${primary.version}`)
