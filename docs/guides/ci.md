---
title: CI and gradual adoption
description: Check reviewed contracts, choose a failure threshold, and adopt Design Rover without hiding existing findings.
---

CI is most useful with a [shared, reviewed model](git-tracking.md) committed alongside source. A local-only model is not available on a fresh runner, and initializing there cannot recreate your team's approval decisions.

## Inspect current findings

```sh
bunx design-rover check --json
```

Confirmed API changes or removal of an approved component are errors. Changes to observed APIs are informational. Incomplete type resolution is advisory; usage and restyling findings remain warnings.

A clean check covers supported analysis. It does not establish complete design-system conformance, visual quality or accessibility.

## Choose the gate

```sh
bunx design-rover ci --fail-on error --json
```

| Threshold | Diagnostic behavior |
| --- | --- |
| `error` | Default. Block errors and stale required guidance. |
| `warning` | Also block warning findings. |
| `none` | Report findings without failing the diagnostic gate. |

The exit status and JSON `ok` field describe the same gate result. Invalid Git bases and unreadable or corrupt canonical records remain operational errors.

For reproducible CI, pin the package version you have validated rather than relying on a changing `latest` release.

## Adopt gradually

After reviewing existing findings, you can record them as current debt:

```sh
bunx design-rover baseline
bunx design-rover ci --fail-on warning --json
```

Inspect the baseline before committing it. Future runs distinguish baseline findings from new findings; accepting a baseline is a review decision, not a fix for its underlying issues.

## Install an integration

```sh
bunx design-rover ci install
```

This writes `.github/workflows/design-rover.yml`. Review the file and commit it with the model. The generated workflow installs the required runtimes, uses a pinned CLI version and compares against the repository's PR/default branch. An existing custom workflow requires review before replacement.

For a local pre-push gate:

```sh
bunx design-rover git install
```

Existing hooks are preserved. The default gate blocks errors and stale required guidance. Missing untracked/local projections do not fail a fresh checkout; modified guidance or missing Git-tracked guidance does. `status --json` reports all stale projections, including absent local snapshots.

Use `--base <ref>` for change-oriented Git comparisons when needed. Ensure that ref is available in the checkout; an invalid base fails explicitly.
