import { parseArgs } from "node:util"
import path from "node:path"
import { createEngine, isInitialized, serializeContext, gateGeneratedStale } from "@design-rover/core"
import { CLI_VERSION, type CanonicalModel, type ModelChange, type ObservedSnapshot } from "@design-rover/model"
import { mapShadcnLint, oxlintFromMap, reconcileSources } from "@design-rover/integrations"
import * as clack from "@clack/prompts"
import {
  emit,
  cliCommand,
  fail,
  header,
  isJson,
  line,
  pc,
  printChangeList,
  printCheck,
  printDiff,
  printInitSummary,
  printNextAction,
  printReadiness,
  printWorkflow,
  onboardingCommands,
  printStatus,
  setJson,
  type WorkflowState,
} from "./print.ts"
import { serveStudio } from "./serve.ts"

const HELP = `
Design Rover
  Your code is the source. Design Rover is the understanding of it.

Usage
  design-rover                 Show system status
  design-rover init            Analyze the repository and write .design-rover/
  design-rover sync            Review observed changes against the canonical model
  design-rover check           Check the codebase against approved knowledge
  design-rover diff            Show canonical system changes
  design-rover explain <name>  Explain a component, pattern, convention, or intent
  design-rover query <q>       Search the canonical model
  design-rover context [task]  Retrieve bounded design context for a task and/or path
  design-rover generate        Write AGENTS.md / CLAUDE.md / Cursor rules / skill
  design-rover history         Show how the canonical system changed
  design-rover baseline        Capture current findings as existing debt
  design-rover ci              CI gate (errors fail, warnings do not)
  design-rover pr              PR-aware summary of this change
  design-rover git install     Install a pre-push hook
  design-rover git hook        Hook entry (used by the installer)
  design-rover ci install      Write .github/workflows/design-rover.yml
  design-rover lint            Map approved conventions to @shadcn/lint
  design-rover serve           Local API for Studio / agents
  design-rover studio          Open the companion web UI
  design-rover mcp             Start the MCP server
  design-rover approve [id]    Accept a proposal or approve a component/record
  design-rover reject <id>     Reject an inference or revoke an approval

Options
  --json          Machine-readable output
  --yes           Non-interactive apply / install
  --version       Print the CLI version
  --cwd <path>    Repository root
  --base <ref>    Git base for incremental / PR / CI
  --path <path>   Context: repository-relative file or directory
  --limit <n>     Context: maximum whole records (default 20, maximum 100)
  --max-chars <n> Context: maximum formatted JSON characters (default 12000)
  --include-pending  Context: include inferences and suggestions for review
  --no-check-freshness  Context: read an unchecked saved snapshot without scanning
  --fail-on <level>   CI: error (default) | warning | none
`

const COMMAND_HELP: Record<string, string> = {
  init: `Design Rover init

Usage
  bunx design-rover init [--cwd <repository>] [--json]

Analyze source and create canonical knowledge. Inferences remain pending until reviewed.
Running init again preserves existing canonical decisions; use diff/sync to review changes.

Options
  --approve       Explicitly approve initial inferences after your own review
  --generate      Write agent guidance during first initialization
  --cwd <path>    Analyze another repository
  --json          Return counts, readiness and next-step commands as JSON

Next
  bunx design-rover diff
  Review evidence, then use the approve or reject command shown for a record.
  bunx design-rover generate
  bunx design-rover context "describe your UI change" --path path/to/ui.tsx
  bunx design-rover check`,
  sync: `Design Rover sync

Usage
  bunx design-rover sync [--yes] [--approve] [--json]

Preview observed changes and pending inferences. No changes are applied without
interactive confirmation or --yes. Pending inferences require explicit approval.
Approved or human-annotated removals require approve <change-id>, even with --approve.

Options
  --yes           Accept observed inventory and updates to already trusted knowledge
  --approve       Also approve pending inferences; combine with --yes after review
  --base <ref>    Compare against a Git base
  --json          Emit the preview, or the remaining diff after --yes

Review one record
  bunx design-rover diff
  Copy its approve or reject command. Those commands apply only that decision.`,
  context: `Design Rover context

Usage
  bunx design-rover context "describe your UI change" --path src/ui.tsx

Retrieve a bounded JSON packet from saved knowledge and check supported source
observations. Stale context includes review/refresh actions; nothing is synced or
approved automatically. Run the actions from freshness.actions.cwd, then retry.

Options
  --path <path>       Repository-relative file or directory
  --limit <n>         Whole-record limit (default 20, maximum 100)
  --max-chars <n>     Formatted JSON budget (default 12000)
  --include-pending  Include unapproved entries for review, not as approved policy
  --no-check-freshness  Read an unchecked snapshot without inspecting source
  --cwd <path>       Repository root
  --json             Same bounded JSON representation (no extra prose)

If the packet is incomplete, narrow the task/path or increase its limits.`,
}

