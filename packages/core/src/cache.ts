import path from "node:path"
import fs from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { z } from "zod"
import { specPaths } from "./paths.ts"
import { pathExists, readText } from "./fs.ts"
import type { FileEvidence } from "./evidence.ts"
import { sha256 } from "./hash.ts"

export type FileCache = {
  version: 3
  hash: string
  files: FileEvidence[]
}

const strings = z.array(z.string())
const fileField = { file: z.string() }
const optionalLine = { startLine: z.number().int().optional() }
const evidenceSchema = z.object({
  relative: z.string(), hash: z.string(), kind: z.enum(["script", "style", "json", "other"]), content: z.string(),
  components: z.array(z.object({
    name: z.string(), file: z.string(), exportName: z.string(), isDefault: z.boolean(), exported: z.boolean(),
    props: z.array(z.object({ name: z.string(), type: z.string().optional(), required: z.boolean(), values: strings.optional() }).passthrough()),
    variants: strings, sizes: strings, composition: strings, classNames: strings, startLine: z.number().int(),
  }).passthrough()),
  classes: z.array(z.object({ ...fileField, ...optionalLine, classes: strings, dynamic: z.boolean(), exported: z.boolean(), kind: z.enum(["jsx", "cva", "const", "css"]), componentName: z.string().optional() }).passthrough()),
  imports: z.array(z.object({ ...fileField, source: z.string(), names: strings, defaultName: z.string().optional(), isTypeOnly: z.boolean() }).passthrough()),
  jsx: z.array(z.object({ ...fileField, tag: z.string(), isComponent: z.boolean(), classes: strings, attributes: z.record(z.string(), z.string()), startLine: z.number().int(), selfClosing: z.boolean() }).passthrough()),
  comments: z.array(z.object({ ...fileField, text: z.string(), startLine: z.number().int() }).passthrough()),
  sections: z.array(z.object({ ...fileField, nameHint: z.string().optional(), startLine: z.number().int(), tags: strings, components: strings, classFamilies: strings, childCount: z.number(), depth: z.number(), heading: z.string().optional() }).passthrough()),
  images: z.array(z.object({ ...fileField, tag: z.string(), src: z.string().optional(), startLine: z.number().int(), nextImage: z.boolean(), placeholder: z.boolean() }).passthrough()),
  cssVariables: z.array(z.object({ name: z.string(), value: z.string(), line: z.number().int().optional(), scope: z.string().optional(), mode: z.string().optional(), important: z.boolean().optional() }).passthrough()),
  exportedClassConstants: strings,
}).passthrough()

const cacheSchema = z.object({ version: z.literal(3), hash: z.string(), files: z.array(evidenceSchema) })

export async function loadCache(root: string): Promise<FileCache | undefined> {
  const file = path.join(specPaths(root).cache, "evidence.json")
  const raw = await readText(file)
  if (!raw) return undefined
  try {
    const parsed = cacheSchema.safeParse(JSON.parse(raw))
    if (!parsed.success) return undefined
    const paths = parsed.data.files.map((item) => item.relative)
    if (new Set(paths).size !== paths.length) return undefined
    if (paths.some((relative) => path.isAbsolute(relative) || relative.split(/[\\/]/).includes(".."))) return undefined
    if (parsed.data.files.some((item) => item.hash !== sha256(item.content))) return undefined
    if (parsed.data.hash !== sha256(parsed.data.files.map((item) => `${item.relative}\0${item.hash}`).join("\0"))) return undefined
    return parsed.data as FileCache
  } catch {
    return undefined
  }
}

export async function saveCache(root: string, cache: FileCache): Promise<void> {
  const directory = specPaths(root).cache
  const file = path.join(directory, "evidence.json")
  await fs.mkdir(directory, { recursive: true })
  const temporary = path.join(directory, `evidence-${randomUUID()}.tmp`)
  try {
    await fs.writeFile(temporary, `${JSON.stringify(cache)}\n`, "utf8")
    await fs.rename(temporary, file)
  } finally {
    await fs.rm(temporary, { force: true })
  }
}

export async function clearCache(root: string): Promise<void> {
  const dir = specPaths(root).cache
  if (await pathExists(dir)) await fs.rm(dir, { recursive: true, force: true })
}
