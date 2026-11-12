---
title: Context for coding agents
description: Retrieve existing APIs and design decisions for a task, check freshness, and handle incomplete results.
---

Use task context before building or changing UI so your agent can find the components the project already has.

## Request a task packet

```sh
bunx design-rover context "add a billing form" --path app/billing/page.tsx --json
```

Replace the example path with a file or directory in your repository. The query and path help rank relevant components, tokens and decisions. The packet contains whole records, their source references, freshness information and coverage counts.

Observed APIs and approved knowledge are included by default. Use `--include-pending` only when reviewing unapproved inferences; their presence does not make them policy. Rejected and deprecated knowledge is excluded.

For direct inspection:

```sh
bunx design-rover query Button --json
bunx design-rover explain <id>
```

Choose by source or ID when component names repeat across packages. An agent should read the implementation when a record reports partial or unresolved prop types.

## Handle stale knowledge

CLI `context` and MCP `get_context` compare supported source observations with the saved model by default. They return saved records and do not apply updates or approvals.

Inspect these fields before relying on the packet:

| Field | Meaning |
| --- | --- |
| `freshness.checked`, `checkedAt` | Whether a source check ran, and when. |
| `freshness.sourceStatus` | `current` or `stale` supported observations. |
| `freshness.pendingReview` | Knowledge awaiting explicit approval. |
| `freshness.staleGenerated` | Outdated generated agent guidance. |
| `freshness.actions` | Review, refresh or generation commands, with their `cwd`. |

When source observations are stale, run the returned review command from `actions.cwd`. After reviewing, the refresh action uses `bunx design-rover sync --yes` to apply observed updates without approving pending rules. Resolve any remaining decisions explicitly, then request context again.

Freshness describes a point-in-time comparison of supported observations. Rejected proposals remain suppressed, and unsupported code may remain unresolved. A failed check returns an error.

## Keep results useful within a budget

The default packet allows 20 records and 12,000 formatted JSON characters. To adjust it:

```sh
bunx design-rover context "Button" --path components/ui --limit 30 --max-chars 24000 --json
```

Inspect `coverage` and omission warnings. Narrow the path or increase the bounds when relevant records are omitted. An omitted approved decision still needs review; records are never cut into partial JSON fragments.

To read an explicitly unchecked snapshot without source scanning:

```sh
bunx design-rover context "Button" --no-check-freshness --json
```

MCP supports the same option as `checkFreshness: false`. The result reports `freshness.checked: false`.
