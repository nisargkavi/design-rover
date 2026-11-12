---
title: Live updates with watch
description: Refresh observed components and tokens while editing, with explicit approvals and predictable shutdown.
---

After [initialization](quickstart.md), run watch in a separate terminal:

```sh
bunx design-rover watch
```

Watch polls the supported source manifest and file contents, waits for changes to settle, then refreshes observed components and tokens. It handles additions, edits, renames and deletions, including atomic editor saves.

CLI and MCP requests read the updated model on their next request. Watch does not push new context into an existing agent conversation.

## What updates automatically

Only observed component and token inventory without human annotations is refreshed automatically. Approved contracts, rejected records, human-authored knowledge, and pending or approved policies stay unchanged.

When a reviewed component changes or disappears, watch reports deferred changes with a review action:

```sh
bunx design-rover diff --json
```

Inspect the evidence and choose an explicit approval or rejection command. Watch does not accept `--approve` or `--yes`. Freshness checks can still report stale observations until deferred decisions are resolved; pending approval alone is reported separately.

## Configure polling and guidance

```sh
bunx design-rover watch --interval 1000 --debounce 300
```

| Option | Default | Behavior |
| --- | --- | --- |
| `--interval <ms>` | `1000` | Time between polls. |
| `--debounce <ms>` | `300` | Wait for edits to remain stable before processing. |
| `--generate` | Off | Also regenerate agent guidance. |
| `--cwd <path>` | Current directory | Select an initialized repository. |
| `--json` | Off | Emit one JSON event per line. |

Both timing options accept integers from 100 to 60,000 milliseconds. Updates arrive after polling and stability delays, and cycles run serially.

Generated agent files stay unchanged by default. Use `watch --generate` to refresh them as the model changes, or run `generate` separately when ready.

## Stop or recover

Press Ctrl+C or send SIGTERM to stop. Any canonical write already in progress finishes before exit.

Invalid syntax or unreadable inputs pause a refresh before observations are saved. Watch reports an error and retries; fix the source or configuration to resume. Conflicting saves are retried against the latest model. With `--generate`, observations may already be saved if a later guidance write fails; resolve that guidance problem and retry generation.

For automation, parse `watch --json` as newline-delimited JSON. Events are `ready`, `updated`, `review`, `error` and `stopped`; an update event can also contain a review action for deferred changes. This stream differs from the single JSON document returned by `context --json`.