function countsOf(model: CanonicalModel | ObservedSnapshot) {
  return {
    components: model.components.length, tokens: model.tokens.length,
    patterns: model.patterns.length, conventions: model.conventions.length,
    intents: model.intents.length, exceptions: model.exceptions.length,
  }
}

function workflowFor(model: CanonicalModel, staleGenerated: string[], cwd?: string): WorkflowState {
  const apiResolution = { resolved: 0, partial: 0, unresolved: 0, untyped: 0, unknown: 0 }
  for (const component of model.components) apiResolution[component.propsResolution?.status ?? "unknown"] += 1
  return {
    pending: [...model.components, ...model.tokens, ...model.patterns, ...model.conventions, ...model.intents, ...model.exceptions].filter((item) => item.status === "inferred" || item.status === "suggested").length,
    generatedFiles: model.system.generated.length,
    staleGenerated,
    cwd,
    contextPath: model.components.find((item) => !item.local)?.source ?? model.components[0]?.source,
    incompleteApiId: model.components.find((item) => item.propsResolution?.status === "partial" || item.propsResolution?.status === "unresolved")?.id,
    apiResolution,
  }
}

function observedSyncChange(change: ModelChange): boolean {
  if (change.entity === "projection") return false
  const before = change.before as { status?: string } | undefined
  if (before?.status === "inferred" || before?.status === "suggested") return false
  return change.entity === "component" || change.entity === "token" || before?.status === "approved" || before?.status === "observed"
}

function protectedRemoval(change: ModelChange): boolean {
  const before = change.before as { status?: string; notes?: string; approvedBy?: string; originKind?: string } | undefined
  return change.kind === "remove" && Boolean(before && (before.status === "approved" || before.notes !== undefined || before.approvedBy !== undefined || before.originKind === "human"))
}

