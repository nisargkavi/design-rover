# Design Rover

[![Design Rover: design knowledge for people and coding agents](https://raw.githubusercontent.com/nisargkavi/design-rover/main/assets/brand/readme-banner.png)](https://nisargkavi.github.io/design-rover/)

**Help coding agents reuse the UI you already have.**

Design Rover records components, design tokens and UI conventions from your existing React/TypeScript project. Retrieve the relevant APIs and reviewed decisions through a local CLI, generated agent instructions or MCP before building another screen.

[Documentation](https://nisargkavi.github.io/design-rover/) · [MCP setup](https://nisargkavi.github.io/design-rover/guides/mcp/) · [CLI reference](https://nisargkavi.github.io/design-rover/reference/cli/)

## Quick start

Requires Bun and Node >=20.19.0. Run from the project you want to analyze:

```sh
bunx design-rover init
bunx design-rover diff
```

Review the output and replace `<id>` with the record or change ID you want to approve:

```sh
bunx design-rover approve <id>
bunx design-rover generate
bunx design-rover context "update a form" --path src/App.tsx --json
bunx design-rover check
```

Replace the example path with one in your project. Knowledge lives in `.design-rover/`; inferred rules require explicit approval. Context requests check freshness and return review/refresh actions when saved knowledge is stale.

## Live updates

After initialization, leave this running in another terminal:

```sh
bunx design-rover watch
```

Watch refreshes observed components and tokens after edits settle. Approved contracts, human annotations and pending policies still need review. Add `--generate` to refresh agent instructions too; Ctrl+C stops the watcher.

Analysis supports local React/TypeScript component APIs, scoped CSS tokens and basic Tailwind configuration. Unresolved types and retrieval omissions are reported. A clean check does not prove visual quality, accessibility or complete design-system conformance. See [supported behavior and limits](https://nisargkavi.github.io/design-rover/reference/limits/).

[Quickstart](https://nisargkavi.github.io/design-rover/guides/quickstart/) · [Watch guide](https://nisargkavi.github.io/design-rover/guides/watch/) · [Contribute](https://github.com/nisargkavi/design-rover/blob/main/CONTRIBUTING.md) · [Releases](https://github.com/nisargkavi/design-rover/releases)
