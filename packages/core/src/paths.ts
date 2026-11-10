import path from "node:path"
import { SPEC_DIR } from "@design-rover/model"

export function specDir(root: string): string {
  return path.join(root, SPEC_DIR)
}

export function specPaths(root: string) {
  const dir = specDir(root)
  return {
    dir,
    system: path.join(dir, "system.json"),
    tokens: path.join(dir, "tokens"),
    components: path.join(dir, "components"),
    patterns: path.join(dir, "patterns"),
    intents: path.join(dir, "intents"),
    conventions: path.join(dir, "conventions"),
    exceptions: path.join(dir, "exceptions"),
    generated: path.join(dir, "generated"),
    history: path.join(dir, "history"),
    historyLog: path.join(dir, "history", "events.jsonl"),
    rejections: path.join(dir, "rejections.json"),
    baseline: path.join(dir, "baseline.json"),
    sources: path.join(dir, "sources.json"),
    discrepancies: path.join(dir, "discrepancies.json"),
    cache: path.join(dir, "cache"),
    gitignore: path.join(dir, ".gitignore"),
  }
}

export function toPosix(filePath: string): string {
  return filePath.split(path.sep).join("/")
}

export function relativePosix(root: string, filePath: string): string {
  return toPosix(path.relative(root, filePath))
}
