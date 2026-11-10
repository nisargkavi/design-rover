# Design Rover

Repository design knowledge for people and AI agents.

[GitHub repository](https://github.com/nisargkavi/design-rover)

Design Rover scans an existing React/TypeScript codebase, records its components, scoped tokens and UI conventions, and proposes reviewable updates. The canonical model stays in your repository. Agent guidance, MCP and checks use the same model.

## Get started

Run this from the project you want to analyze:

```sh
bunx design-rover init
```

To pin the release, use `bunx design-rover@0.2.0 init`.

## Development

Use Bun 1.4.4 for dependencies and development scripts. The packaged CLI supports Node >=20.19.0.

```sh
bun install --frozen-lockfile
bun run typecheck
bun run test
bun run pack:cli
bun run smoke:cli
```

After publishing, run `bun run verify:published` to check the public npm release with a fresh project and an empty Bun cache.

Run directly from source:

```sh
bun run design-rover init --cwd /path/to/app
bun run design-rover diff --cwd /path/to/app --json
bun run design-rover approve --cwd /path/to/app
bun run design-rover check --cwd /path/to/app --json
```

Or install the local CLI tarball:

```sh
bun add --global ./design-rover-0.2.0.tgz
design-rover init
```

## Workflow

```sh
design-rover init                 # discover code; leave inferences pending review
design-rover diff                 # inspect proposed changes and pending records
design-rover approve <id>         # approve one record or proposed change
design-rover reject <id>          # reject an inference until material evidence changes
design-rover generate             # refresh agent guidance
design-rover query Button --json  # retrieve records; choose by ID when names repeat
design-rover explain <id>         # inspect API, scope and source
design-rover check                # check against known decisions
design-rover sync                 # review and accept observed updates
```

`init --approve --generate` approves initial inferences and generates guidance in one explicit operation. Repeating `init` preserves existing decisions; use `sync` to review changes. `sync --yes` accepts proposed changes without a prompt. `--json` keeps machine output on stdout. `ci --fail-on error|warning|none` reports the same decision through its exit code and JSON `ok` field.

Incremental analysis reconciles the full file manifest and reuses unchanged parsing. Additions, deletions, renames, ignore changes and branch switches are reflected. Invalid Git bases and corrupt canonical records report errors instead of appearing clean.

## Canonical storage

Canonical design knowledge lives in `.design-rover/`. Generated AGENTS.md, CLAUDE.md, Cursor rules and Agent Skills are projections of that model. Notes outside managed blocks are preserved. Customized generated adapters must be preserved or moved before regeneration; they are not silently overwritten.

Install integrations with `design-rover git install` and `design-rover ci install`. Custom hooks are preserved and custom workflows require review.

Canonical writes use a lock and staged updates with rollback. After an interrupted writer, inspect `.write.lock` and any recovery marker before removing a stale lock. A `.recovery-required.json` marker blocks further loads until recovery is complete.

## Supported and experimental behavior

| Area | Current behavior |
| --- | --- |
| Components | React JSX and locally declared TypeScript APIs, CVA variants, import-aware identity and usage |
| Tokens | CSS custom properties with selector/media scope and importance; basic Tailwind configuration extraction |
| Knowledge | Evidence-backed observations, reviewable inferences, explicit approvals and rejections |
| Checks | Component contract drift, basic sizing/restyling findings, intent and convention diagnostics, baselines |
| Agent guidance | Concise AGENTS.md, CLAUDE.md, Cursor rule and Agent Skill projections |
| MCP | Nine tools; approved/observed records by default, explicit pending opt-in, ambiguity and initialization errors |
| Studio | Local read-only viewer with origin checks and safe text rendering |
| Figma/Storybook | Experimental local JSON evidence import; no direct service connector |
| Hosted app | Experimental authenticated, repository-scoped, in-memory snapshot service |

Imported/inherited TypeScript types, barrel re-exports and complex dynamic styling are not fully resolved. Ambiguous component lookups require an ID/source instead of guessing. Token declarations in different source files remain distinct because bundle/cascade order is unknown. Design Rover does not prove visual quality, accessibility or pixel parity.

Approved exceptions match a path using gitignore-style patterns and, when provided, a component name or ID. `allows` can name `restyle-spacing`, exact classes, or the broader `local-override`. A color exception does not suppress unrelated spacing findings. Inferred exceptions require approval.

`@shadcn/lint` is optional. Only compatible approved policies map to its rules. The tool does not treat a preference against abstractions as a ban on arbitrary values, and is not affiliated with shadcn.

## Local and hosted viewers

```sh
design-rover studio --cwd /path/to/app
design-rover mcp --cwd /path/to/app
```

The Next.js viewer reads `DESIGN_ROVER_ROOT` locally. Hosted viewing requires `DESIGN_ROVER_API`, `DESIGN_ROVER_ORG`, `DESIGN_ROVER_REPO` and `DESIGN_ROVER_TOKEN`. The server also requires a nonempty token. There is no unscoped endpoint returning an arbitrary repository. Hosted storage is not durable and is not production team collaboration.

## Layout and releases

```text
packages/model        schemas and shared identity
packages/core         analysis, canonical storage, sync and checks
packages/cli          design-rover package and local viewer
packages/mcp          stdio tools
packages/integrations optional lint and external evidence adapters
apps/web              read-only Next.js viewer
apps/server           experimental hosted snapshots
```

The CI workflow checks types, regressions, the CLI bundle and packaged behavior with Bun. Release tags must match the public package version.

The next priorities are richer type resolution, bounded task/path retrieval, standards-based exports and real evidence adapters.

MIT. See [LICENSE](LICENSE).
