import { getModel } from "../lib/data.ts"

export default async function Page() {
  const model = await getModel()
  if (!model) {
    return (
      <>
        <p className="kicker">Studio</p>
        <h1>No canonical model loaded.</h1>
        <p className="lede">
          Point <code>DESIGN_ROVER_ROOT</code> at a repository and run{" "}
          <code>design-rover init</code>. The hosted layer never becomes the source of truth.
        </p>
      </>
    )
  }

  const counts = [
    [model.components.length, "components"],
    [model.tokens.length, "tokens"],
    [model.patterns.length, "patterns"],
    [model.conventions.length, "conventions"],
    [model.intents.length, "intents"],
    [model.exceptions.length, "exceptions"],
  ] as const

  return (
    <>
      <p className="kicker">{model.system.repository.name}</p>
      <h1>{model.system.syncStatus}</h1>
      <p className="lede">
        {model.system.framework.name}
        {model.system.styling.systems.length ? ` · ${model.system.styling.systems.join(" · ")}` : ""}
        . Your code is the source. Design Rover is the understanding of it.
      </p>
      <div className="counts">
        {counts.map(([n, label]) => (
          <div key={label}>
            <strong>{n}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>
      <div className="row">
        <div className="meta">Last sync</div>
        <div>{model.system.lastSyncAt ?? "never"}</div>
      </div>
      <div className="row">
        <div className="meta">Libraries</div>
        <div>{model.system.componentLibraries.join(", ") || "local"}</div>
      </div>
    </>
  )
}
