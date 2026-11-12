---
title: Design Rover
description: Give coding agents context about your existing components, tokens and UI conventions.
---

**Help your coding agent reuse the UI you already have.**

Design Rover reads your React/TypeScript source and records component APIs, scoped design tokens and UI conventions. You review inferred rules, then give agents relevant context through the CLI, generated instructions or MCP.

It runs locally in your project. Start with the [quick start](guides/quickstart.md), then choose the workflow you need:

| I want to… | Read |
| --- | --- |
| Set up an existing project | [Quick start](guides/quickstart.md) |
| Help an agent find and reuse a component | [Context for agents](guides/context.md) |
| Keep the component map updated while editing | [Live updates with watch](guides/watch.md) |
| Connect an MCP client | [MCP setup](guides/mcp.md) |
| Decide which rules the team should follow | [Review and approvals](guides/review.md) |
| Catch design knowledge drift in CI | [Checks and CI](guides/ci.md) |

## Start in your project

Requires Bun and Node 20.19.0 or newer. No global install is needed.

```sh
bunx design-rover init
bunx design-rover diff
```

Review the evidence, approve or reject individual proposals, then [generate agent guidance](guides/quickstart.md#give-your-agent-context) or request context for your next UI task.

## Observations and decisions

Component APIs and tokens begin as **observed inventory**. Inferred rules remain **pending** until you explicitly approve them. Watch mode can refresh observed inventory; reviewed contracts and human decisions still need review when their evidence changes.

The source of truth is `.design-rover/`. Generated instructions are projections of that knowledge. See the [knowledge model](reference/model.md) for the states and files involved.

## What to expect

Design Rover analyzes supported source patterns. It exposes incomplete resolution and context omissions so you can inspect the implementation and make a decision. A clean check does not establish visual quality, accessibility or complete design-system conformance. Read [support and limits](reference/limits.md) before using it as a gate.

[GitHub repository](https://github.com/nisargkavi/design-rover) · [npm package](https://www.npmjs.com/package/design-rover) · [Contribute](guides/contributing.md)
