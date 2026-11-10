import { getModel } from "../../lib/data.ts"

export default async function Page() {
  const model = await getModel()
  return (
    <>
      <p className="kicker">Patterns</p>
      <h1>Recurring compositions. Not extraction tasks.</h1>
      {(model?.patterns ?? []).map((item) => (
        <div className="item" key={item.id}>
          <h3>{item.name}</h3>
          <div className="meta">
            {item.architecture} · {Math.round(item.similarity * 100)}% similar · {item.status}
          </div>
          <p>{item.guidance}</p>
          <div className="meta">{item.occurrences.map((occ) => occ.file).join(" · ")}</div>
        </div>
      ))}
    </>
  )
}
