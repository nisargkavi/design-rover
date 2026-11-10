import { getModel } from "../../lib/data.ts"

export default async function Page() {
  const model = await getModel()
  return (
    <>
      <p className="kicker">Conventions</p>
      <h1>How this repository already works.</h1>
      {(model?.conventions ?? []).map((item) => (
        <div className="item" key={item.id}>
          <h3>{item.name}</h3>
          <div className="meta">{item.status}</div>
          <p>{item.observed}</p>
          <p>{item.guidance}</p>
        </div>
      ))}
    </>
  )
}
