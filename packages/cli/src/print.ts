import pc from "picocolors"
import type { CheckReport, ModelChange, StatusReport, SystemDiff } from "@design-rover/model"

const jsonMode = { enabled: false }

export function setJson(enabled: boolean) {
  jsonMode.enabled = enabled
}

export function isJson() {
  return jsonMode.enabled
}

export function emit(value: unknown) {
  if (jsonMode.enabled) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
  }
}

export function header() {
  if (jsonMode.enabled) return
  process.stdout.write(`\n${pc.bold("Design Rover")}\n\n`)
}

export function line(text = "") {
  if (jsonMode.enabled) return
  process.stdout.write(`${text}\n`)
}

export function dim(text: string) {
  return pc.dim(text)
}

export function statusLabel(status: string) {
  if (status === "synchronized") return pc.green("synchronized")
  if (status === "pending-review") return pc.yellow("pending review")
  if (status === "drift") return pc.yellow("drift")
  return pc.dim(status)
}

export function printStatus(report: StatusReport, extra?: { changes?: ModelChange[] }) {
  if (jsonMode.enabled) {
    emit({ ...report, changes: extra?.changes ?? [] })
    return
  }
  header()
  line(`  System    ${statusLabel(report.syncStatus)}`)
  if (report.lastSyncAt) line(`  Last sync ${dim(report.lastSyncAt)}`)
  line()
  line(`  ${pad(report.counts.components)}  components`)
  line(`  ${pad(report.counts.tokens)}  tokens`)
  line(`  ${pad(report.counts.patterns)}  patterns`)
  line(`  ${pad(report.counts.conventions)}  conventions`)
  line(`  ${pad(report.counts.intents)}  intents`)
  line(`  ${pad(report.counts.exceptions)}  exceptions`)
  const changes = extra?.changes ?? []
  if (changes.length || report.staleGenerated.length) {
    line()
    line("  Changes detected:")
    line()
    printChangeList(changes)
    for (const file of report.staleGenerated) {
      line(`    ${pc.red("!")}  stale ${file}`)
    }
    line()
    line(`  Run ${pc.bold("design-rover sync")} to review.`)
  } else if (report.initialized) {
    line()
    line(`  ${pc.green("✓")}  Canonical model matches the implementation.`)
  } else {
    line()
    line(`  Run ${pc.bold("design-rover init")} to analyze this repository.`)
  }
  line()
}

export function printChangeList(changes: ModelChange[]) {
  if (jsonMode.enabled) return
  for (const change of changes) {
    const mark =
      change.kind === "add"
        ? pc.green("+")
        : change.kind === "remove"
          ? pc.red("-")
          : change.kind === "stale"
            ? pc.red("!")
            : pc.yellow("~")
    line(`    ${mark}  ${label(change.entity)}: ${change.name}`)
    for (const detail of change.details) line(`       ${dim(detail)}`)
  }
}

export function printDiff(diff: SystemDiff) {
  if (jsonMode.enabled) {
    emit(diff)
    return
  }
  header()
  line(`  ${statusLabel(diff.syncStatus)}`)
  line()
  if (!diff.changes.length) {
    line("  No system changes.")
    line()
    return
  }
  printChangeList(diff.changes)
  if (diff.generated.stale.length) {
    line()
    line("  Generated context:")
    for (const file of diff.generated.stale) line(`    ${file}`)
  }
  line()
}

export function printCheck(report: CheckReport) {
  if (jsonMode.enabled) {
    emit(report)
    return
  }
  header()
  line(`  System status: ${statusLabel(report.syncStatus)}`)
  line()
  const fresh = report.diagnostics.filter((item) => !item.baseline)
  const debt = report.diagnostics.filter((item) => item.baseline)
  if (!fresh.length) {
    line(`  ${pc.green("✓")}  No new violations against the approved system.`)
  }
  for (const item of fresh) {
    const mark = item.severity === "error" ? pc.red("✕") : item.severity === "warning" ? pc.yellow("⚠") : pc.cyan("•")
    line(`  ${mark}  ${pc.bold(item.title)}`)
    line(`     ${item.why}`)
    if (item.related) line(`     ${dim(item.related)}`)
    line(`     ${item.action}`)
    line(`     ${dim(item.certainty === "certain" ? "certain" : "inferred")}${item.location?.file ? dim(` · ${item.location.file}${item.location.startLine ? `:${item.location.startLine}` : ""}`) : ""}`)
    line()
  }
  if (debt.length) {
    line(`  ${dim(`${debt.length} baseline findings hidden. Existing debt is not a new violation.`)}`)
    line()
  }
  if (report.preservedArchitecture) {
    line(`  ${pc.green("✓")}  Existing architecture preserved.`)
    line()
  }
}

export function printInitSummary(input: {
  directory: string
  framework: string
  styling: string[]
  counts: StatusReport["counts"]
  pending: number
}) {
  if (jsonMode.enabled) {
    emit(input)
    return
  }
  header()
  line(`  ${input.framework} · ${input.styling.join(" · ") || "unknown styling"}`)
  line()
  line(`  ${pad(input.counts.components)}  components`)
  line(`  ${pad(input.counts.tokens)}  tokens`)
  line(`  ${pad(input.counts.patterns)}  patterns`)
  line(`  ${pad(input.counts.conventions)}  conventions`)
  line(`  ${pad(input.counts.intents)}  intents`)
  line()
  line(`  Canonical model: ${pc.bold(`${input.directory}/`)}`)
  if (input.pending) {
    line()
    line(`  ${input.pending} inferences need review.`)
    line(`  Run ${pc.bold("design-rover sync")} to approve.`)
  }
  line()
}

function pad(value: number): string {
  return String(value).padStart(3, " ")
}

function label(entity: string) {
  return entity[0]?.toUpperCase() + entity.slice(1)
}

export function fail(message: string, code = 1): never {
  if (jsonMode.enabled) {
    emit({ error: message })
  } else {
    process.stderr.write(`${pc.red("Error")}  ${message}\n`)
  }
  process.exit(code)
}

export { pc }
