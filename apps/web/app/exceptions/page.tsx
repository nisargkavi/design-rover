import { getModel } from "../../lib/data.ts"

export default async function Page() {
  const model = await getModel()
  return (
    <>
      <p className="kicker">Exceptions</p>
      <h1>Explicit, not a weakened system.</h1>
      {(model?.exceptions ?? []).map((item) => (
        <div className="item" key={item.id}>
          <h3>{item.name}</h3>
          <p>{item.reason}</p>
          <div className="meta">{item.scope.paths.join(" · ")}</div>
        </div>
      ))}
    </>
  )
}
