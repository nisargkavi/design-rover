---
title: Troubleshooting
description: Resolve initialization, context, watch, review and CI issues without losing saved decisions.
---

Start with the version and repository status:

```sh
bunx design-rover --version
bunx design-rover status --json
```

Use `--cwd /absolute/path/to/app` if your shell or agent is running elsewhere.

## The project is not initialized

Run `bunx design-rover init` from the application root. `init` creates the saved model and leaves inferences pending. Repeating it preserves existing decisions; use `diff` and `sync` to review later observations.

If canonical records remain but `system.json` is missing, restore the model instead of initializing over the partial state. See interrupted writes below.

## Context is stale

Context checks freshness but returns saved records. Review the proposed changes:

```sh
bunx design-rover diff --json
```

After review, use `bunx design-rover sync --yes` to apply observed updates. This does not approve pending inferences. Approved removals and other explicit decisions may remain; copy the appropriate `approve` or `reject` command from the diff, then request context again.

Run returned freshness actions from `freshness.actions.cwd`. To deliberately inspect the saved snapshot without a scan, pass `--no-check-freshness`; MCP clients can set `checkFreshness: false`. That result is explicitly unchecked.

## An API is missing or ambiguous

Search the model, then inspect a specific record:

```sh
bunx design-rover query Button --json
bunx design-rover explain <id>
```

Replace `<id>` with a real ID from the output. A repeated name can refer to distinct components in different packages. MCP `get_component` accepts a source path to disambiguate them.

For partial or unresolved props, read the source and the resolution issues. External types and complex imports may be outside supported analysis; increasing the response budget cannot resolve an unsupported type.

## Context omits a relevant record

Inspect `coverage`, `limits` and `warnings`. Whole records can be omitted by count or character budget. Narrow the query/path, increase `--limit` or `--max-chars`, or retrieve the record by ID. Pending entries require `--include-pending` and remain unapproved when included.

Do not interpret an omitted approved decision as permission to ignore it. See [context options](../reference/cli.md#context-options).

## Watch reports an error or stops updating

Keep watch in its own terminal and inspect its error event. Invalid supported source/configuration syntax and unreadable inputs block a refresh. Repair the file; watch retries without requiring a restart. Conflicting saves are retried against the latest model.

Approved records, human annotations and policies are intentionally deferred. Their review action is not a watcher failure. Inspect `diff` and make the decision explicitly. Watch rejects `--approve` and `--yes`.

Generated guidance stays unchanged unless you pass `--generate`. With that option, observations can be saved before generation fails. Resolve the reported adapter or write problem and retry generation; do not assume observations were rolled back.

Stop with Ctrl+C or SIGTERM. Watch completes an already-started write before exiting. [Watch mode](watch.md) lists polling and debounce options.

## CI fails but the model has pending rules

Pending review and gate failures are different. The default CI gate blocks errors and stale required guidance; use `--fail-on warning` to gate warnings too. Inspect the actual findings:

```sh
bunx design-rover ci --json
bunx design-rover diff --json
```

Confirmed approved API changes or removals can be errors. Incomplete type resolution is advisory. Use a reviewed baseline to adopt gradually rather than approving every proposal to silence a gate.

Missing untracked local guidance does not fail a fresh checkout's gate. Modified guidance or missing Git-tracked guidance can fail it. `status` reports all stale projections; `generate` refreshes local guidance from saved decisions.

## Interrupted or conflicting writes

Canonical writes use locking, staged installation and rollback. If an operation reports a conflict, reload the current model, review the latest diff and retry.

After an interruption, inspect `.design-rover/.write.lock` and any `.recovery-required.json` marker. Retain the marker's referenced backup while restoring the model. Removing a stale lock alone cannot authorize or repair a partial installation. Restore the complete model from a known good backup or Git revision when necessary.

For a reproducible bug, include versions, a minimal source example, the command and expected versus actual output in a [report](contributing.md). Redact private paths, source and credentials.
