const ARBITRARY = /\[[^\]]+\]/
const RAW_COLOR =
  /^(?:bg|text|border|from|to|via|ring|fill|stroke|outline|decoration|accent|caret|divide|shadow)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-\d{2,3}$/

const FAMILY_PREFIXES = [
  "bg",
  "text",
  "border",
  "rounded",
  "p",
  "px",
  "py",
  "pt",
  "pr",
  "pb",
  "pl",
  "m",
  "mx",
  "my",
  "mt",
  "mr",
  "mb",
  "ml",
  "gap",
  "space",
  "flex",
  "grid",
  "col",
  "row",
  "w",
  "h",
  "min",
  "max",
  "font",
  "leading",
  "tracking",
  "shadow",
  "opacity",
  "z",
  "inset",
  "top",
  "right",
  "bottom",
  "left",
  "overflow",
  "items",
  "justify",
  "content",
  "self",
  "place",
  "ring",
  "outline",
  "from",
  "via",
  "to",
  "aspect",
  "object",
  "size",
]

export function splitClasses(value: string): string[] {
  return value
    .split(/\s+/)
    .map((cls) => cls.trim())
    .filter(Boolean)
}

export function stripVariant(cls: string): string {
  let depth = 0
  let start = 0
  for (let index = 0; index < cls.length; index += 1) {
    const char = cls[index]
    if (char === "\\") { index += 1; continue }
    if (char === "[" || char === "(") depth += 1
    else if (char === "]" || char === ")") depth -= 1
    else if (char === ":" && depth === 0) start = index + 1
  }
  return cls.slice(start).replace(/^!|!$/g, "")
}

export function isArbitrary(cls: string): boolean {
  return ARBITRARY.test(stripVariant(cls))
}

export function isRawPaletteColor(cls: string): boolean {
  return RAW_COLOR.test(stripVariant(cls))
}

export function classFamily(cls: string): string {
  const base = stripVariant(cls).replace(/^\-/, "")
  if (isArbitrary(cls)) {
    const name = base.replace(ARBITRARY, "")
    return `${name.replace(/-$/, "") || "arbitrary"}-arbitrary`
  }
  const prefix = FAMILY_PREFIXES.find(
    (item) => base === item || base.startsWith(`${item}-`),
  )
  return prefix ?? base.split("-")[0] ?? base
}

export function looksLikeSpacingOverride(cls: string): boolean {
  const base = stripVariant(cls)
  if (/^(?:w|h|size)-(?:full|auto|fit|min|max|screen|dvw|dvh|svw|svh|lvw|lvh)$/.test(base)) return false
  return /^(?:p|px|py|pt|pr|pb|pl|h|w|size|gap)-/.test(base)
}

export function looksLikeRadiusOverride(cls: string): boolean {
  return /^rounded(?:-|$)/.test(stripVariant(cls))
}
