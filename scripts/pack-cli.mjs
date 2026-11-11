import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const source = path.join(project, "packages/cli")
const destination = path.resolve(process.argv[2] ?? project)
const staging = await fs.mkdtemp(path.join(os.tmpdir(), "design-rover-pack-"))

try {
  const manifest = JSON.parse(await fs.readFile(path.join(source, "package.json"), "utf8"))
  // Workspace packages are bundled by tsup. They are build dependencies, not
  // public npm packages; keep them in the source manifest only.
  delete manifest.devDependencies
  await fs.writeFile(path.join(staging, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`)
  for (const entry of ["dist", "README.md", "LICENSE"]) {
    await fs.cp(path.join(source, entry), path.join(staging, entry), { recursive: true })
  }
  await fs.mkdir(destination, { recursive: true })
  const result = spawnSync("bun", ["pm", "pack", "--ignore-scripts", "--destination", destination], {
    cwd: staging,
    stdio: "inherit",
    timeout: 60_000,
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Bun packaging failed (exit ${result.status}).`)
} finally {
  await fs.rm(staging, { recursive: true, force: true })
}
