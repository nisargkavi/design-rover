import { getModel } from "../../lib/data.ts"

export default async function Page() {
  const model = await getModel()
  return (
    <>
      <p className="kicker">Intent</p>
      <h1>What the code is trying to be.</h1>
      {(model?.intents ?? []).map((item) => (
        <div className="item" key={item.id}>
          <h3>{item.subject}</h3>
          <div className="meta">
            {item.type} · {item.intentStatus}
          </div>
          <p>
            required {String(item.required)} · placeholder {String(item.placeholderAllowed)} ·
            production asset {String(item.productionAssetRequired)}
          </p>
        </div>
      ))}
    </>
  )
}
