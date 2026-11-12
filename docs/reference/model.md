---
title: Knowledge model
description: How source observations, reviewed decisions and generated agent guidance relate to each other.
---

Design Rover stores repository knowledge in `.design-rover/`. Source is analyzed as evidence; people decide which inferences become policy. CLI queries, MCP tools and generated instructions read from this saved model.

## Record types

| Collection | Describes |
| --- | --- |
| Components | Source/import identity, supported props, variants, sizes, usage and resolution issues. |
| Tokens | CSS declarations, source identity, selector/media scope, importance and supported dependencies. |
| Patterns | Repeated compositions and whether their recorded guidance recommends extraction. |
| Conventions | Observations and reviewable guidance about implementation choices. |
| Intents | Design intent, such as required content or production asset expectations. |
| Exceptions | Scoped, reviewed allowances for particular paths or components. |

Records carry IDs, status, evidence, confidence and origin. A repeated component name is not a unique identity: a Button in one package can differ from a Button elsewhere. Retrieve by ID or inspect the source before using it.

Exceptions use gitignore-style path patterns and can also constrain component names or IDs. Their `allows` entries may identify exact classes, `restyle-spacing`, or the broader `local-override`. An allowance applies to its recorded scope and finding type: a color exception does not suppress an unrelated spacing finding.

## Knowledge states

| Status | Meaning |
| --- | --- |
| `observed` | Extracted inventory, available as implementation evidence. |
| `inferred` / `suggested` | Unreviewed knowledge; excluded from default task context. |
| `approved` | A record or contract explicitly accepted after review. |
| `rejected` | A decision not to adopt the recorded knowledge. |
| `deprecated` | Knowledge no longer offered as default usable context. |

Observed inventory is not approved policy. Approving a component establishes a reviewed API contract that supported checks can enforce. Rejecting an approved record revokes that approval. Rejected fingerprints suppress the same proposal until material evidence changes.

Repository sync status is separate from record status. A model can be `synchronized`, `pending-review`, or in `drift`; a missing model is `uninitialized`. Pending review alone does not mean observations are stale.

## Stored files

```text
.design-rover/
  system.json
  components/  tokens/  patterns/
  conventions/  intents/  exceptions/
  history/events.jsonl
  rejections.json
  baseline.json
  sources.json
  discrepancies.json
  generated/
  cache/evidence.json
```

Some files, including a baseline, exist only when needed. `system.json` records repository and analysis metadata, enforcement settings and generated-file tracking. History records decisions and changes. External source records and discrepancies are experimental evidence, not an automatic choice of authority.

Writes use locking, staged installation and conflict detection. If recovery is required, follow the error and retain its referenced backup. Deleting a lock alone does not repair a partially installed model. See [troubleshooting](../guides/troubleshooting.md#interrupted-or-conflicting-writes).

Managed writes refuse symlinked targets or child directories, including `.design-rover/`. Addressing the repository root through a symlink is supported.

## Model, cache and projections

The model holds the saved knowledge. `.design-rover/cache/evidence.json` is an ignored source-text cache used to speed up analysis; it is not an approval store.

`generate` creates managed AGENTS.md and CLAUDE.md sections, a Cursor rule and an Agent Skill. These are projections of the model. Editing one does not update canonical decisions. Human notes outside managed sections are preserved; customized generated adapters require resolution before replacement.

Choose whether to share the canonical model or keep it local. Generated files and caches have different tracking needs; see [Git tracking](../guides/git-tracking.md).

## Freshness is a separate check

`context` and MCP `get_context` compare supported observations with the saved model by default. Returned records still come from that model. The freshness summary identifies source changes, pending reviews and stale guidance, with actions for review and refresh.

A check is valid at that point in time. It does not approve proposals, guarantee complete analysis, or account for edits made afterward. Snapshot-only mode explicitly reports `freshness.checked: false`. [Task context](../guides/context.md) explains the response fields and refresh workflow.

Watch mode updates eligible observed inventory in the saved model. It leaves reviewed contracts, human annotations and policy decisions for explicit review, and does not push changes into an agent's existing conversation.
