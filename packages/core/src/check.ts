import type {
  CanonicalModel,
  CheckReport,
  Diagnostic,
  ObservedSnapshot,
} from "@design-rover/model"
import { shortHash, sha256 } from "./hash.ts"
import { componentApiSignature, diffModels } from "./diff.ts"
import { extractFileEvidence } from "./parse.ts"
import { usageDiagnostics } from "./usage-check.ts"

function baselineSet(model: CanonicalModel): Set<string> {
  return new Set(model.baseline?.findings.map((item) => item.fingerprint) ?? [])
}

export function checkSystem(
  observed: ObservedSnapshot,
  canonical: CanonicalModel,
  options: { changedFiles?: string[] } = {},
): CheckReport {
  const diagnostics: Diagnostic[] = []
  const baseline = baselineSet(canonical)
  const changed = options.changedFiles === undefined ? undefined : new Set(options.changedFiles)
  const diff = diffModels(observed, canonical)

  const contractChanges = diffModels(observed, { ...canonical, rejections: [] }).changes
  for (const change of contractChanges.filter((item) => item.entity === "component" && (item.kind === "update" || item.kind === "remove"))) {
    const component = change.before as CanonicalModel["components"][number]
    const contextOnly = change.kind === "update" && JSON.stringify(componentApiSignature(component)) === JSON.stringify(componentApiSignature(change.after as typeof component))
    if (component.status === "approved" || component.status === "observed") {
      push(diagnostics, baseline, changed, {
        id: `api-${component.id}`,
        severity: "info",
        title: `${component.name} ${change.kind === "remove" ? "is no longer observed" : contextOnly ? "design context changed" : "API changed"}`,
        why: "The implementation no longer matches the canonical component model.",
        related: change.details.join("; ") || `Canonical component: ${component.source}.`,
        action: "Run `design-rover sync` to review the model update. No code was modified.",
        certainty: "certain",
        fingerprint: change.fingerprint,
        location: { file: component.source },
      })
    }
  }

  for (const intent of canonical.intents.filter((item) => item.status === "approved")) {
    const source = intent.evidence[0]?.location?.file ?? intent.sourceRefs[0]?.location?.file
    const candidates = observed.intents.filter((item) => item.subject === intent.subject && (!source || item.evidence.some((ref) => ref.location?.file === source)))
    const current = observed.intents.find((item) => item.id === intent.id) ?? (candidates.length === 1 ? candidates[0] : undefined)
    const placeholder = current?.intentStatus === "placeholder"
    const needsReview = !current && intent.intentStatus === "placeholder"
    if (intent.productionAssetRequired && (placeholder || needsReview)) {
      push(diagnostics, baseline, changed, {
        id: `intent-${intent.id}`,
        severity: placeholder ? "warning" : "info",
        title: `${intent.subject}`,
        why: placeholder ? "Production image required. Placeholder currently present." : "The previously documented placeholder is no longer observed. Review whether the production asset requirement is resolved or the visual was removed.",
        related: "Documented design intent, not a missing component.",
        action: placeholder ? "Replace the placeholder with a production asset before shipping, or keep the placeholder if this is still intentional." : "Inspect the source and review this requirement with design-rover sync.",
        certainty: placeholder ? "certain" : "inferred",
        fingerprint: shortHash(`intent:${intent.subject}:${placeholder ? "placeholder" : "review"}`),
        location: current?.evidence[0]?.location ?? intent.evidence[0]?.location,
      })
    }
  }

  for (const pattern of observed.patterns) {
    const known = canonical.patterns.find((item) => item.name === pattern.name || item.fingerprint === pattern.fingerprint)
    if (!known && pattern.occurrences.length >= 3) {
      push(diagnostics, baseline, changed, {
        id: `pattern-${pattern.id}`,
        severity: "info",
        title: `Similar composition detected in ${pattern.occurrences.length} files`,
        why: "A recurring UI pattern is not documented yet.",
        related: `${pattern.name}. Architecture: do not extract automatically.`,
        action: "Run `design-rover sync` to document the pattern. Do not extract it into a shared component unless reuse is already real.",
        certainty: "inferred",
        fingerprint: pattern.fingerprint,
        location: { file: pattern.occurrences[0]?.file ?? "" },
      })
    }
  }

  const approvedInline = canonical.conventions.find(
    (item) => item.id.includes("inline-tailwind") && (item.status === "approved" || item.status === "observed"),
  )
  if (approvedInline) {
    const exported = observed.conventions.find((item) => item.id.includes("inline-tailwind"))
    if (exported?.metric && exported.metric.numerator / exported.metric.denominator < 0.5) {
      push(diagnostics, baseline, changed, {
        id: "convention-inline",
        severity: "warning",
        title: "Inline Tailwind convention may be drifting",
        why: "Approved knowledge says this repository keeps static Tailwind classes inline.",
        related: approvedInline.guidance,
        action: "Avoid introducing class constants unless reviewing that convention. No code was modified.",
        certainty: "inferred",
        fingerprint: shortHash("convention:inline-drift"),
      })
    }
  }

  for (const change of diff.changes.filter((item) => item.entity === "token" && item.kind === "add")) {
    push(diagnostics, baseline, changed, {
      id: `token-${change.fingerprint}`,
      severity: "info",
      title: `New token candidate: ${change.name}`,
      why: "A named theme value appeared that is not in the canonical model yet.",
      related: "Unusual one-off values are not tokens.",
      action: "Review with `design-rover sync`. Do not invent tokens from a single unusual value.",
      certainty: "inferred",
      fingerprint: change.fingerprint,
    })
  }

  return {
    syncStatus: diff.syncStatus,
    diagnostics,
    preservedArchitecture: true,
  }
}

export function checkSnippet(
  code: string,
  fileName: string,
  canonical: CanonicalModel,
): Diagnostic[] {
  const file = extractFileEvidence({ relative: fileName, content: code, hash: sha256(code), kind: "script" })
  return usageDiagnostics({ root: "", files: [file], tsconfigPaths: {} }, canonical, { allowUnbound: true })
}

function push(
  diagnostics: Diagnostic[],
  baseline: Set<string>,
  changed: Set<string> | undefined,
  diagnostic: Omit<Diagnostic, "baseline" | "introducedByChange">,
) {
  const isBaseline = baseline.has(diagnostic.fingerprint)
  diagnostics.push({
    ...diagnostic,
    baseline: isBaseline,
    introducedByChange: changed !== undefined
      ? Boolean(diagnostic.location?.file && changed.has(diagnostic.location.file))
      : undefined,
  })
}

export function captureBaseline(report: CheckReport): {
  capturedAt: string
  findings: { fingerprint: string; kind: string; summary: string; location?: Diagnostic["location"] }[]
} {
  return {
    capturedAt: new Date().toISOString(),
    findings: report.diagnostics.map((item) => ({
      fingerprint: item.fingerprint,
      kind: item.severity,
      summary: item.title,
      location: item.location,
    })),
  }
}
