import { getModel } from "../../lib/data.ts"

export default async function Page() {
  const model = await getModel()
  return (
    <>
      <p className="kicker">Tokens</p>
      <h1>Named values that already exist.</h1>
      {(model?.tokens ?? []).map((item) => (
        <div className="item" key={item.id}>
          <h3>{item.name}</h3>
          <div className="meta">
            {item.category} · {item.origin}
          </div>
          <div>{item.value}</div>
        </div>
      ))}
    </>
  )
}
