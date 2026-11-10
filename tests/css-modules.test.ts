import path from "node:path"
import { describe, expect, it } from "vitest"
import { analyzeRepository } from "@design-rover/core"

describe("css modules fixture", () => {
  it("detects css-modules styling without inventing tailwind conventions", async () => {
    const root = path.join(process.cwd(), "fixtures/css-modules")
    const { snapshot } = await analyzeRepository(root)
    expect(snapshot.styling.systems).toContain("css-modules")
    expect(snapshot.components.some((item) => item.name === "Button")).toBe(true)
    expect(snapshot.conventions.find((item) => item.id.includes("inline-tailwind"))).toBeUndefined()
  })
})
