import { loadCanonical } from "@design-rover/core"
import { CanonicalModelSchema, type CanonicalModel } from "@design-rover/model"

export async function getModel(): Promise<CanonicalModel | undefined> {
  const root = process.env.DESIGN_ROVER_ROOT
  if (root) return loadCanonical(root)
  const api = process.env.DESIGN_ROVER_API
  if (api) {
    const org = process.env.DESIGN_ROVER_ORG
    const repo = process.env.DESIGN_ROVER_REPO
    const token = process.env.DESIGN_ROVER_TOKEN
    if (!org || !repo || !token) throw new Error("Hosted viewing requires DESIGN_ROVER_ORG, DESIGN_ROVER_REPO and DESIGN_ROVER_TOKEN.")
    const response = await fetch(`${api.replace(/\/$/, "")}/v1/orgs/${encodeURIComponent(org)}/repos/${encodeURIComponent(repo)}/snapshot`, {
      cache: "no-store",
      headers: { authorization: `Bearer ${token}` },
    })
    if (!response.ok) return undefined
    const snapshot = await response.json() as { model: unknown }
    return CanonicalModelSchema.parse(snapshot.model)
  }
  return undefined
}
