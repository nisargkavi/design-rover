import pc from "picocolors"
import type { CheckReport, ModelChange, StatusReport, SystemDiff } from "@design-rover/model"

export type WorkflowState = {
  pending: number
  generatedFiles: number
  staleGenerated: string[]
  cwd?: string
  contextPath?: string
  incompleteApiId?: string
  apiResolution?: { resolved: number; partial: number; unresolved: number; untyped: number; unknown: number }
}

function quoteArgument(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

export function cliCommand(command: string, cwd?: string): string {
  return `bunx design-rover ${command}${cwd ? ` --cwd ${quoteArgument(cwd)}` : ""}`
}

function contextCommand(state: WorkflowState): string {
  return cliCommand(state.contextPath ? `context --path ${quoteArgument(state.contextPath)}` : 'context "describe your UI change"', state.cwd)
}

export function onboardingCommands(state: WorkflowState, changes = false): string[] {
  return [
    ...(state.pending || changes ? [cliCommand("diff", state.cwd)] : []),
    ...(state.incompleteApiId ? [cliCommand(`explain ${state.incompleteApiId}`, state.cwd)] : []),
    ...(state.generatedFiles === 0 || state.staleGenerated.length ? [cliCommand("generate", state.cwd)] : []),
    contextCommand(state),
    cliCommand("check", state.cwd),
  ]
}

export function printNextAction(command: string, purpose: string) {
  line(`  ${pc.bold(command)}`)
  line(`    ${dim(purpose)}`)
}

export function printReadiness(state?: WorkflowState) {
  if (!state) return
  if (state.pending) line(`  ${pc.yellow(`${state.pending} inferences still need review.`)} They are not approved policy.`)
  if (!state.generatedFiles) line("  Agent guidance has not been generated yet.")
  else if (state.staleGenerated.length) line(`  ${pc.yellow(`${state.staleGenerated.length} generated files are stale.`)}`)
  const incomplete = (state.apiResolution?.partial ?? 0) + (state.apiResolution?.unresolved ?? 0)
  if (incomplete) line(`  ${incomplete} component APIs are partial or unresolved; inspect their source before using them.`)
}

function readinessMetadata(state: WorkflowState) {
  return {
    pending: state.pending,
    generatedFiles: state.generatedFiles,
    staleGenerated: state.staleGenerated,
    apiResolution: state.apiResolution ?? { resolved: 0, partial: 0, unresolved: 0, untyped: 0, unknown: 0 },
  }
}

export function printWorkflow(state: WorkflowState, options: { onboarding?: boolean; changes?: boolean } = {}) {
  line()
  line(options.onboarding ? "  Next steps (run from this repository):" : "  Next:")
  if (state.pending || options.changes) printNextAction(cliCommand("diff", state.cwd), "Review evidence and copy an accept or reject command for each record.")
  if (options.onboarding && state.incompleteApiId) printNextAction(cliCommand(`explain ${state.incompleteApiId}`, state.cwd), "Inspect this partial API and its unresolved evidence.")
  if (!state.generatedFiles || state.staleGenerated.length) printNextAction(cliCommand("generate", state.cwd), state.pending ? "After review, write agent guidance from canonical knowledge." : "Write current agent guidance for this repository.")
  if (options.onboarding || (!state.pending && !options.changes)) {
    printNextAction(contextCommand(state), "Retrieve bounded design context for a UI task or file.")
    printNextAction(cliCommand("check", state.cwd), "Inspect diagnostics after making a change.")
  }
}

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

export function printStatus(report: StatusReport, extra?: { changes?: ModelChange[]; workflow?: WorkflowState }) {
  if (jsonMode.enabled) {
    emit({ ...report, changes: extra?.changes ?? [], ...(extra?.workflow ? { readiness: readinessMetadata(extra.workflow) } : {}) })
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
    for (const file of report.staleGenerated.filter((file) => !changes.some((change) => change.kind === "stale" && change.name === file))) {
      line(`    ${pc.red("!")}  stale ${file}`)
    }
    line()
  } else if (report.initialized && report.syncStatus === "synchronized") {
    line()
    line(`  ${pc.green("✓")}  Canonical model matches the implementation.`)
  } else {
    line()
    if (!report.initialized) printNextAction(cliCommand("init", extra?.workflow?.cwd), "Analyze this repository and leave inferences for review.")
  }
  if (report.initialized) {
    printReadiness(extra?.workflow)
    if (extra?.workflow) printWorkflow(extra.workflow, { changes: changes.some((change) => change.entity !== "projection") })
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
    line(`    ${mark}  ${label(change.entity)}: ${change.name} ${dim(`[${change.id}]`)}`)
    for (const detail of change.details) line(`       ${dim(detail)}`)
  }
}

export function printDiff(diff: SystemDiff, workflow?: WorkflowState) {
  if (jsonMode.enabled) {
    emit(diff)
    return
  }
  header()
  line(`  ${statusLabel(diff.syncStatus)}`)
  line()
  if (!diff.changes.length) {
    line(diff.syncStatus === "pending-review" ? "  Review is still pending; no new observation changes were found." : "  No proposed observation changes.")
    printReadiness(workflow)
    if (workflow) printWorkflow(workflow)
    line()
    return
  }
  printChangeList(diff.changes)
  if (diff.generated.stale.length) {
    line()
    line("  Generated context:")
    for (const file of diff.generated.stale) line(`    ${file}`)
  }
  const review = diff.changes.find((change) => change.entity !== "projection")
  if (review) {
    line()
    line("  After reviewing a record, choose one action (use its ID above):")
    printNextAction(cliCommand(`approve ${review.id}`, workflow?.cwd), "Accept this reviewed change or inference.")
    printNextAction(cliCommand(`reject ${review.id}`, workflow?.cwd), "Or reject it; do not run both commands for the same decision.")
  }
  printReadiness(workflow)
  if (!review && workflow) printWorkflow(workflow)
  line()
}

export function printCheck(report: CheckReport, workflow?: WorkflowState) {
  if (jsonMode.enabled) {
    emit({ ...report, ...(workflow ? { readiness: readinessMetadata(workflow) } : {}) })
    return
  }
  header()
  line(`  System status: ${statusLabel(report.syncStatus)}`)
  line()
  const fresh = report.diagnostics.filter((item) => !item.baseline)
  const debt = report.diagnostics.filter((item) => item.baseline)
  if (!fresh.length) {
    const current = report.syncStatus === "synchronized" && !workflow?.pending && !workflow?.staleGenerated.length
    line(`  ${current ? pc.green("✓") : pc.cyan("•")}  No new diagnostic findings against the approved model.`)
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
    line(`  ${pc.green("✓")}  Check did not modify application source.`)
    line()
  }
  printReadiness(workflow)
  if (workflow && (workflow.pending || workflow.staleGenerated.length || !workflow.generatedFiles || report.syncStatus !== "synchronized")) printWorkflow(workflow, { changes: report.syncStatus === "drift" || report.syncStatus === "pending-review" })
}

export function printInitSummary(input: {
  directory: string
  framework: string
  styling: string[]
  counts: StatusReport["counts"]
  pending: number
  created: boolean
  observedCounts: StatusReport["counts"]
  syncStatus: SystemDiff["syncStatus"]
  pendingChanges: number
  generatedFiles: number
  staleGenerated: string[]
  apiResolution: NonNullable<WorkflowState["apiResolution"]>
  nextSteps: string[]
  ignoredOptions: string[]
  workflow?: WorkflowState
}) {
  if (jsonMode.enabled) {
    const { workflow: _, ...output } = input
    emit(output)
    return
  }
  header()
  line(input.created ? "  Initialized repository design knowledge." : "  Already initialized. Existing canonical knowledge was preserved.")
  line(`  ${input.framework} · ${input.styling.join(" · ") || "unknown styling"}`)
  if (input.framework === "unknown") line("  Root framework is unknown. Non-React templates are not component-checked; monorepos may need per-app configuration.")
  line()
  line(`  ${pad(input.counts.components)}  components`)
  line(`  ${pad(input.counts.tokens)}  tokens`)
  line(`  ${pad(input.counts.patterns)}  patterns`)
  line(`  ${pad(input.counts.conventions)}  conventions`)
  line(`  ${pad(input.counts.intents)}  intents`)
  line(`  ${pad(input.counts.exceptions)}  exceptions`)
  line()
  line(`  Canonical model: ${pc.bold(`${input.directory}/`)}`)
  line(`  System: ${statusLabel(input.syncStatus)}`)
  if (!input.created && JSON.stringify(input.counts) !== JSON.stringify(input.observedCounts)) {
    line(`  Current scan observed ${input.observedCounts.components} components and ${input.observedCounts.tokens} tokens; use diff/sync to review updates.`)
  }
  if (input.ignoredOptions.length) line(`  ${input.ignoredOptions.join(" and ")} only apply during first initialization. Use approve/generate explicitly on an existing model.`)
  const incomplete = input.apiResolution.partial + input.apiResolution.unresolved
  line(`  Component APIs: ${input.apiResolution.resolved} resolved; ${incomplete} partial/unresolved; ${input.apiResolution.untyped} untyped${input.apiResolution.unknown ? `; ${input.apiResolution.unknown} without resolution metadata` : ""}.`)
  if (input.workflow) {
    printReadiness(input.workflow)
    printWorkflow(input.workflow, { onboarding: true, changes: input.pendingChanges > 0 })
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