async function main() {
  const args = process.argv.slice(2)
  const boundary = args.indexOf("--")
  setJson((boundary < 0 ? args : args.slice(0, boundary)).some((arg) => arg === "--json" || arg.startsWith("--json=")))
  const parsed = parseArgs({
    args,
    allowPositionals: true,
    options: {
      json: { type: "boolean", default: false },
      yes: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
      version: { type: "boolean", short: "v", default: false },
      cwd: { type: "string" },
      base: { type: "string" },
      path: { type: "string" },
      limit: { type: "string" },
      "max-chars": { type: "string" },
      "include-pending": { type: "boolean", default: false },
      "no-check-freshness": { type: "boolean", default: false },
      "fail-on": { type: "string", default: "error" },
      approve: { type: "boolean", default: false },
      generate: { type: "boolean", default: false },
      port: { type: "string", default: "4310" },
    },
  })

  setJson(Boolean(parsed.values.json))
  if (parsed.values.help || parsed.positionals[0] === "help") {
    const topic = parsed.positionals[0] === "help" ? parsed.positionals[1] : parsed.positionals[0]
    const help = COMMAND_HELP[topic ?? ""] ?? HELP.trim()
    if (isJson()) emit({ command: topic ?? null, help })
    else process.stdout.write(`${help}\n`)
    return
  }

  if (parsed.values.version) {
    if (isJson()) emit({ name: "design-rover", version: CLI_VERSION })
    else process.stdout.write(`${CLI_VERSION}\n`)
    return
  }
  const root = path.resolve(parsed.values.cwd ?? process.cwd())
  const command = parsed.positionals[0] ?? "status"
  const rest = parsed.positionals.slice(1)
  const engine = await createEngine(root)
  const commandCwd = parsed.values.cwd ? root : undefined

  if (command === "status" || command === undefined) {
    const report = await engine.status()
    const extra = report.initialized ? await engine.syncPreview({ incremental: true }) : undefined
    printStatus(report, { changes: extra?.diff.changes, workflow: extra?.model ? workflowFor(extra.model, report.staleGenerated, commandCwd) : { pending: 0, generatedFiles: 0, staleGenerated: [], cwd: commandCwd } })
    return
  }

  if (command === "init") {
    const result = await engine.init({
      approve: Boolean(parsed.values.approve),
      generate: Boolean(parsed.values.generate),
    })
    const workflow = workflowFor(result.model, result.diff.generated.stale, commandCwd)
    printInitSummary({
      directory: path.relative(root, engine.specDir),
      framework: result.model.system.framework.name,
      styling: result.model.system.styling.systems,
      counts: countsOf(result.model),
      pending: workflow.pending,
      created: !engine.initialized,
      observedCounts: countsOf(result.snapshot),
      syncStatus: result.diff.syncStatus,
      pendingChanges: result.diff.changes.length,
      generatedFiles: workflow.generatedFiles,
      staleGenerated: workflow.staleGenerated,
      apiResolution: workflow.apiResolution!,
      nextSteps: onboardingCommands(workflow, result.diff.changes.some((change) => change.entity !== "projection")),
      ignoredOptions: engine.initialized ? [parsed.values.approve ? "--approve" : undefined, parsed.values.generate ? "--generate" : undefined].filter((item): item is string => Boolean(item)) : [],
      workflow,
    })
    return
  }

  if (command === "sync") {
    const preview = await engine.syncPreview({ incremental: true, base: parsed.values.base })
    if (!preview.model) fail("Design Rover is not initialized. Run " + cliCommand("init", commandCwd) + ".")
    const workflow = workflowFor(preview.model, preview.diff.generated.stale, commandCwd)
    const selected = preview.diff.changes.filter((change) => !protectedRemoval(change) && (parsed.values.approve ? change.entity !== "projection" : observedSyncChange(change)))
    if (!isJson()) printDiff(preview.diff, workflow)
    if (!parsed.values.yes) {
      if (!selected.length) {
        if (!isJson()) {
          line(workflow.pending ? "  Pending inferences were left unchanged. Review their evidence, then approve or reject individual records." : "  Preview only. No observation updates need applying.")
          if (!workflow.generatedFiles || workflow.staleGenerated.length) printNextAction(cliCommand("generate", commandCwd), "Refresh agent guidance without approving pending inferences.")
          line()
        }
        if (isJson()) emit(preview.diff)
        return
      }
      if (isJson() || !process.stdin.isTTY) {
        if (isJson()) emit(preview.diff)
        else {
          line("  Preview only. No changes were applied.")
          printNextAction(cliCommand("sync --yes" + (parsed.values.approve ? " --approve" : ""), commandCwd), parsed.values.approve ? "After review, explicitly accept updates and approve pending inferences." : "After review, accept observed updates; leave pending inferences unapproved.")
          line()
        }
        return
      }
      const apply = await clack.confirm({
        message: parsed.values.approve ? "Apply reviewed changes and explicitly approve pending inferences?" : "Apply observed updates and refresh guidance? Pending inferences remain unapproved.",
        initialValue: false,
      })
      if (clack.isCancel(apply) || !apply) {
        line("  Left unchanged.")
        line()
        return
      }
    }
    await engine.applyChanges(selected.map((change) => change.id), {
      generate: true,
      approveInferred: Boolean(parsed.values.approve),
    })
    const after = await engine.syncPreview({ incremental: true })
    if (isJson()) {
      emit(after.diff)
      return
    }
    const next = workflowFor(after.model!, after.diff.generated.stale, commandCwd)
    line(parsed.values.approve ? "  Applied reviewed changes and explicit inference approvals. Generated guidance refreshed." : "  Applied observed updates. Generated guidance refreshed; unreviewed inferences remain unapproved.")
    if (next.pending) line("  " + next.pending + " inferences still need an approve or reject decision.")
    printWorkflow(next, { changes: after.diff.changes.some((change) => change.entity !== "projection") })
    line()
    return
  }

  if (command === "check") {
    if (!(await isInitialized(root))) fail("Design Rover is not initialized. Run " + cliCommand("init", commandCwd) + ".")
    const result = await engine.check({ base: parsed.values.base })
    printCheck(result.report, workflowFor(result.model, await engine.generatedStale(), commandCwd))
    const freshErrors = result.report.diagnostics.filter(
      (item) => !item.baseline && item.severity === "error",
    )
    if (freshErrors.length) process.exitCode = 1
    return
  }

  if (command === "diff") {
    const preview = await engine.syncPreview({ incremental: true, base: parsed.values.base })
    if (!preview.model) fail("Design Rover is not initialized. Run `design-rover init`.")
    printDiff(preview.diff, workflowFor(preview.model, preview.diff.generated.stale, commandCwd))
    return
  }

  if (command === "explain") {
    const query = rest.join(" ")
    if (!query) fail("Usage: design-rover explain <name>")
    const text = await engine.explain(query)
    if (isJson()) emit({ query, text })
    else {
      header()
      line(text)
      line()
    }
    return
  }

  if (command === "context") {
    const packet = await engine.context({
      query: rest.join(" ") || undefined,
      path: parsed.values.path,
      includePending: Boolean(parsed.values["include-pending"]),
      limit: parsed.values.limit === undefined ? undefined : Number(parsed.values.limit),
      maxChars: parsed.values["max-chars"] === undefined ? undefined : Number(parsed.values["max-chars"]),
      checkFreshness: !parsed.values["no-check-freshness"],
    })
    // This command has one bounded representation, with or without --json.
    process.stdout.write(serializeContext(packet))
    return
  }

  if (command === "query") {
    const query = rest.join(" ")
    if (!query) fail("Usage: design-rover query <text>")
    const result = await engine.search(query)
    if (isJson()) emit(result)
    else {
      header()
      if (!result) fail("Design Rover is not initialized.")
      line("  Components")
      for (const item of result.components.slice(0, 12)) line(`    ${item.name}  ${pc.dim(item.importPath)}`)
      line("  Patterns")
      for (const item of result.patterns.slice(0, 12)) line(`    ${item.name}`)
      line("  Tokens")
      for (const item of result.tokens.slice(0, 12)) line(`    ${item.name}`)
      line()
    }
    return
  }

  if (command === "generate") {
    const generated = await engine.generate({ writeRepoFiles: true })
    if (isJson()) emit(generated.files)
    else {
      header()
      line("  Wrote agent guidance from canonical knowledge:")
      for (const file of generated.files) line(`    ${file.path}`)
      const model = (await engine.load())!
      const workflow = workflowFor(model, await engine.generatedStale(), commandCwd)
      printReadiness(workflow)
      printWorkflow(workflow)
      line()
    }
    return
  }

  if (command === "history") {
    const data = await engine.history()
    if (isJson()) emit(data)
    else {
      header()
      if (data.git.length) {
        for (const item of data.git) line(`  ${item.at}  ${item.summary}`)
      }
      for (const event of data.events.slice(0, 20)) {
        line(`  ${event.ts.slice(0, 10)}  ${event.summary}`)
      }
      if (!data.git.length && !data.events.length) line("  No history yet.")
      line()
    }
    return
  }

  if (command === "baseline") {
    await engine.baseline()
    if (isJson()) emit({ ok: true })
    else {
      header()
      line("  Captured current findings as existing debt.")
      line("  New violations will still fail CI.")
      line()
    }
    return
  }

  if (command === "approve") {
    const model = await engine.applyChanges(rest.length ? rest : undefined, {
      approveInferred: rest.length === 0,
      generate: true,
    })
    if (isJson()) emit({ ok: true })
    else {
      line("  Approved the selected decision and refreshed agent guidance.")
      const workflow = workflowFor(model, await engine.generatedStale(), commandCwd)
      printReadiness(workflow)
      printWorkflow(workflow)
    }
    line()
    return
  }

  if (command === "reject") {
    if (!rest.length) fail("Usage: design-rover reject <id>")
    const model = await engine.applyChanges(rest, { reject: true, generate: false })
    if (isJson()) emit({ ok: true })
    else {
      line("  Rejected. A changed inference can be reviewed again when its evidence changes.")
      const workflow = workflowFor(model, await engine.generatedStale(), commandCwd)
      printReadiness(workflow)
      printWorkflow(workflow)
    }
    line()
    return
  }

  if (command === "ci") {
    if (rest[0] === "install") {
      const dest = await engine.installGithubWorkflow()
      if (isJson()) emit({ path: dest })
      else {
        header()
        line(`  Wrote ${dest}`)
        line()
      }
      return
    }
    if (!(await isInitialized(root))) fail("Design Rover is not initialized.")
    const result = await engine.check({ base: parsed.values.base })
    const failOn = parsed.values["fail-on"] ?? "error"
    if (!["error", "warning", "none"].includes(failOn)) fail("--fail-on must be error, warning, or none.")
    const fresh = result.report.diagnostics.filter((item) => !item.baseline)
    const errors = fresh.filter((item) => item.severity === "error")
    const warnings = fresh.filter((item) => item.severity === "warning")
    const stale = await gateGeneratedStale(root, result.model)
    const shouldFail = failOn === "none" ? false : failOn === "warning" ? errors.length + warnings.length + stale.length > 0 : errors.length + stale.length > 0
    if (isJson()) {
      emit({
        ok: !shouldFail,
        errors,
        warnings,
        info: fresh.filter((item) => item.severity === "info"),
        staleGenerated: stale,
      })
    } else {
      printCheck(result.report, workflowFor(result.model, stale, commandCwd))
    }
    if (process.env.GITHUB_STEP_SUMMARY) {
      const { writeFile } = await import("node:fs/promises")
      await writeFile(
        process.env.GITHUB_STEP_SUMMARY,
        prMarkdown(result),
        "utf8",
      )
    }
    if (shouldFail) process.exitCode = 1
    return
  }

  if (command === "pr") {
    const result = await engine.check({ base: parsed.values.base ?? "origin/main" })
    const preview = await engine.syncPreview({ base: parsed.values.base ?? "origin/main" })
    const introduced = result.report.diagnostics.filter(
      (item) => !item.baseline && item.introducedByChange !== false,
    )
    const payload = {
      changes: preview.diff.changes,
      issues: introduced,
    }
    if (isJson()) emit(payload)
    else {
      header()
      line("  This change:")
      line()
      printChangeList(preview.diff.changes)
      line()
      if (introduced.length) {
        line("  Potential issues:")
        line()
        for (const item of introduced) {
          line(`  ${pc.yellow("⚠")}  ${item.title}`)
          line(`     ${item.why}`)
        }
      } else {
        line(`  ${pc.green("✓")}  No new issues in this change.`)
      }
      line()
    }
    return
  }

  if (command === "git") {
    if (rest[0] === "install") {
      const dest = await engine.installGitHook()
      header()
      line(`  Installed ${dest}`)
      line("  The hook never rewrites application source.")
      line()
      return
    }
    if (rest[0] === "hook") {
      const preview = await engine.syncPreview({ incremental: true })
      if (preview.diff.changes.length) {
        process.stderr.write("Design Rover: canonical model may be out of date. Run `design-rover sync`.\n")
        printChangeList(preview.diff.changes)
      }
      const result = await engine.check()
      const errors = result.report.diagnostics.filter((item) => !item.baseline && item.severity === "error")
      const stale = await gateGeneratedStale(root, result.model)
      if (errors.length || stale.length) {
        printCheck(result.report)
        for (const file of stale) line(`  Stale required guidance: ${file}. Run ${cliCommand("generate", commandCwd)}.`)
        process.exitCode = 1
      }
      return
    }
    fail("Usage: design-rover git install")
  }

  if (command === "lint") {
    const model = await engine.load()
    if (!model) fail("Design Rover is not initialized.")
    const mapping = mapShadcnLint(model)
    if (rest[0] === "install") {
      const { writeText } = await import("@design-rover/core")
      const dest = path.join(engine.specDir, "generated/oxlintrc.shadcn.json")
      await writeText(dest, oxlintFromMap(mapping), root)
      header()
      line(`  Wrote ${dest}`)
      line("  This is a recommendation. @shadcn/lint stays optional.")
      line("  Design Rover is not affiliated with shadcn.")
      line()
      return
    }
    if (isJson()) emit(mapping)
    else {
      header()
      line("  @shadcn/lint is an optional enforcement engine.")
      line("  Design Rover does not reimplement its rules.")
      line()
      for (const item of mapping.mapped) {
        line(`  ${item.convention}`)
        line(`    → ${item.rule}`)
      }
      if (!mapping.mapped.length) line("  No approved conventions map to @shadcn/lint yet.")
      line()
      line("  Run `design-rover lint install` to write a recommended Oxlint fragment.")
      line()
    }
    return
  }

  if (command === "sources") {
    const model = await engine.load()
    if (!model) fail("Design Rover is not initialized.")
    if (rest[0] === "add") {
      const kind = rest[1] as "figma" | "storybook"
      const location = rest[2]
      if (!kind || !location) fail("Usage: design-rover sources add <figma|storybook> <path>")
      const { readFile } = await import("node:fs/promises")
      const raw = JSON.parse(await readFile(location, "utf8")) as {
        records?: { subject: string; property: string; value: string }[]
      }
      const codeValues = model.tokens.map((token) => ({
        subject: token.name,
        property: "value",
        value: token.value,
      }))
      const discrepancies = reconcileSources(codeValues, {
        kind,
        name: location,
        location,
        records: raw.records,
      })
      const next = {
        ...model,
        sources: [
          ...model.sources,
          {
            id: `${kind}:${location}`,
            kind,
            name: location,
            authority: "evidence" as const,
            location,
            lastImportedAt: new Date().toISOString(),
          },
        ],
        discrepancies: [...model.discrepancies, ...discrepancies],
      }
      await engine.save(next)
      header()
      line(`  Imported ${kind} as evidence (not canonical).`)
      if (discrepancies.length) {
        line()
        line("  Design discrepancy")
        for (const item of discrepancies) {
          line(`    ${item.subject}.${item.property}`)
          line(`      Code: ${item.codeValue}`)
          line(`      Design: ${item.designValue}`)
        }
        line("    [keep code] [keep design] [create exception]")
      }
      line()
      return
    }
    header()
    for (const source of model.sources) line(`  ${source.kind}  ${source.name}  (${source.authority})`)
    if (!model.sources.length) line("  No external sources.")
    line()
    return
  }

  if (command === "serve") {
    const port = Number(parsed.values.port ?? 4310)
    await serveStudio(root, port, false)
    return
  }

  if (command === "studio") {
    const port = Number(parsed.values.port ?? 4310)
    await serveStudio(root, port, true)
    return
  }

  if (command === "mcp") {
    const { startMcp } = await import("@design-rover/mcp")
    await startMcp(root)
    return
  }

  fail(`Unknown command: ${command}\n${HELP}`)
}

function prMarkdown(result: Awaited<ReturnType<Awaited<ReturnType<typeof createEngine>>["check"]>>) {
  const fresh = result.report.diagnostics.filter((item) => !item.baseline)
  const lines = [
    "## Design Rover",
    "",
    `System: ${result.report.syncStatus}`,
    "",
  ]
  if (!fresh.length) lines.push("No new issues in this change.")
  for (const item of fresh) {
    lines.push(`- **${item.title}** — ${item.why}`)
  }
  return `${lines.join("\n")}\n`
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error))
})
