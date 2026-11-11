import { parseArgs } from "node:util"
import path from "node:path"
import { createEngine, isInitialized, serializeContext } from "@design-rover/core"
import { CLI_VERSION } from "@design-rover/model"
import { mapShadcnLint, oxlintFromMap, reconcileSources } from "@design-rover/integrations"
import * as clack from "@clack/prompts"
import {
  emit,
  fail,
  header,
  isJson,
  line,
  pc,
  printChangeList,
  printCheck,
  printDiff,
  printInitSummary,
  printStatus,
  setJson,
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
  design-rover approve [id]    Approve pending inferences
  design-rover reject <id>     Remember a rejected inference

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
  --fail-on <level>   CI: error (default) | warning | none
`

async function main() {
  const parsed = parseArgs({
    args: process.argv.slice(2),
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
      "fail-on": { type: "string", default: "error" },
      approve: { type: "boolean", default: false },
      generate: { type: "boolean", default: false },
      port: { type: "string", default: "4310" },
    },
  })

  if (parsed.values.help || parsed.positionals[0] === "help") {
    process.stdout.write(`${HELP.trim()}\n`)
    return
  }

  setJson(Boolean(parsed.values.json))
  if (parsed.values.version) {
    if (isJson()) emit({ name: "design-rover", version: CLI_VERSION })
    else process.stdout.write(`${CLI_VERSION}\n`)
    return
  }
  const root = path.resolve(parsed.values.cwd ?? process.cwd())
  const command = parsed.positionals[0] ?? "status"
  const rest = parsed.positionals.slice(1)
  const engine = await createEngine(root)

  if (command === "status" || command === undefined) {
    const report = await engine.status()
    const extra = report.initialized ? await engine.syncPreview({ incremental: true }) : undefined
    printStatus(report, { changes: extra?.diff.changes })
    return
  }

  if (command === "init") {
    const result = await engine.init({
      approve: Boolean(parsed.values.approve),
      generate: Boolean(parsed.values.generate),
    })
    printInitSummary({
      directory: path.relative(root, engine.specDir),
      framework: result.snapshot.framework.name,
      styling: result.snapshot.styling.systems,
      counts: {
        components: result.snapshot.components.length,
        tokens: result.snapshot.tokens.length,
        patterns: result.snapshot.patterns.length,
        conventions: result.snapshot.conventions.length,
        intents: result.snapshot.intents.length,
        exceptions: result.snapshot.exceptions.length,
      },
      pending: [...result.model.patterns, ...result.model.conventions, ...result.model.intents, ...result.model.exceptions].filter((item) => item.status === "suggested" || item.status === "inferred").length,
    })
    return
  }

  if (command === "sync") {
    const preview = await engine.syncPreview({ incremental: true, base: parsed.values.base })
    if (!preview.model) fail("Design Rover is not initialized. Run `design-rover init`.")
    if (isJson()) {
      if (parsed.values.yes) {
        await engine.applyChanges(undefined, {
          generate: true,
          approveInferred: Boolean(parsed.values.approve),
        })
      }
      emit(parsed.values.yes ? (await engine.syncPreview()).diff : preview.diff)
      return
    }
    header()
    line("  Scanning changes...")
    line()
    line(`  ${pc.green("✓")}  ${preview.snapshot.components.length} components`)
    line(`  ${pc.green("✓")}  ${preview.snapshot.tokens.length} tokens`)
    line(`  ${pc.green("✓")}  ${preview.snapshot.patterns.length} patterns`)
    line(`  ${pc.green("✓")}  ${preview.snapshot.conventions.length} conventions`)
    line(`  ${pc.green("✓")}  ${preview.snapshot.intents.length} intents`)
    line(`  ${pc.green("✓")}  ${preview.snapshot.exceptions.length} exceptions`)
    line()
    if (preview.evidence && preview.snapshot.incremental && preview.snapshot.changedFiles.length) {
      line(`  ${preview.snapshot.changedFiles.length} relevant files changed.`)
      line("  Re-analyzing affected system areas...")
      line()
    }
    if (!preview.diff.changes.length) {
      line(`  ${pc.green("✓")}  No proposed system changes.`)
      const pending = [
        ...preview.model.patterns.filter((item) => item.status === "suggested"),
        ...preview.model.conventions.filter((item) => item.status === "inferred"),
        ...preview.model.intents.filter((item) => item.status === "suggested"),
      ]
      if (pending.length && (parsed.values.yes || parsed.values.approve)) {
        await engine.applyChanges([], { approveInferred: true, generate: true })
        line(`  Approved ${pending.length} inferred entries.`)
      } else if (pending.length) {
        line()
        line(`  ${pending.length} inferred entries still need approval.`)
        line(`  Run ${pc.bold("design-rover sync --yes --approve")} after review.`)
      }
      line()
      return
    }
    line("  Changes detected:")
    line()
    printChangeList(preview.diff.changes)
    line()
    line("  Proposed changes:")
    preview.diff.changes.forEach((change, index) => {
      line(`    [${index + 1}] ${change.summary}`)
    })
    line()
    if (parsed.values.yes) {
      await engine.applyChanges(undefined, { generate: true, approveInferred: Boolean(parsed.values.approve) })
      line("  Applied. Generated context updated.")
      line()
      return
    }
    if (!process.stdin.isTTY) {
      line("  Pass --yes to apply in non-interactive mode.")
      line()
      return
    }
    const apply = await clack.confirm({
      message: "Apply changes?",
      initialValue: false,
    })
    if (clack.isCancel(apply) || !apply) {
      line("  Left unchanged.")
      line()
      return
    }
    await engine.applyChanges(undefined, { generate: true })
    line("  Applied. Generated context updated.")
    line()
    return
  }

  if (command === "check") {
    if (!(await isInitialized(root))) fail("Design Rover is not initialized. Run `design-rover init`.")
    const result = await engine.check({ base: parsed.values.base })
    printCheck(result.report)
    const freshErrors = result.report.diagnostics.filter(
      (item) => !item.baseline && item.severity === "error",
    )
    if (freshErrors.length) process.exitCode = 1
    return
  }

  if (command === "diff") {
    const preview = await engine.syncPreview({ incremental: true, base: parsed.values.base })
    if (!preview.model) fail("Design Rover is not initialized. Run `design-rover init`.")
    printDiff(preview.diff)
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
      line("  Wrote generated context:")
      for (const file of generated.files) line(`    ${file.path}`)
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
    await engine.applyChanges(rest.length ? rest : undefined, {
      approveInferred: rest.length === 0,
      generate: true,
    })
    if (isJson()) emit({ ok: true })
    else line("  Approved.")
    line()
    return
  }

  if (command === "reject") {
    if (!rest.length) fail("Usage: design-rover reject <id>")
    await engine.applyChanges(rest, { reject: true, generate: false })
    if (isJson()) emit({ ok: true })
    else line("  Remembered. A changed inference can be reviewed again when its evidence changes.")
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
    const stale = await engine.generatedStale()
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
      printCheck(result.report)
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
      if (errors.length) {
        printCheck(result.report)
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
      await writeText(dest, oxlintFromMap(mapping))
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
