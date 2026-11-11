import fs from "node:fs/promises"
import path from "node:path"

/** Resolve the repository itself, but never follow a child symlink for managed writes. */
export async function assertSafeWritePaths(root: string, targets: string[]): Promise<void> {
  const logicalRoot = path.resolve(root)
  const physicalRoot = await fs.realpath(logicalRoot)
  const checked = new Map<string, Awaited<ReturnType<typeof fs.lstat>> | undefined>()
  for (const target of targets) {
    const absolute = path.resolve(target)
    let relative = path.relative(logicalRoot, absolute)
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      relative = path.relative(physicalRoot, absolute)
    }
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
      throw new Error(`Managed write is outside the repository: ${target}`)
    const parts = relative.split(path.sep).filter(Boolean)
    let current = physicalRoot
    for (let index = 0; index < parts.length; index += 1) {
      current = path.join(current, parts[index]!)
      if (!checked.has(current)) {
        try {
          checked.set(current, await fs.lstat(current))
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
          checked.set(current, undefined)
        }
      }
      const stat = checked.get(current)
      if (stat?.isSymbolicLink())
        throw new Error(
          `Unsafe managed write target: ${current} is a symlink. Preserve its target and replace the link before continuing.`,
        )
      if (stat && index < parts.length - 1 && !stat.isDirectory())
        throw new Error(`Unsafe managed write parent is not a directory: ${current}`)
    }
  }
}
