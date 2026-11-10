import { getModel } from "../../lib/data.ts"

export default async function Page() {
  const model = await getModel()
  const items = model?.components ?? []
  return (
    <>
      <p className="kicker">Components</p>
      <h1>What the repository actually has.</h1>
      {items.length === 0 && <p className="empty">No components recorded.</p>}
      {items.map((item) => (
        <a className="item" key={item.id} href={`/components/${item.id}`}>
          <h3>{item.name}</h3>
          <div className="meta">
            {item.source} · {item.importPath}
          </div>
          <div>
            {item.variants.map((variant) => (
              <span className="pill" key={variant}>
                {variant}
              </span>
            ))}
          </div>
        </a>
      ))}
    </>
  )
}
