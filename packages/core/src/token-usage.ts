import type { RepoEvidence } from "./evidence.ts"

/** Theme declarations generate utilities; ordinary custom properties do not. */
export function themeTokenNames(evidence: RepoEvidence): Set<string> {
  return new Set(evidence.files.flatMap((file) => file.cssVariables
    .filter((variable) => /(?:^| > )@theme(?:\s|$)/.test(variable.scope ?? ""))
    .map((variable) => variable.name)))
}

function parts(className: string): { variants: string[]; base: string } {
  const values: string[] = []
  let depth = 0
  let start = 0
  for (let index = 0; index < className.length; index += 1) {
    const char = className[index]
    if (char === "\\") { index += 1; continue }
    if (char === "[" || char === "(") depth += 1
    if (char === "]" || char === ")") depth -= 1
    if (char === ":" && depth === 0) {
      values.push(className.slice(start, index))
      start = index + 1
    }
  }
  return { variants: values, base: className.slice(start).replace(/^!|!$/g, "").replace(/^-/, "") }
}

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
const colorUtility = /^(?:bg|text|border(?:-[xytrblse])?|divide|outline|ring(?:-offset)?|fill|stroke|decoration|placeholder|caret|accent|from|via|to|shadow|inset-shadow|text-shadow)-(.+)$/
const spacingUtility = /^(?:p[xytrblse]?|m[xytrblse]?|gap(?:-[xy])?|space-[xy]|size|[wh]|(?:min|max)-[wh]|inset(?:-[xyse])?|top|right|bottom|left|start|end|basis|translate(?:-[xyz])?|scroll-[mp][xytrblse]?)-(.+)$/

/** Static relationships only: whole utility values and explicit CSS-variable references. */
export function classReferencesToken(className: string, tokenName: string, theme = false): boolean {
  const { variants, base } = parts(className)
  if (tokenName.startsWith("--")) {
    const variable = escape(tokenName)
    const unquoted = base.replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g, "")
    if (new RegExp(`var\\(\\s*${variable}(?=[\\s,)])`).test(unquoted)) return true
    if (new RegExp(`^[a-z][a-z-]*-\\((?:[a-z-]+:)?${variable}\\)(?:/[^/]+)?$`).test(base)) return true
    if (!theme) return false
  }
  const name = tokenName.replace(/^--/, "")
  // Legacy/config keys keep their full name. Theme namespaces map to utilities below.
  if (!theme) return base === name || base.endsWith(`-${name}`) || Boolean(base.split("/")[0]?.endsWith(`-${name}`))
  if (name.startsWith("color-")) return colorUtility.exec(base)?.[1]?.split("/")[0] === name.slice(6)
  if (name.startsWith("breakpoint-")) return variants.some((variant) => [name.slice(11), `min-${name.slice(11)}`, `max-${name.slice(11)}`].includes(variant))
  if (name.startsWith("container-")) return base === `max-w-${name.slice(10)}` || variants.some((variant) => variant === `@${name.slice(10)}` || variant === `@max-${name.slice(10)}` || variant === `@min-${name.slice(10)}`)
  if (name === "spacing") return /^\d+(?:\.\d+)?$/.test(spacingUtility.exec(base)?.[1] ?? "")
  if (name.startsWith("spacing-")) return spacingUtility.exec(base)?.[1] === name.slice(8)
  if (name.startsWith("radius-")) return /^rounded(?:-[trblse]{1,2})?-(.+)$/.exec(base)?.[1] === name.slice(7)
  const namespaces: [string, string][] = [
    ["font-weight-", "font"], ["font-", "font"], ["text-", "text"],
    ["tracking-", "tracking"], ["leading-", "leading"], ["shadow-", "shadow"],
    ["inset-shadow-", "inset-shadow"], ["text-shadow-", "text-shadow"],
    ["drop-shadow-", "drop-shadow"], ["blur-", "blur"], ["perspective-", "perspective"],
    ["aspect-", "aspect"], ["ease-", "ease"], ["animate-", "animate"],
  ]
  for (const [prefix, utility] of namespaces) {
    if (name.startsWith(prefix)) return base.split("/")[0] === `${utility}-${name.slice(prefix.length).split("--")[0]}`
  }
  return false
}
