---
title: Review and approvals
description: Turn observations into reviewed contracts and rules without silently approving inferred knowledge.
---

Design Rover separates what exists in source from what your team has accepted as a design decision.

| Knowledge | Starting state | Effect of approval |
| --- | --- | --- |
| Components and tokens | Observed inventory | A reviewed record; approved component APIs become contracts checked for drift. |
| Inferred conventions, patterns, intents and exceptions | Pending review | Accepted guidance or policy. |

## Review one proposal

```sh
bunx design-rover diff
bunx design-rover explain <id>
```

Read the evidence, source references and proposed change. Replace `<id>` with the ID shown by the output, then choose one action:

```sh
bunx design-rover approve <id>
bunx design-rover reject <id>
```

`approve` without an ID accepts the complete pending set, so reserve it for a set you have reviewed in full. Rejection remembers an inference until material evidence changes.

An unchanged observed component can be approved by its component ID. To revoke an approval, use `reject <approved-id>`; use `approve <rejected-id>` to restore it. These decisions appear in history:

```sh
bunx design-rover history --json
```

## Refresh observations after editing

```sh
bunx design-rover diff
bunx design-rover sync
```

Interactive `sync` requests confirmation before applying updates. In a noninteractive shell, it only previews unless `--yes` is supplied:

```sh
bunx design-rover sync --yes
```

This applies observed updates and updates to already trusted knowledge; pending inferred rules stay pending. Explicitly reviewed bulk approval is available with `sync --yes --approve`.

Manual sync and [watch mode](watch.md) have different boundaries: watch only refreshes unannotated observed inventory, while manual sync can accept updates to already trusted knowledge after your review.

## Retire protected knowledge explicitly

Routine sync preserves removal proposals for approved or human-annotated records, including when `--approve` is supplied. Review the removal in `diff`, then accept its **change ID**:

```sh
bunx design-rover approve <removal-change-id>
```

A component ID or name cannot authorize a protected removal. This prevents a routine inventory refresh from erasing a reviewed contract or human note.

## Check the outcome

```sh
bunx design-rover check --json
```

Confirmed API changes or removal of approved components are errors. Changes to observed APIs remain informational; unresolved type information produces advisory findings rather than a confirmed API break. See [CI and gradual adoption](ci.md) for gating findings.
