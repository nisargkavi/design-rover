# Design Rover

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/brand/readme-banner-dark.svg">
  <img src="assets/brand/readme-banner.svg" alt="Design Rover: design knowledge for people and coding agents." width="1600">
</picture>

[![CI and release](https://github.com/nisargkavi/design-rover/actions/workflows/publish-cli.yml/badge.svg?branch=main)](https://github.com/nisargkavi/design-rover/actions/workflows/publish-cli.yml)
[![npm version](https://img.shields.io/npm/v/design-rover)](https://www.npmjs.com/package/design-rover)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**Help coding agents reuse the UI you already have.**

Design Rover analyzes your React/TypeScript project and records its components, design tokens and UI conventions. Give an agent the existing Button API and relevant design decisions before asking it to build another screen.

Use the local CLI, generated agent instructions or MCP to retrieve that knowledge. Review inferred rules before approving them, and keep observed components current with watch mode.

[Documentation](https://nisargkavi.github.io/design-rover/) · [Quickstart](https://nisargkavi.github.io/design-rover/guides/quickstart/) · [MCP setup](https://nisargkavi.github.io/design-rover/guides/mcp/) · [CLI reference](https://nisargkavi.github.io/design-rover/reference/cli/)

## Quick start

Requires Bun and Node >=20.19.0. Run from the project you want to analyze:

```sh
bunx design-rover init
bunx design-rover diff
```

Review the proposals, then replace `<id>` with an individual record or change ID from the output:

```sh
bunx design-rover approve <id>
bunx design-rover generate
```

Retrieve context for your next UI task and check your changes. Replace the example path with one in your project:

```sh
bunx design-rover context "add a settings form" --path src/App.tsx --json
bunx design-rover check
```

`init` creates `.design-rover/`. Observed APIs are evidence; inferred rules stay pending until explicitly approved. `generate` writes managed instructions for AGENTS.md, CLAUDE.md, Cursor and an Agent Skill. Context requests check freshness and return review/refresh actions when the saved knowledge is stale.

## Live updates

Leave watch mode running in another terminal after initialization:

```sh
bunx design-rover watch
```

It refreshes observed components and tokens after edits settle. Approved contracts, human annotations and pending policies still require review. Add `--generate` to refresh agent instructions too; Ctrl+C stops the watcher.

See the guides for [watch mode](https://nisargkavi.github.io/design-rover/guides/watch/), [context and freshness](https://nisargkavi.github.io/design-rover/guides/context/), [approvals](https://nisargkavi.github.io/design-rover/guides/review/), [CI checks](https://nisargkavi.github.io/design-rover/guides/ci/) and [Git tracking](https://nisargkavi.github.io/design-rover/guides/git-tracking/).

## Supported projects

Supports JSX components, CVA variants, supported local TypeScript imports and barrel exports, scoped CSS custom properties and basic Tailwind configuration. Advanced types, external declarations and dynamic styling can remain unresolved; records report analysis limits. A clean check does not prove visual quality, accessibility or complete design-system conformance. Read the [support boundaries](https://nisargkavi.github.io/design-rover/reference/limits/) before relying on a result.

## Contribute

Bug reports, focused fixes and documentation improvements are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) for local setup, validation and pull requests. Use Bun 1.4.4 in this repository:

```sh
bun install --frozen-lockfile
bun run typecheck
bun run test
```

[Development and releases](docs/development.md) covers package checks and publishing. Reviewed canonical knowledge can be shared through Git, or kept local; choose the [tracking setup](https://nisargkavi.github.io/design-rover/guides/git-tracking/) that fits your project.

[npm package](https://www.npmjs.com/package/design-rover) · [GitHub Releases](https://github.com/nisargkavi/design-rover/releases) · [0.5.1 release notes](docs/releases/v0.5.1.md) · [MIT license](LICENSE)
