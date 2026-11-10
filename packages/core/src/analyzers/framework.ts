import type { RepoEvidence } from "../evidence.ts"

export type FrameworkAnalysis = {
  framework: { name: string; version?: string }
  styling: { systems: string[] }
  componentLibraries: string[]
  documentation: string[]
}

function depVersion(
  pkg: Record<string, unknown> | undefined,
  name: string,
): string | undefined {
  const deps = {
    ...((pkg?.dependencies as Record<string, string> | undefined) ?? {}),
    ...((pkg?.devDependencies as Record<string, string> | undefined) ?? {}),
  }
  return deps[name]
}

export function analyzeFramework(evidence: RepoEvidence): FrameworkAnalysis {
  const pkg = evidence.packageJson
  const files = new Set(evidence.files.map((file) => file.relative))
  const styling = new Set<string>()
  const libraries = new Set<string>()
  const documentation: string[] = []

  let framework = { name: "unknown" as string, version: undefined as string | undefined }
  if (depVersion(pkg, "next")) {
    framework = { name: "next", version: depVersion(pkg, "next") }
  } else if (depVersion(pkg, "react-router") || depVersion(pkg, "react-router-dom")) {
    framework = { name: "react-router", version: depVersion(pkg, "react-router-dom") }
  } else if (depVersion(pkg, "vite") && depVersion(pkg, "react")) {
    framework = { name: "vite-react", version: depVersion(pkg, "vite") }
  } else if (depVersion(pkg, "react")) {
    framework = { name: "react", version: depVersion(pkg, "react") }
  } else if (files.has("remix.config.js") || depVersion(pkg, "@remix-run/react")) {
    framework = { name: "remix", version: depVersion(pkg, "@remix-run/react") }
  }

  if (depVersion(pkg, "tailwindcss") || [...files].some((file) => file.includes("tailwind.config"))) {
    styling.add("tailwind")
  }
  if ([...files].some((file) => file.endsWith(".module.css"))) styling.add("css-modules")
  if ([...files].some((file) => file.endsWith(".css"))) styling.add("css")
  if (evidence.files.some((file) => file.cssVariables.length)) styling.add("css-variables")
  if (depVersion(pkg, "styled-components")) styling.add("styled-components")
  if (depVersion(pkg, "@emotion/react") || depVersion(pkg, "@emotion/styled")) {
    styling.add("emotion")
  }

  if (files.has("components.json") || depVersion(pkg, "shadcn")) libraries.add("shadcn/ui")
  if (
    Object.keys({
      ...((pkg?.dependencies as Record<string, string> | undefined) ?? {}),
      ...((pkg?.devDependencies as Record<string, string> | undefined) ?? {}),
    }).some((name) => name.startsWith("@radix-ui/"))
  ) {
    libraries.add("radix")
  }
  if (depVersion(pkg, "@mui/material")) libraries.add("mui")
  if (depVersion(pkg, "antd")) libraries.add("antd")
  libraries.add("local")

  const docs = [
    "README.md",
    "AGENTS.md",
    "CLAUDE.md",
    "components.json",
  ]
  for (const doc of docs) {
    if (files.has(doc)) documentation.push(doc)
  }
  for (const file of files) {
    if (file.startsWith(".cursor/rules/") && file.endsWith(".mdc")) documentation.push(file)
    if (file.includes(".storybook/") || file.endsWith(".stories.tsx")) {
      if (!documentation.includes("storybook")) documentation.push("storybook")
    }
  }

  return {
    framework,
    styling: { systems: [...styling].sort() },
    componentLibraries: [...libraries].sort(),
    documentation: [...new Set(documentation)].sort(),
  }
}
