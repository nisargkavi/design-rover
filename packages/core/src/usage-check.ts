import { entityId, type CanonicalModel, type Diagnostic } from "@design-rover/model"
import ignore from "ignore"
import { looksLikeSpacingOverride } from "./classes.ts"
import type { RepoEvidence } from "./evidence.ts"
import { shortHash } from "./hash.ts"
import { resolveComponent } from "./component-resolution.ts"

export function exceptionAllows(
  canonical: CanonicalModel,
  file: string,
  component: { name: string; id: string },
  rule: string,
  classes: string[],
): boolean {
  return canonical.exceptions.filter((item) => item.status === "approved").some((item) => {
    if (!item.scope.paths.length && !item.scope.components.length) return false
    if (item.scope.paths.length && !ignore().add(item.scope.paths).ignores(file)) return false
    if (item.scope.components.length && !item.scope.components.some((name) => name === component.name || name === component.id)) return false
    return item.allows.includes(rule) || item.allows.includes("local-override") || (classes.length > 0 && classes.every((value) => item.allows.includes(value)))
  })
}

export function usageDiagnostics(
  evidence: RepoEvidence,
  canonical: CanonicalModel,
  options: { allowUnbound?: boolean } = {},
): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  const components = canonical.components.filter(
    (item) => item.status === "approved" || item.status === "observed",
  )

  for (const file of evidence.files) {
    for (const jsx of file.jsx) {
      const component = resolveComponent(evidence, file, jsx.tag, components, options)
      if (!component) continue
      const inlineOverrides = (jsx.styleProperties ?? []).filter((property) => /^(?:padding(?:Top|Right|Bottom|Left|Inline|InlineStart|InlineEnd|Block|BlockStart|BlockEnd)?|height|width|gap|rowGap|columnGap)$/.test(property)).map((property) => `style:${property}`)
      const overrides = [...jsx.classes.filter(looksLikeSpacingOverride), ...inlineOverrides]
      if (component.sizes.length && overrides.length && !exceptionAllows(canonical, file.relative, component, "restyle-spacing", overrides)) {
        diagnostics.push({
          id: `restyle-${component.name}-${file.relative}-${jsx.startLine}`,
          severity: "warning",
          title: component.name,
          why: `Custom sizing or spacing detected. Existing ${component.name} size variant may apply.`,
          related: `Sizes: ${component.sizes.join(", ") || "none"}. ${overrides.join(" ")}. Import: ${component.importPath}`,
          action: `Consider size="${component.sizes.includes("lg") ? "lg" : component.sizes[0]}". No code was modified.`,
          certainty: "inferred",
          fingerprint: shortHash(`restyle:${component.id === entityId("component", component.name) ? component.name : component.id}:${file.relative}:${jsx.classes.join(" ")}${inlineOverrides.length ? `:${inlineOverrides.join(" ")}` : ""}`),
          location: { file: file.relative, startLine: jsx.startLine },
          baseline: false,
        })
      }
    }
  }

  return diagnostics
}
