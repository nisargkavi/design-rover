# Using Design Rover

Run `bunx design-rover` from the project root, or add `--cwd /absolute/path/to/project`. Use a pinned release such as `bunx design-rover@0.3.4` when reproducibility matters.

## Discover and review

```sh
bunx design-rover init
bunx design-rover diff --json
```

Initialization records observed inventory and leaves inferred conventions, patterns, intents and exceptions pending review. Repeating `init` preserves existing decisions. It does not rewrite application source.

After reviewing a proposed record, copy its ID into the command below:

```sh
bunx design-rover approve <id>
bunx design-rover reject <id>
```

Choose one action for each proposal. `approve` without an ID approves all pending proposals, so use it only after reviewing the complete set. Rejection remembers an inference until material evidence changes.

Inventory starts as observed, not approved policy. Use `approve <component-id>` to accept a component API as a reviewed contract. `reject <approved-id>` revokes an approval, and `approve <rejected-id>` restores it. History records approval and rejection explicitly.

After the implementation changes:

```sh
bunx design-rover diff
bunx design-rover sync
```

`diff` previews changes. `sync` reviews and applies proposed observed updates. `sync --yes` applies those updates without a prompt; it does not turn pending inferred rules into approved policy. Use `approve <id>` or `sync --yes --approve` for explicit approval after review.

Routine sync preserves removals of approved or human-annotated records, including with `--approve`. To retire one, review its removal in `diff` and run `approve <change-id>` explicitly. Moving an unchanged exception comment or image within a file keeps its decision identity and human notes.

## Look up an API or decision

```sh
bunx design-rover query Button --json
bunx design-rover explain <id>
bunx design-rover context "add a billing form" --path app/billing/page.tsx --limit 20 --max-chars 12000 --json
```

`query` searches whole records. `explain` shows readable details. Repeated component names require a source or ID; a Button in one package is not automatically interchangeable with one in another.

Task context prioritizes relevant components and applicable approved decisions. A path narrows results to the relevant repository scope. Observed APIs and approved knowledge are included by default; `--include-pending` opts into unreviewed inferences.

The packet includes whole records and reports omissions when the result count or character budget is exhausted. An omitted decision still needs review. Narrow the request, increase the budget, or retrieve a specific record rather than assuming an incomplete result has no constraints.

## AI agents and MCP

Start with freshness, then retrieve the task context:

```sh
bunx design-rover status --json
bunx design-rover context "update the settings form" --path app/settings/page.tsx --max-chars 12000 --json
```

`status` inspects the repository. `context` and MCP `get_context` read the canonical model without scanning source. If status reports changed observations, review `sync` proposals before relying on the model. Read the referenced implementation before using an API whose resolution is incomplete.

Source inspection (`status`, `diff`, `check` and MCP `get_system`) may refresh the ignored `.design-rover/cache/evidence.json` source-text cache. It does not approve knowledge or rewrite application source. `context` and `get_context` do not refresh this cache.

Generate agent instruction projections with:

```sh
bunx design-rover generate
```

This writes managed AGENTS.md and CLAUDE.md sections, a Cursor rule and an Agent Skill. Notes outside managed blocks are preserved. Customized generated adapters require resolution rather than silent replacement. The projections guide retrieval; `.design-rover/` holds the actual knowledge.

Managed writes refuse symlinked targets or child directories, including `.design-rover/`, before writing. A symlink used to address the repository root itself is supported.

For MCP clients that use an `mcpServers` configuration object:

```json
{
  "mcpServers": {
    "design-rover": {
      "command": "bunx",
      "args": ["design-rover@0.3.4", "mcp", "--cwd", "/absolute/path/to/project"]
    }
  }
}
```

Use `get_context` for bounded task/path retrieval, `get_component` for APIs, and `check_code` for snippet findings. Missing models and ambiguous APIs are reported explicitly. Pending knowledge is opt-in.

## Check changes and adopt gradually

```sh
bunx design-rover check --json
bunx design-rover baseline
bunx design-rover ci --fail-on warning --json
```

`check` reports conformance and drift findings. `baseline` records current findings as existing debt, so review its scope before accepting it. CI supports `--fail-on error`, `warning`, or `none`; the exit status and JSON `ok` field describe the same gate decision.

Confirmed API changes or removal of an approved component are errors. Changes to observed APIs are informational; incomplete type resolution produces advisory findings rather than a confirmed API break. Usage/restyling findings remain warnings, so choose `--fail-on warning` to gate them. The default CI and pre-push gates block errors and stale required guidance.

