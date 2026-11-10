import path from "node:path"
import fs from "node:fs/promises"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { randomUUID } from "node:crypto"
import { CLI_PACKAGE, CLI_VERSION, PRODUCT_NAME } from "@design-rover/model"
import { gitLogSpec } from "./fs.ts"
import { specPaths } from "./paths.ts"
import { loadCanonical } from "./store.ts"

const exec = promisify(execFile)
const HOOK_MARKER = "# design-rover managed pre-push hook"
const PREVIOUS_SUFFIX = ".design-rover-previous"

export async function history(root: string) {
  const git = await gitLogSpec(root)
  const model = await loadCanonical(root)
  const events = model?.history ?? []
  return {
    git: git.map((item) => ({
      at: item.date,
      summary: item.subject,
      hash: item.hash,
    })),
    events: events.slice(-50).reverse(),
  }
}

export function hookScript(): string {
  return `#!/bin/sh
${HOOK_MARKER}
previous_hook="$0${PREVIOUS_SUFFIX}"
if [ -x "$previous_hook" ]; then
  "$previous_hook" "$@" || exit $?
fi
if command -v design-rover >/dev/null 2>&1; then
  exec design-rover git hook "$@"
elif command -v bunx >/dev/null 2>&1; then
  exec bunx ${CLI_PACKAGE}@${CLI_VERSION} git hook "$@"
else
  exec npx --yes ${CLI_PACKAGE}@${CLI_VERSION} git hook "$@"
fi
`
}

export async function installGitHook(root: string): Promise<string> {
  let hooksPath: string
  try {
    const { stdout } = await exec("git", ["rev-parse", "--git-path", "hooks/pre-push"], { cwd: root })
    hooksPath = stdout.trim()
  } catch {
    throw new Error("Cannot install a Git hook outside a Git repository.")
  }
  const dest = path.resolve(root, hooksPath)
  const existing = await fs.readFile(dest, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined
    throw error
  })
  if (existing && existing.includes(HOOK_MARKER) && existing !== hookScript()) throw new Error(`Hook ${dest} has local edits. Preserve those edits before reinstalling.`)
  const previous = `${dest}${PREVIOUS_SUFFIX}`
  const preserve = Boolean(existing && existing !== hookScript())
  if (preserve) {
    try {
      await fs.lstat(previous)
      throw new Error(`Cannot preserve the existing hook: ${previous} already exists.`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    }
  }
  await fs.mkdir(path.dirname(dest), { recursive: true })
  const temporary = `${dest}.${randomUUID()}.tmp`
  let moved = false
  try {
    await fs.writeFile(temporary, hookScript(), { mode: 0o755, flag: "wx" })
    if (preserve) { await fs.rename(dest, previous); moved = true }
    await fs.rename(temporary, dest)
  } catch (error) {
    if (moved) await fs.rename(previous, dest)
    throw error
  } finally {
    await fs.rm(temporary, { force: true })
  }
  return dest
}

export function githubWorkflow(): string {
  return `name: ${PRODUCT_NAME}

on:
  pull_request:
  push:
    branches: [main, master]

jobs:
  design-rover:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.4.4
      - name: ${PRODUCT_NAME} CI
        run: bunx ${CLI_PACKAGE}@${CLI_VERSION} ci --base "origin/$DESIGN_ROVER_BASE"
        env:
          DESIGN_ROVER_BASE: \${{ github.base_ref || github.event.repository.default_branch }}
`
}

export async function installGithubWorkflow(root: string): Promise<string> {
  const { writeText } = await import("./fs.ts")
  const current = path.join(root, ".github/workflows/design-rover.yml")
  const read = async (file: string) => fs.readFile(file, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined
    throw error
  })
  const currentText = await read(current)
  if (currentText !== undefined && currentText !== githubWorkflow()) throw new Error(`Workflow ${current} already exists. Review it before replacing it.`)
  await writeText(current, githubWorkflow())
  return current
}

export function specDirHint(root: string): string {
  return specPaths(root).dir
}
