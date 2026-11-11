import { describe, expect, it } from "vitest"
import { analyzeConventions } from "../packages/core/src/analyzers/conventions.ts"
import { extractFileEvidence } from "../packages/core/src/parse.ts"
import type { RepoEvidence } from "../packages/core/src/evidence.ts"

function imageConvention(content: string, dependencies: Record<string, string> = { react: "19", wxt: "0.21" }) {
  const evidence: RepoEvidence = {
    root: "/repo", tsconfigPaths: {}, packageJson: { dependencies },
    files: [extractFileEvidence({ relative: "App.tsx", content, hash: content, kind: "script" })],
  }
  return analyzeConventions(evidence).find((item) => item.id === "convention.images")!
}

describe("framework-aware image conventions", () => {
  it("treats a browser extension's native image as normal source evidence", () => {
    const convention = imageConvention('export function Header(){return <img src="/icon.svg" alt="App"/>}')
    expect(convention.metric).toEqual({ numerator: 1, denominator: 1, label: "native img" })
    expect(convention.inference).toContain("uses native <img>")
    expect(convention.guidance).toContain("asset paths and accessibility attributes")
    expect(JSON.stringify(convention)).not.toMatch(/still uses|raw <img>|prefers next\/image|Use next\/image/)
  })

  it("does not recommend next/image just because Next is a dependency", () => {
    const convention = imageConvention('export default function Page(){return <img src="/icon.svg" alt="App"/>}', { next: "15", react: "19" })
    expect(convention.inference).toContain("uses native <img>")
    expect(convention.guidance).not.toContain("next/image")
  })

  it("retains a preference established by actual next/image imports and usage", () => {
    const convention = imageConvention('import Image from "next/image"; export default function Page(){return <><Image src="/one.png" alt="One"/><Image src="/two.png" alt="Two"/><img src="/badge.svg" alt="Badge"/></>}', { next: "15", react: "19" })
    expect(convention.metric).toEqual({ numerator: 2, denominator: 3, label: "next/image" })
    expect(convention.inference).toContain("prefers next/image")
    expect(convention.guidance).toBe("Use next/image for application images.")
  })

  it("recognizes an aliased next/image import", () => {
    const convention = imageConvention('import NextImage from "next/image"; export function Page(){return <NextImage src="/one.png" alt="One"/>}')
    expect(convention.metric).toEqual({ numerator: 1, denominator: 1, label: "next/image" })
    expect(convention.guidance).toContain("Use next/image")
  })

  it("keeps native and aliased Next images on the same line distinct", () => {
    const convention = imageConvention('import NextImage from "next/image"; export function Page(){return <><img src="/badge.svg"/><NextImage src="/one.png"/></>}')
    expect(convention.metric).toEqual({ numerator: 1, denominator: 2, label: "next/image" })
    expect(convention.inference).not.toContain("prefers next/image")
  })

  it("does not mistake a local component named Image for next/image", () => {
    const convention = imageConvention('import { Image } from "./Image"; export function Header(){return <Image src="/icon.svg"/>}')
    expect(convention.inference).not.toContain("next/image")
    expect(convention.guidance).not.toContain("next/image")
    expect(convention.observed).toContain("1 other image or placeholder")
  })
})
