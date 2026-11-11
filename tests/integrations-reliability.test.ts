import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { execFile, spawn } from "node:child_process"
import { promisify } from "node:util"
import { afterEach, describe, expect, it } from "vitest"
import { githubWorkflow, installGitHook, installGithubWorkflow } from "../packages/core/src/integrations-local.ts"
import { CLI_PACKAGE, CLI_VERSION } from "@design-rover/model"

const exec = promisify(execFile)
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))) })

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "design-rover-hooks-"))
  roots.push(root)
  await exec("git", ["init", "-q"], { cwd: root })
  return root
}

async function runHook(file: string, root: string, fakeBin: string, capture: string, input = "") {
  return new Promise<number | null>((resolve, reject) => {
    const child = spawn("/bin/sh", [file, "origin", "https://example.com/repo"], {
      cwd: root,
      env: { ...process.env, PATH: `${fakeBin}:/bin`, ROVER_TEST_CAPTURE: capture, ROVER_TEST_ARGS: `${capture}.args`, ROVER_TEST_STDIN: `${capture}.stdin` },
      stdio: ["pipe", "pipe", "pipe"],
    })
    child.on("error", reject)
    // A deliberately failing hook can close stdin before the parent writes.
    // Preserve its exit status and wait for stream errors/closure before cleanup.
    child.stdin.on("error", (error: NodeJS.ErrnoException) => { if (error.code !== "EPIPE") reject(error) })
    child.on("close", resolve)
    child.stdin.end(input)
  })
}

describe("Git and CI integration reliability", () => {
  it("preserves existing hook behavior, arguments and stdin; invokes the correct pinned fallback", async () => {
    const root = await fixture()
    const hook = path.join(root, ".git/hooks/pre-push")
    const original = '#!/bin/sh\ncat > "$ROVER_TEST_STDIN"\nprintf "%s\\n" "$@" > "$ROVER_TEST_ARGS"\n'
    await fs.writeFile(hook, original, { mode: 0o755 })
    await installGitHook(root)
    await installGitHook(root)
    expect(await fs.readFile(`${hook}.design-rover-previous`, "utf8")).toBe(original)
    const bin = path.join(root, "bin")
    await fs.mkdir(bin)
    await fs.writeFile(path.join(bin, "npx"), '#!/bin/sh\nprintf "%s\\n" "$@" > "$ROVER_TEST_CAPTURE"\n', { mode: 0o755 })
    const capture = path.join(root, "capture")
    expect(await runHook(hook, root, bin, capture, "refs/heads/main abc refs/heads/main def\n")).toBe(0)
    expect(await fs.readFile(`${capture}.args`, "utf8")).toBe("origin\nhttps://example.com/repo\n")
    expect(await fs.readFile(`${capture}.stdin`, "utf8")).toContain("refs/heads/main abc")
    expect((await fs.readFile(capture, "utf8")).trim().split("\n")).toEqual(["--yes", `${CLI_PACKAGE}@${CLI_VERSION}`, "git", "hook", "origin", "https://example.com/repo"])
  })

  it("keeps a failed existing hook as a failed push", async () => {
    const root = await fixture()
    const hook = path.join(root, ".git/hooks/pre-push")
    await fs.writeFile(hook, "#!/bin/sh\nexit 7\n", { mode: 0o755 })
    await installGitHook(root)
    const bin = path.join(root, "bin")
    await fs.mkdir(bin)
    expect(await runHook(hook, root, bin, path.join(root, "capture"))).toBe(7)
  })

  it("prefers Bun when a pinned command needs to be downloaded", async () => {
    const root = await fixture()
    const hook = await installGitHook(root)
    const bin = path.join(root, "bin")
    await fs.mkdir(bin)
    await fs.writeFile(path.join(bin, "bunx"), '#!/bin/sh\nprintf "%s\\n" "$@" > "$ROVER_TEST_CAPTURE"\n', { mode: 0o755 })
    await fs.writeFile(path.join(bin, "npx"), '#!/bin/sh\nexit 99\n', { mode: 0o755 })
    const capture = path.join(root, "capture")
    expect(await runHook(hook, root, bin, capture)).toBe(0)
    expect((await fs.readFile(capture, "utf8")).trim().split("\n")).toEqual([`${CLI_PACKAGE}@${CLI_VERSION}`, "git", "hook", "origin", "https://example.com/repo"])
  })

  it("respects custom hooksPath and linked worktrees", async () => {
    const root = await fixture()
    await exec("git", ["config", "core.hooksPath", ".hooks"], { cwd: root })
    expect(await installGitHook(root)).toBe(path.join(root, ".hooks/pre-push"))
    await exec("git", ["config", "--unset", "core.hooksPath"], { cwd: root })
    await fs.writeFile(path.join(root, "README.md"), "fixture\n")
    await exec("git", ["add", "README.md"], { cwd: root })
    await exec("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "fixture"], { cwd: root })
    const worktree = path.join(root, "linked")
    await exec("git", ["worktree", "add", "--detach", worktree], { cwd: root })
    const hook = await installGitHook(worktree)
    expect(await fs.realpath(hook)).toBe(await fs.realpath(path.join(root, ".git/hooks/pre-push")))
    expect((await fs.stat(path.join(worktree, ".git"))).isFile()).toBe(true)
  })

  it("refuses to overwrite an existing workflow and uses env for branch names", async () => {
    const root = await fixture()
    const target = path.join(root, ".github/workflows/design-rover.yml")
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, "name: My existing checks\n")
    await expect(installGithubWorkflow(root)).rejects.toThrow("already exists")
    expect(await fs.readFile(target, "utf8")).toBe("name: My existing checks\n")
    expect(githubWorkflow()).toContain(`${CLI_PACKAGE}@${CLI_VERSION}`)
    expect(githubWorkflow()).toContain("oven-sh/setup-bun@v2")
    expect(githubWorkflow()).toContain("run: bunx")
    const run = githubWorkflow().split("\n").find((line) => line.includes("run:"))!
    expect(run).not.toContain("${{")
    expect(run).toContain('"origin/$DESIGN_ROVER_BASE"')
  })
})
