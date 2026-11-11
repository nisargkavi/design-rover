import { execFile } from "node:child_process"
import { promisify } from "node:util"
import path from "node:path"
import fs from "node:fs/promises"
import { SPEC_DIR } from "@design-rover/model"
import { toPosix } from "./paths.ts"
import { assertSafeWritePaths } from "./write-paths.ts"

const exec = promisify(execFile)

export async function isGitRepo(root: string): Promise<boolean> {
  try {
    await exec("git", ["rev-parse", "--is-inside-work-tree"], { cwd: root })
    return true
  } catch {
    return false
  }
}

export async function gitRoot(start: string): Promise<string | undefined> {
  try {
    const { stdout } = await exec("git", ["rev-parse", "--show-toplevel"], {
      cwd: start,
    })
    return stdout.trim()
  } catch {
    return undefined
  }
}

export async function gitChangedFiles(
  root: string,
  base?: string,
): Promise<string[]> {
  if (base !== undefined && !base.trim()) throw new Error("Git base must not be empty.")
  if (!(await isGitRepo(root))) {
    if (base) throw new Error(`Cannot compare Git base "${base}": this directory is not a Git repository.`)
    return []
  }
  const run = async (args: string[]) => {
    const { stdout } = await exec("git", args, { cwd: root, maxBuffer: 20 * 1024 * 1024 })
    return stdout
  }
  try {
    const outputs: string[] = []
    if (base) {
      // Resolve user-provided refs before passing them to diff. A missing base must
      // not turn a PR check into an apparently clean comparison.
      const baseCommit = (await run(["rev-parse", "--verify", "--end-of-options", `${base}^{commit}`])).trim()
      const headCommit = (await run(["rev-parse", "--verify", "HEAD^{commit}"])).trim()
      outputs.push(await run(["diff", "--relative", "--name-only", "-z", "--no-renames", `${baseCommit}...${headCommit}`, "--"]))
    }
    outputs.push(
      await run(["diff", "--relative", "--name-only", "-z", "--no-renames", "--"]),
      await run(["diff", "--relative", "--name-only", "--cached", "-z", "--no-renames", "--"]),
      await run(["ls-files", "--others", "--exclude-standard", "-z"]),
    )
    const files = new Set(
      outputs.flatMap((output) => output.split("\0"))
        .filter(Boolean)
        .map((file) => toPosix(file)),
    )
    return [...files].sort()
  } catch (error) {
    throw new Error(`Unable to inspect Git changes${base ? ` against "${base}"` : ""}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export async function gitLogSpec(root: string): Promise<
  { hash: string; date: string; subject: string }[]
> {
  if (!(await isGitRepo(root))) return []
  try {
    const { stdout } = await exec(
      "git",
      [
        "log",
        "-20",
        "--pretty=format:%h\t%ad\t%s",
        "--date=short",
        "--",
        SPEC_DIR,
      ],
      { cwd: root },
    )
    return stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [hash, date, ...rest] = line.split("\t")
        return {
          hash: hash ?? "",
          date: date ?? "",
          subject: rest.join("\t"),
        }
      })
  } catch {
    return []
  }
}

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

export async function readText(filePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw error
  }
}

export async function writeText(filePath: string, content: string, root = process.cwd()): Promise<void> {
  await assertSafeWritePaths(root, [filePath])
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, content, "utf8")
}

export async function readJsonFile<T>(
  filePath: string,
  fallback: T,
): Promise<T> {
  const raw = await readText(filePath)
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export async function listJsonFiles(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => path.join(dir, entry.name))
      .sort()
  } catch {
    return []
  }
}
