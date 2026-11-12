---
title: CLI reference
description: Commands and options for analyzing, reviewing, querying and watching a Design Rover project.
---

Run commands from the application root, or pass `--cwd /absolute/path/to/app`. Bun and Node >=20.19.0 are required. No global installation is needed.

```sh
bunx design-rover --help
bunx design-rover --version
bunx design-rover context --help
```

Use `bunx design-rover@<version>` when the command must run a specific release.

## Inspect and retrieve

| Command | Result |
| --- | --- |
| `status` or no command | Check repository freshness, inventory and review readiness. |
| `query <text>` | Search whole saved records. |
| `explain <id-or-name>` | Show a saved record or diagnostic with evidence. |
| `context [task]` | Return bounded JSON context for a query and/or path, with freshness checked by default. |
| `diff` | Preview changes between source observations and saved knowledge. |
| `check` | Report supported conformance and drift findings; errors cause a nonzero exit. |
| `history` | Inspect canonical events and Git history. |

### Context options

```sh
bunx design-rover context "add a settings form" --path src/settings --max-chars 18000 --json
```

| Option | Default | Behavior |
| --- | --- | --- |
| `--path <path>` | None | Repository-relative file or directory. A task query or path is required. |
| `--limit <n>` | `20` | Whole-record limit; integer `1`–`100`. |
| `--max-chars <n>` | `12000` | Complete formatted response budget; integer `1024`–`100000`. |
| `--include-pending` | Off | Include unapproved knowledge for review. |
| `--no-check-freshness` | Off | Read an explicitly unchecked snapshot without scanning source. |

The budget includes metadata, warnings and the final newline, measured in UTF-16 code units. Records are omitted whole when they do not fit. Inspect `coverage` and omission warnings; an omitted decision is still relevant. `context` emits the same bounded JSON with or without `--json`.

See [task context](../guides/context.md) for stale results and refresh actions.

## Initialize, review and refresh

| Command | Behavior |
| --- | --- |
| `init` | Create `.design-rover/` from source. Repeated initialization preserves existing decisions. |
| `approve <id>` | Accept a proposal or approve an existing record. Use a removal change ID to retire protected knowledge. |
| `approve` | Approve all pending proposals; use only after reviewing the complete set. |
| `reject <id>` | Reject an inference or revoke an existing approval. |
| `sync` | Preview updates and, in an interactive terminal, ask before applying. |
| `sync --yes` | Apply observed updates noninteractively; pending rules remain unapproved. |
| `sync --yes --approve` | Explicitly apply updates and approve pending inferences after review. |
| `generate` | Write agent guidance from saved knowledge. |
| `baseline` | Record current findings as existing debt. Review the findings first. |

`init --generate` writes guidance during first initialization. `init --approve` explicitly approves initial inferences; it is not needed for ordinary setup. Neither option replaces review when initializing an existing model.

`sync --json` without `--yes` is a preview. `--approve` alone does not make noninteractive sync apply changes. Approved or human-annotated removals always require explicit acceptance of their removal change ID, including with `--approve`.

See [review decisions](../guides/review.md) before adopting a policy or changing an approved contract.

## Watch for live updates

```sh
bunx design-rover watch --interval 1000 --debounce 300
```

| Option | Default | Behavior |
| --- | --- | --- |
| `--interval <ms>` | `1000` | Poll interval; integer `100`–`60000`. |
| `--debounce <ms>` | `300` | Stability window before refreshing; integer `100`–`60000`. |
| `--generate` | Off | Also regenerate agent guidance. |
| `--json` | Off | Emit one JSON object per line. |

Watch requires an initialized model. It refreshes only observed components and tokens without human annotations. Approved records and policies remain for review. `--approve` and `--yes` are rejected. Stop with Ctrl+C or SIGTERM.

JSON events are `ready`, `updated`, `review`, `error` and `stopped`. Parse this as an event stream, not one JSON document. See [watch mode](../guides/watch.md) for retry behavior and generation failures.

## CI and integrations

| Command | Behavior |
| --- | --- |
| `ci` | Check findings and required generated guidance; default gate fails on errors. |
| `ci --fail-on warning` | Also fail on warnings. |
| `ci --fail-on none` | Report findings without failing the gate. |
| `ci install` | Write a GitHub Actions workflow, refusing to replace a custom workflow. |
| `pr --base <ref>` | Summarize changes and relevant findings against a Git base; default base is `origin/main`. |
| `git install` | Install a pre-push check while preserving an existing hook. |
| `mcp` | Start the stdio MCP server for an agent client. |
| `serve` / `studio` | Start the local read-only API/viewer; default port `4310`, configurable with `--port`. |
| `lint` / `lint install` | Inspect optional lint mappings or write a recommended Oxlint fragment. |

`--base <ref>` is also accepted by supported Git-aware `sync`, `check` and `ci` workflows. Invalid references fail explicitly. `--json` requests machine-readable output for supported commands; `ci` includes an `ok` field matching its exit decision.

Experimental `sources add <figma|storybook> <path>` imports a local JSON evidence file. It does not connect to those services. See [support and limitations](limits.md).
