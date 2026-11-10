import fs from "node:fs/promises"
import path from "node:path"
import fg from "fast-glob"
import ignore from "ignore"
import { sha256 } from "./hash.ts"
import { relativePosix, toPosix } from "./paths.ts"
import { readText } from "./fs.ts"
import type { FileEvidence, RepoEvidence } from "./evidence.ts"
import { extractFileEvidence } from "./parse.ts"

const DEFAULT_IGNORE = [
  "**/node_modules/**",
  "dist/**",
  "build/**",
  "out/**",
  "coverage/**",
  ".git/**",
  ".next/**",
  ".turbo/**",
  ".vercel/**",
  "**/.design-rover/**",
  ".agents/skills/design-rover/**",
  ".cursor/rules/design-rover.mdc",
  "**/*.d.ts",
  "**/*.min.js",
  "**/bun.lock",
  "**/bun.lockb",
  "**/package-lock.json",
  "**/yarn.lock",
  "**/*.map",
]

const SCRIPT_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts"])
const STYLE_EXT = new Set([".css", ".scss", ".module.css"])

export async function discoverFiles(root: string): Promise<string[]> {
  const ig = ignore()
  ig.add(DEFAULT_IGNORE)
  const gitignore = await readText(path.join(root, ".gitignore"))
  if (gitignore) ig.add(gitignore)

  const found = await fg(
    [
      "**/*.{ts,tsx,js,jsx,mts,cts,css}",
      "package.json",
      "components.json",
      "tailwind.config.{js,ts,mjs,cjs}",
      "postcss.config.{js,ts,mjs,cjs}",
      "tsconfig.json",
      "AGENTS.md",
      "CLAUDE.md",
      "README.md",
      ".cursor/rules/**/*.mdc",
    ],
    {
      cwd: root,
      dot: true,
      onlyFiles: true,
      followSymbolicLinks: false,
      ignore: ["**/node_modules/**", "**/.git/**", "**/.design-rover/**"],
    },
  )

  return found
    .map((file) => toPosix(file))
    .filter((file) => !ig.ignores(file))
    .sort()
}

export async function loadPackageJson(
  root: string,
): Promise<Record<string, unknown> | undefined> {
  const raw = await readText(path.join(root, "package.json"))
  if (!raw) return undefined
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return undefined
  }
}

export async function loadComponentsJson(
  root: string,
): Promise<Record<string, unknown> | undefined> {
  const raw = await readText(path.join(root, "components.json"))
  if (!raw) return undefined
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return undefined
  }
}

export async function loadTsconfigPaths(
  root: string,
): Promise<Record<string, string[]>> {
  const raw = await readText(path.join(root, "tsconfig.json"))
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as {
      compilerOptions?: { paths?: Record<string, string[]> }
    }
    return parsed.compilerOptions?.paths ?? {}
  } catch {
    return {}
  }
}

export async function collectEvidence(
  root: string,
  options: { files?: string[]; cachedFiles?: FileEvidence[] } = {},
): Promise<RepoEvidence> {
  const relativeFiles = [...new Set(options.files ?? (await discoverFiles(root)))].sort()
  const cached = new Map(options.cachedFiles?.map((file) => [file.relative, file]))
  const [packageJson, componentsJson, tsconfigPaths] = await Promise.all([
    loadPackageJson(root),
    loadComponentsJson(root),
    loadTsconfigPaths(root),
  ])

  const files = []
  const excluded = ignore().add(DEFAULT_IGNORE)
  for (const relative of relativeFiles) {
    const abs = path.join(root, relative)
    const fromRoot = path.relative(path.resolve(root), path.resolve(abs))
    if (fromRoot === ".." || fromRoot.startsWith(`..${path.sep}`) || path.isAbsolute(fromRoot)) {
      throw new Error(`Source path is outside the repository: ${relative}`)
    }
    if (excluded.ignores(relative)) continue
    let content: string
    try {
      content = await fs.readFile(abs, "utf8")
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue
      throw error
    }
    if (relative === "AGENTS.md" || relative === "CLAUDE.md") {
      // Generated guidance describes this tool's model, not independent source
      // evidence. Keep human text and line positions outside complete blocks.
      content = content.replace(/<!-- design-rover:start -->[\s\S]*?<!-- design-rover:end -->/g, (block) => "\n".repeat(block.split("\n").length - 1))
      if (!content.trim()) continue
    }
    const ext = path.extname(relative)
    const kind = SCRIPT_EXT.has(ext)
      ? "script"
      : STYLE_EXT.has(ext) || relative.endsWith(".module.css")
        ? "style"
        : relative.endsWith(".json") || relative.endsWith(".md") || relative.endsWith(".mdc")
          ? "json"
          : "other"
    const normalizedKind = kind === "script" || kind === "style" ? kind : "other"
    const hash = sha256(content)
    const previous = cached.get(relative)
    files.push(previous?.hash === hash && previous.kind === normalizedKind
      ? previous
      : extractFileEvidence({
        relative,
        content,
        hash,
        kind: normalizedKind,
      }),
    )
  }

  return {
    root,
    files,
    packageJson,
    componentsJson,
    tsconfigPaths,
  }
}

export { relativePosix }
