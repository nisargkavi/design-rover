import { entityId, type TokenRecord } from "@design-rover/model"
import type { RepoEvidence } from "../evidence.ts"
import { shortHash } from "../hash.ts"
import { classReferencesToken, themeTokenNames } from "../token-usage.ts"
import postcss from "postcss"
import { tailwindColors } from "../tailwind-config.ts"
import { variableReferences } from "../token-usage.ts"

function categoryOf(name: string): TokenRecord["category"] {
  const n = name.replace(/^--/, "")
  if (n.startsWith("color-") || n.startsWith("background") || n === "foreground") {
    if (/^(color-)?(red|blue|green|orange|amber|yellow|lime|emerald|teal|cyan|sky|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)/.test(n)) {
      return "color"
    }
    return "semantic-color"
  }
  if (n.startsWith("spacing") || n.startsWith("space")) return "spacing"
  if (n.startsWith("font") || n.startsWith("text") || n.startsWith("tracking") || n.startsWith("leading")) {
    return "typography"
  }
  if (n.startsWith("radius") || n.startsWith("rounded")) return "radius"
  if (n.startsWith("shadow")) return "shadow"
  if (n.startsWith("breakpoint") || n.startsWith("screen") || n.startsWith("container")) {
    return "breakpoint"
  }
  if (n.startsWith("animate") || n.startsWith("ease") || n.startsWith("duration")) return "motion"
  if (n.startsWith("z-")) return "z-index"
  return "other"
}

function usageCount(evidence: RepoEvidence, tokenName: string, theme: boolean, cssReferences: Map<string, number>): number {
  let count = cssReferences.get(tokenName) ?? 0
  for (const file of evidence.files) {
    for (const hit of file.classes) {
      count += hit.classes.filter((cls) => classReferencesToken(cls, tokenName, theme)).length
    }
  }
  return count
}

export function analyzeTokens(evidence: RepoEvidence): TokenRecord[] {
  const tokens = new Map<string, TokenRecord>()
  const cssReferences = new Map<string, number>()
  for (const file of evidence.files.filter((file) => file.kind === "style")) {
    postcss.parse(file.content, { from: file.relative }).walkDecls((declaration) => {
      for (const match of declaration.value.matchAll(/\bvar\(\s*(--[^\s,)]+)\s*(?=[,)])/g)) {
        const name = match[1]!
        cssReferences.set(name, (cssReferences.get(name) ?? 0) + 1)
      }
    })
  }

  for (const file of evidence.files) {
    for (const variable of file.cssVariables) {
      const scope = variable.scope ?? ":root"
      // CSS custom properties are case-sensitive. Hash exact identity rather
      // than allowing slugification to merge case or punctuation variants.
      const id = `${entityId("token", variable.name)}-${shortHash(JSON.stringify([variable.name, scope, file.relative]))}`
      const existing = tokens.get(id)
      const declarations = [
        ...(existing?.evidence ?? []),
        {
          id: `${id}:${file.relative}:${variable.line ?? 0}:${existing?.evidence.length ?? 0}`,
          kind: "css-variable",
          description: `${variable.name} declared as ${variable.value}${variable.important ? " !important" : ""}`,
          location: { file: file.relative, startLine: variable.line },
        },
      ]
      if (existing?.important && !variable.important) {
        tokens.set(id, { ...existing, evidence: declarations })
        continue
      }
      const record: TokenRecord = {
        id,
        name: variable.name,
        category: categoryOf(variable.name),
        value: variable.value,
        scope,
        mode: variable.mode,
        important: variable.important,
        cssVariable: variable.name,
        origin: file.relative,
        usageCount: 0,
        status: "observed",
        confidence: "high",
        originKind: "implementation",
        evidence: declarations,
      }
      // Within one source and scope, important declarations take precedence;
      // the later declaration wins when importance is equal.
      // Distinct files/scopes remain distinct because import/cascade order is unknown.
      tokens.set(id, record)
    }
  }

  for (const file of evidence.files) {
    if (!/tailwind\.config\./.test(file.relative)) continue
    const extracted = tailwindColors(file.relative, file.content)
    for (const color of extracted.colors) {
      const { name } = color
      const value = color.value ?? color.expression
      const id = `${entityId("token", name)}-${shortHash(JSON.stringify([name, ":root", file.relative]))}`
      if (tokens.has(id)) continue
      tokens.set(id, {
        id,
        name,
        category: categoryOf(`color-${name}`),
        value,
        origin: file.relative,
        usageCount: 0,
        status: color.value === undefined ? "inferred" : "observed",
        confidence: color.value === undefined ? "low" : "medium",
        originKind: "implementation",
        notes: color.value === undefined
          ? `Unresolved configuration expression, not a resolved token value: ${color.expression}. ${extracted.issues.join(" ")}`
          : extracted.issues.length ? `Other configuration entries remain unresolved: ${extracted.issues.join(" ")}` : undefined,
        evidence: [
          {
            id: `${id}:config`,
            kind: "tailwind-config",
            description: `${color.path.join(".")}: ${color.value === undefined ? "unresolved expression" : value}`,
            location: { file: file.relative, startLine: color.line },
          },
        ],
      })
      if (color.value !== undefined) for (const reference of variableReferences(color.value)) cssReferences.set(reference, (cssReferences.get(reference) ?? 0) + 1)
    }
  }

  const themeNames = themeTokenNames(evidence)
  const result = [...tokens.values()].map((token) => ({
    ...token,
    usageCount: usageCount(evidence, token.name, themeNames.has(token.name), cssReferences),
  }))
  return result.sort((a, b) => a.id.localeCompare(b.id))
}
