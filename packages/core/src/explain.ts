import type { CanonicalModel } from "@design-rover/model"

export function explain(model: CanonicalModel, query: string): string {
  const q = query.trim().toLowerCase()
  if (!q) return "Nothing to explain."

  if (q === "conventions" || q === "convention") {
    if (!model.conventions.length) return "No conventions recorded yet."
    return model.conventions
      .map((item) => `${item.name} [${item.status}]\n  Observed: ${item.observed}\n  ${item.guidance}`)
      .join("\n\n")
  }

  const componentMatches = model.components.filter(
    (item) => item.name.toLowerCase() === q || item.id.toLowerCase() === q,
  )
  if (componentMatches.length > 1) return `Multiple components match. Use an exact ID:\n${componentMatches.map((item) => `${item.id} — ${item.source}`).join("\n")}`
  const component = componentMatches[0]
  if (component) {
    return [
      component.name,
      `Source: ${component.source}`,
      `Import: ${component.importPath}`,
      `Variants: ${component.variants.join(", ") || "none"}`,
      `Sizes: ${component.sizes.join(", ") || "none"}`,
      `Props: ${component.props.map((prop) => `${prop.name}${prop.required ? "" : "?"}: ${prop.type ?? "unresolved"}${prop.defaultValue ? ` = ${prop.defaultValue}` : ""}`).join(", ") || "none"}`,
      `Props resolution: ${component.propsResolution?.status ?? "not recorded"}`,
      ...(component.propsResolution?.issues.map((issue) => `  ${issue}`) ?? []),
      `Architecture: ${component.architecture}`,
      `Usage: ${component.usage.reduce((sum, item) => sum + item.count, 0)} call sites in ${component.usage.length} files`,
      `Status: ${component.status}`,
    ].join("\n")
  }

  const patternMatches = model.patterns.filter(
    (item) => item.name.toLowerCase() === q || item.id.toLowerCase() === q,
  )
  if (patternMatches.length > 1) return `Multiple patterns match. Use an exact ID:\n${patternMatches.map((item) => item.id).join("\n")}`
  const pattern = patternMatches[0]
  if (pattern) {
    return [
      `Pattern: ${pattern.name}`,
      `Observed in:`,
      ...pattern.occurrences.map((item) => `  ${item.file}${item.startLine ? `:${item.startLine}` : ""}`),
      `Implementation: ${pattern.implementation}`,
      `Architecture: ${pattern.architecture}`,
      `Similarity: ${Math.round(pattern.similarity * 100)}%`,
      `Status: ${pattern.status}`,
      pattern.guidance,
    ].join("\n")
  }

  const intent = model.intents.find(
    (item) =>
      item.subject.toLowerCase() === q ||
      item.subject.toLowerCase().includes(q) ||
      item.id.toLowerCase() === q,
  )
  if (intent) {
    return [
      intent.subject,
      `Type: ${intent.type}`,
      `Required: ${intent.required}`,
      `Placeholder allowed: ${intent.placeholderAllowed}`,
      `Production asset required: ${intent.productionAssetRequired}`,
      `Status: ${intent.intentStatus} (${intent.status})`,
    ].join("\n")
  }

  const tokens = model.tokens.filter(
    (item) => item.id.toLowerCase() === q || item.name.toLowerCase() === q || item.name.toLowerCase().endsWith(q),
  )
  if (tokens.length) {
    return tokens.map((token) => `${token.id} [${token.status}]\n${token.name}\nValue: ${token.value}\nScope: ${token.scope ?? ":root"}${token.mode ? ` (${token.mode})` : ""}\nCategory: ${token.category}\nOrigin: ${token.origin}`).join("\n\n")
  }

  const convention = model.conventions.find((item) =>
    item.name.toLowerCase().includes(q) || item.id.toLowerCase().includes(q),
  )
  if (convention) {
    return `${convention.name} [${convention.status}]\nObserved: ${convention.observed}\nInference: ${convention.inference}\n${convention.guidance}`
  }

  const exception = model.exceptions.find((item) => item.name.toLowerCase().includes(q))
  if (exception) {
    return `${exception.name}\n${exception.reason}\nAllows: ${exception.allows.join(", ")}\nScope: ${exception.scope.paths.join(", ")}`
  }

  return `No Design Rover entry matched "${query}".`
}

export function searchModel(model: CanonicalModel, query: string) {
  const q = query.trim().toLowerCase()
  return {
    components: model.components.filter((item) =>
      `${item.id} ${item.name} ${item.importPath} ${item.source}`.toLowerCase().includes(q),
    ),
    patterns: model.patterns.filter((item) => `${item.id} ${item.name}`.toLowerCase().includes(q)),
    tokens: model.tokens.filter((item) => `${item.id} ${item.name} ${item.scope ?? ""} ${item.mode ?? ""}`.toLowerCase().includes(q)),
    conventions: model.conventions.filter((item) =>
      `${item.id} ${item.name} ${item.guidance}`.toLowerCase().includes(q),
    ),
    intents: model.intents.filter((item) => item.subject.toLowerCase().includes(q)),
    exceptions: model.exceptions.filter((item) => item.name.toLowerCase().includes(q)),
  }
}
