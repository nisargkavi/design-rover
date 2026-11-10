import { entityId, type ConventionRecord } from "@design-rover/model"
import { isArbitrary } from "../classes.ts"
import type { RepoEvidence } from "../evidence.ts"

function ratio(n: number, d: number): string {
  if (!d) return "0%"
  return `${Math.round((n / d) * 100)}%`
}

export function analyzeConventions(evidence: RepoEvidence): ConventionRecord[] {
  const classHits = evidence.files.flatMap((file) => file.classes)
  const jsxClassHits = classHits.filter((hit) => hit.kind === "jsx")
  const constHits = classHits.filter((hit) => hit.kind === "const" && hit.exported)
  const totalJsx = jsxClassHits.length
  const inline = jsxClassHits.filter((hit) => !hit.exported).length

  const images = evidence.files.flatMap((file) => file.images)
  const nextImages = images.filter((item) => item.nextImage).length
  const imgTags = images.filter((item) => item.tag === "img").length

  const pageFiles = evidence.files.filter((file) =>
    /(^|\/)(page|layout)\.(t|j)sx?$/.test(file.relative),
  )
  const extractedInPages = pageFiles.filter((file) =>
    file.imports.some((item) => item.names.some((name) => /^[A-Z]/.test(name))),
  ).length

  const uiComponents = evidence.files.filter((file) =>
    /(^|\/)components\/ui\//.test(file.relative),
  ).length
  const featureLocal = evidence.files.filter((file) =>
    /(^|\/)(app\/.*\/(components|_components)|features)\//.test(file.relative),
  ).length

  const arbitrary = classHits.flatMap((hit) => hit.classes).filter(isArbitrary)
  const dependencies = { ...(evidence.packageJson?.dependencies as Record<string, unknown> ?? {}), ...(evidence.packageJson?.devDependencies as Record<string, unknown> ?? {}) }
  const hasTailwind = "tailwindcss" in dependencies || evidence.files.some((file) => /tailwind\.config\./.test(file.relative) || /(?:@import\s+["']tailwindcss|@tailwind\b|@theme\b)/.test(file.content))

  const conventions: ConventionRecord[] = []

  if (hasTailwind && totalJsx > 0) {
    conventions.push({
      id: entityId("convention", "inline-tailwind"),
      name: "Inline Tailwind classes",
      category: "styling",
      observed: `${ratio(inline, totalJsx)} of className usages are inline (${inline}/${totalJsx}). Exported class constants: ${constHits.length}.`,
      inference:
        inline / totalJsx >= 0.7
          ? "This repository prefers inline Tailwind styling."
          : "This repository mixes inline classes with extracted class constants.",
      suggestion:
        inline / totalJsx >= 0.7
          ? "Preserve inline styling when generating new UI. Do not introduce class constants without repository precedent."
          : "Match nearby files when choosing inline vs extracted class strings.",
      guidance:
        inline / totalJsx >= 0.7
          ? "Keep static Tailwind classes inline. Do not extract one-off class strings into constants."
          : "Follow the local file's styling pattern rather than introducing a new abstraction.",
      metric: { numerator: inline, denominator: totalJsx, label: "inline className" },
      status: "inferred",
      confidence: totalJsx >= 20 ? "high" : totalJsx >= 8 ? "medium" : "low",
      originKind: "implementation",
      evidence: [
        {
          id: "convention.inline-tailwind:count",
          kind: "class-usage",
          description: `${inline} inline vs ${constHits.length} exported class constants`,
          count: inline,
        },
      ],
    })
  }

  if (pageFiles.length >= 2 && extractedInPages < pageFiles.length / 2) conventions.push({
    id: entityId("convention", "colocated-sections"),
    name: "One-off sections stay colocated",
    category: "architecture",
    observed: `${pageFiles.length} page files. ${extractedInPages} import local PascalCase components.`,
    inference:
      "Page-level sections that are not already shared components should remain in the page file.",
    suggestion:
      "Do not extract unique page sections into shared components just because they could be reusable.",
    guidance:
      "Preserve the author's architecture. Only extract a section when actual reuse already exists.",
    status: "inferred",
    confidence: pageFiles.length >= 5 ? "medium" : "low",
    originKind: "implementation",
    evidence: [
      {
        id: "convention.colocated-sections:pages",
        kind: "file-organization",
        description: `${pageFiles.length} page files observed`,
        count: pageFiles.length,
      },
    ],
  })

  if (images.length) {
    conventions.push({
      id: entityId("convention", "images"),
      name: "Application images",
      category: "assets",
      observed: `${nextImages} next/image usages, ${imgTags} raw <img> tags.`,
      inference:
        nextImages >= imgTags
          ? "This repository prefers next/image for application images."
          : "This repository still uses raw img tags in places.",
      suggestion:
        nextImages >= imgTags
          ? "Use next/image for application images unless an exception exists."
          : "Follow the surrounding file when choosing an image component.",
      guidance:
        nextImages >= imgTags
          ? "Use next/image for application images."
          : "Do not invent an image convention the repository does not follow.",
      metric: {
        numerator: nextImages,
        denominator: images.length,
        label: "next/image",
      },
      status: "inferred",
      confidence: images.length >= 3 ? "high" : "medium",
      originKind: "implementation",
      evidence: [
        {
          id: "convention.images:count",
          kind: "image-usage",
          description: `${nextImages} next/image / ${imgTags} img`,
          count: images.length,
        },
      ],
    })
  }

  if (uiComponents > 0) conventions.push({
    id: entityId("convention", "prefer-existing-primitives"),
    name: "Prefer existing UI primitives",
    category: "architecture",
    observed: `${uiComponents} files under components/ui, ${featureLocal} feature-local component files.`,
    inference: "New UI should reuse existing primitives before creating new ones.",
    suggestion: "Prefer existing UI primitives before creating new ones.",
    guidance:
      "Before creating UI, check Design Rover for an existing component. Do not reinvent primitives.",
    status: "inferred",
    confidence: uiComponents > 0 ? "high" : "medium",
    originKind: "implementation",
    evidence: [
      {
        id: "convention.primitives:ui",
        kind: "file-organization",
        description: `${uiComponents} UI primitive files`,
        count: uiComponents,
      },
    ],
  })

  if (hasTailwind && arbitrary.length > 0) conventions.push({
    id: entityId("convention", "no-new-styling-abstractions"),
    name: "No new styling abstractions without precedent",
    category: "styling",
    observed: `${arbitrary.length} arbitrary Tailwind values. ${constHits.length} exported class constants.`,
    inference:
      "Unusual values and new styling helpers should not be invented automatically.",
    suggestion:
      "Do not convert unusual values into design tokens and do not add styling abstractions without an existing repository precedent.",
    guidance:
      "Do not introduce new styling abstractions without an existing repository precedent. Do not tokenise one-off values.",
    status: "inferred",
    confidence: "low",
    originKind: "implementation",
    evidence: [
      {
        id: "convention.no-abstractions:arbitrary",
        kind: "arbitrary-class",
        description: `${arbitrary.length} arbitrary values observed (not promoted to tokens)`,
        count: arbitrary.length,
      },
    ],
  })

  if (featureLocal > 0 || uiComponents > 0) {
    conventions.push({
      id: entityId("convention", "file-organization"),
      name: "File organization",
      category: "organization",
      observed: `UI primitives: ${uiComponents}. Feature-local components: ${featureLocal}.`,
      inference:
        featureLocal >= uiComponents
          ? "Feature-local components are preferred for product UI."
          : "Shared UI primitives live under a dedicated components directory.",
      suggestion: "Place new files next to existing ones of the same kind.",
      guidance:
        featureLocal >= uiComponents
          ? "Prefer feature-local components. Keep shared primitives in the existing UI directory."
          : "Keep reusable primitives with the existing UI directory. Do not reorganize files.",
      status: "inferred",
      confidence: "medium",
      originKind: "implementation",
      evidence: [
        {
          id: "convention.file-organization:split",
          kind: "file-organization",
          description: `ui=${uiComponents} feature-local=${featureLocal}`,
        },
      ],
    })
  }

  return conventions.sort((a, b) => a.id.localeCompare(b.id))
}