Missing untracked/local projections do not fail CI or the hook on a fresh checkout. Existing modified guidance and missing Git-tracked guidance do fail. `status` still reports all stale projections, including absent local snapshots, so you can regenerate them for local use.

`--base <ref>` enables Git comparisons for change-oriented workflows. Invalid bases and unreadable canonical records fail explicitly instead of appearing clean. Install a pre-push hook with `bunx design-rover git install` or a GitHub Actions workflow with `bunx design-rover ci install`; existing hooks are preserved, and custom workflows require review.

Approved exceptions match paths using gitignore-style patterns and can additionally constrain a component name or ID. Their `allows` field can name `restyle-spacing`, exact classes, or the broader `local-override`. A color exception does not suppress an unrelated spacing finding.

## Git tracking

Choose whether the model belongs to the team or is local assistance for one developer.

### Shared team model

Commit reviewed canonical records, approval/rejection history and any intentional baseline under `.design-rover/`. Review model changes together with the source changes they describe.

Keep local artifacts out of commits. Recommended ignore entries are:

```gitignore
.design-rover/cache/
.design-rover/generated/
.design-rover/.write*/
.design-rover/.write.lock
.design-rover/.recovery-required.json
```

Choose separately whether to commit generated AGENTS.md, CLAUDE.md, Cursor rules and Agent Skills. Checked-in projections can help agents discover the model, but they must be regenerated when their guidance becomes stale. Do not blanket-ignore the canonical directory if the team expects its decisions to be reviewed in Git.

### Local-only setup

If the model and generated instructions are private local assistance, use exact tool paths in the project's root `.gitignore`:

```gitignore
/.design-rover/
/AGENTS.md
/CLAUDE.md
/.cursor/rules/design-rover.mdc
/.agents/skills/design-rover/
```

Only ignore AGENTS.md and CLAUDE.md this way when they are new tool-generated files. Preserve existing tracked or human-authored instructions; `.gitignore` does not untrack files already committed. Avoid broad patterns such as `.cursor/`, which can hide unrelated project configuration.

Inspect model contents before publishing a repository: source references and design evidence can contain project metadata. Credentials do not belong in the model.

Canonical writes use locking and staged updates with rollback. After an interrupted operation, inspect `.write.lock` and any recovery marker before removing a stale lock. A `.recovery-required.json` marker blocks loads until recovery is complete; retain its referenced backup while restoring the model.

Concurrent changes are checked against the model read by the operation. A conflicting save fails explicitly; reload, review the latest diff and retry. Removing a stale lock alone cannot authorize a partially written model. If `system.json` is missing while canonical records remain, restore the model instead of rerunning initialization over it. Stored repository roots are relative (`.`), so sharing the model does not share your absolute checkout path.

## Supported behavior and limits

Component analysis supports JSX, CVA variants and supported local TypeScript imports/re-exports. Records expose prop-resolution status and issues. External package declarations, complex type expressions, cycles, ambiguous exports and dynamic styling can remain unresolved.

Tokens retain CSS selector/media scope, source identity and importance. Declarations in different files stay distinct because bundle/cascade order is unknown. Tailwind color configuration supports static object literals with nested names and `DEFAULT`; dynamic values remain unresolved and are excluded from default usable context. Token context follows supported `var()` dependencies into compatible theme scopes and reports missing references or cycles. Configuration is parsed, never executed.

Analysis currently reads root project configuration. Per-package tsconfig resolution, inherited configurations and non-React component templates are not fully supported; run from the relevant app root and inspect coverage before relying on a monorepo inventory.

CSS class contracts such as `.btn`/`.field` variants are not represented as React component APIs. A project can follow class-based conventions that the component inventory does not describe.

Checks cover supported component contract drift, basic sizing/restyling, conventions and design intent. A clean check is not proof of complete design-system conformance, visual quality, accessibility or pixel parity. `@shadcn/lint` is an optional enforcement adapter; only compatible approved policies map to its rules.

`studio` opens a local read-only viewer. The separate Next.js viewer reads `DESIGN_ROVER_ROOT`. Hosted viewing requires `DESIGN_ROVER_API`, `DESIGN_ROVER_ORG`, `DESIGN_ROVER_REPO` and `DESIGN_ROVER_TOKEN`; the server requires a nonempty token. Hosted snapshots are in memory and are not durable team collaboration.

Figma/Storybook support currently imports local JSON evidence. It does not fetch either service directly. CLI analysis stays local; uploading a model to a hosted service is a separate action.
