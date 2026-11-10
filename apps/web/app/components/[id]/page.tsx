import { notFound } from "next/navigation"
import { getModel } from "../../../lib/data.ts"

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const model = await getModel()
  const item = model?.components.find((component) => component.id === id)
  if (!item) notFound()
  return (
    <>
      <p className="kicker">Component</p>
      <h1>{item.name}</h1>
      <div className="row">
        <div className="meta">Source</div>
        <div>{item.source}</div>
      </div>
      <div className="row">
        <div className="meta">Import</div>
        <div>{item.importPath}</div>
      </div>
      <div className="row">
        <div className="meta">Variants</div>
        <div>{item.variants.join(", ") || "none"}</div>
      </div>
      <div className="row">
        <div className="meta">Sizes</div>
        <div>{item.sizes.join(", ") || "none"}</div>
      </div>
      <div className="row">
        <div className="meta">Usage</div>
        <div>
          {item.usage.reduce((sum, entry) => sum + entry.count, 0)} call sites in {item.usage.length} files
        </div>
      </div>
      <div className="row">
        <div className="meta">Architecture</div>
        <div>{item.architecture}</div>
      </div>
    </>
  )
}
