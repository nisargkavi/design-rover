import { getModel } from "../../lib/data.ts"

export default async function Page() {
  const model = await getModel()
  return (
    <>
      <p className="kicker">History</p>
      <h1>How understanding changed.</h1>
      {(model?.history ?? []).slice().reverse().map((item) => (
        <div className="item" key={`${item.ts}-${item.summary}`}>
          <h3>{item.summary}</h3>
          <div className="meta">{item.ts}</div>
        </div>
      ))}
    </>
  )
}
