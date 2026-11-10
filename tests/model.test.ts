import { describe, expect, it } from "vitest"
import { CanonicalModelSchema, stableStringify } from "@design-rover/model"

describe("canonical serialization", () => {
  it("is deterministic", () => {
    const a = stableStringify({ z: 1, a: 2 })
    const b = stableStringify({ a: 2, z: 1 })
    expect(a).toBe(b)
    expect(a.startsWith("{")).toBe(true)
    expect(a.endsWith("\n")).toBe(true)
  })

  it("parses a minimal model", () => {
    const parsed = CanonicalModelSchema.parse({
      system: {
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        repository: { name: "demo" },
        framework: { name: "next" },
        styling: { systems: ["tailwind"] },
      },
    })
    expect(parsed.system.privacy.network).toBe("off")
    expect(parsed.components).toEqual([])
  })
})
