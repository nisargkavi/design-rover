---
title: Quick start
description: Build a local component map, review inferred rules, and give your agent useful design context.
---

Design Rover analyzes an existing React/TypeScript project. You need Bun and Node.js 20.19.0 or newer. Run the commands below from the app root; a global installation is unnecessary.

## Initialize your project

```sh
bunx design-rover init
bunx design-rover diff
```

`init` creates `.design-rover/` with observed components and tokens, plus inferred conventions and other proposals. Application source stays unchanged. Repeating initialization preserves existing decisions.

The diff shows source evidence and IDs you can review. After deciding whether a proposal belongs in the model, replace `<id>` with its record or change ID and choose one action:

```sh
bunx design-rover approve <id>
bunx design-rover reject <id>
```

Observed components are already available for retrieval. Approving a component establishes a reviewed API contract; approving an inferred rule makes it policy. See [review and approvals](review.md) before accepting a complete set.

## Give your agent context

```sh
bunx design-rover generate
bunx design-rover context "add a settings form" --path src/App.tsx --json
```

Replace `src/App.tsx` with a file or directory in your project. `generate` writes managed agent guidance. `context` returns relevant saved APIs, tokens and approved decisions, with a freshness check and source references. Your agent should inspect those references before reusing a component.

Choose whether to [share the model through Git](git-tracking.md) before committing tool files.

## Keep working

Leave this running in a separate terminal for live observed inventory updates:

```sh
bunx design-rover watch
```

After editing UI code, inspect the resulting changes and findings:

```sh
bunx design-rover diff
bunx design-rover check
```

Watch leaves approved contracts and pending rules for explicit review. Continue with [watch mode](watch.md), [task context](context.md), or [MCP setup](mcp.md).

For another app directory, add `--cwd /absolute/path/to/app` to the commands. In a monorepo, start from the relevant app root because analysis currently reads root configuration.
