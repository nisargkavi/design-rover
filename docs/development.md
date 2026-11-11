# Development and releases

Use Bun 1.4.4 for dependency installation and workspace scripts. The packaged CLI supports Node >=20.19.0.

## Validate a change

```sh
bun install --frozen-lockfile
bun run typecheck
bun run test
bun run pack:cli
bun run smoke:cli
```

The smoke check installs the packaged tarball into a fresh project and exercises the CLI, generation, JSON gates and MCP transport. Run the web production build when changing the Next.js viewer:

```sh
bun run --filter @design-rover/web build
```

Run the CLI from source without installing it globally:

```sh
bun run design-rover --help
bun run design-rover init --cwd /path/to/app
bun run design-rover context "update a form" --path src/App.tsx --cwd /path/to/app --json
```

Keep tests focused on observable behavior: full/incremental equivalence, unique identities, preserved human decisions, precise exceptions, safe failure handling and bounded retrieval. A valid generated instruction file alone does not establish useful agent behavior.

## Repository layout

| Directory | Responsibility |
| --- | --- |
| `packages/model` | Schemas and shared record types |
| `packages/core` | Analysis, storage, review, retrieval and checks |
| `packages/cli` | Public CLI package and local viewer |
| `packages/mcp` | Stdio agent tools |
| `packages/integrations` | Optional lint and external evidence adapters |
| `apps/web` | Read-only Next.js viewer |
| `apps/server` | Experimental hosted snapshots |
| `fixtures` and `tests` | Supported source examples and regression coverage |

## Publish a release

1. Update package and CLI versions together, add release notes, and validate the release identity with `node scripts/check-release.mjs <version>`.
2. Run the validation commands above and inspect the tarball generated at the repository root.
3. Publish the verified tarball to npm using an authenticated maintainer account:

```sh
npm publish ./design-rover-0.3.1.tgz --access public --tag latest
bun run verify:published
```

Replace the example version for a later release. npm publication is a separate authenticated action; pushing a Git tag does not republish an npm version. `verify:published` checks registry availability and the fresh-project entrypoint with an empty Bun cache.

Push a matching version tag on the verified release commit to trigger the [GitHub Release workflow](https://github.com/nisargkavi/design-rover/actions/workflows/publish-cli.yml). It rebuilds/tests the tagged source, compares package files with the public npm artifact, and attaches that exact tarball and `SHA256SUMS` to the release.

The [test workflow](https://github.com/nisargkavi/design-rover/actions/workflows/test.yml) checks supported Node versions on Linux and macOS using Bun for dependencies and scripts. Inspect its actual results before treating a pushed change as verified.

[GitHub Releases](https://github.com/nisargkavi/design-rover/releases) · [Release notes](releases/v0.3.1.md)
