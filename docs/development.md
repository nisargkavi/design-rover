# Development and releases

Use Bun 1.4.4 for dependency installation and workspace scripts. The packaged CLI supports Node >=20.19.0.

## Validate a change

```sh
bun install --frozen-lockfile
bun run typecheck
bun run test
bun run test:scripts
bun run pack:cli
bun run smoke:cli
```

The smoke check installs the packaged tarball into a fresh project and exercises the CLI, generation, JSON gates and MCP transport. Run the web production build when changing the Next.js viewer:

```sh
bun run --filter @design-rover/web build
```

`pack:cli` bundles workspace code, then stages a public manifest without development-only workspace dependencies. Source manifests stay unchanged. To keep validation artifacts outside the checkout, use `bun run pack:cli /absolute/path/to/artifacts` and `node scripts/smoke-cli.mjs /absolute/path/to/artifacts/design-rover-0.3.3.tgz`.

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

## Automated releases

Maintainers squash-merge reviewed PRs after required checks pass. The final commit title determines the next version through [Conventional Commits](../CONTRIBUTING.md#open-a-pull-request): `fix:` requests a patch, `feat:` a minor, and `!` or a `BREAKING CHANGE:` footer a major. Documentation and maintenance commits do not request a release by themselves. Contributors leave version edits, tags and publication to the workflow.

A push to `main` starts the [Release workflow](https://github.com/nisargkavi/design-rover/actions/workflows/publish-cli.yml):

1. The reusable [test workflow](https://github.com/nisargkavi/design-rover/actions/workflows/test.yml) validates Linux on Node 20, 22 and 24, and macOS on Node 24. It runs typechecking, library tests, release-script tests, packaging and the fresh-install smoke check.
2. `semantic-release` reads `release.config.mjs`. The preparation plugin keeps curated release notes when present, generates missing notes, updates the public CLI version, matching constant, Bun lock entry and current documentation, then builds, packs and smoke-tests the release candidate. Private workspace versions stay unchanged.
3. `@semantic-release/git` records those source changes in a release commit marked `[skip ci]`; semantic-release creates its matching `vX.Y.Z` tag.
4. The publish plugin publishes `design-rover` to npm through trusted publishing, waits up to 15 minutes for npm processing, downloads the registry artifact, verifies its SHA512 integrity and package files against the local candidate, and smoke-tests the downloaded package.
5. The verified package supplies the scoped GitHub Packages mirror, `@nisargkavi/design-rover`. A GitHub Release receives the exact verified npm tarball and `SHA256SUMS`.

The publishing job uses Node 24, npm 11.20.0 and Bun 1.4.4. This does not change the packaged CLI's Node >=20.19.0 requirement. Follow the workflow's actual results to determine whether a release completed.

### Maintainer setup

The npm package owner configures a GitHub Actions trusted publisher for **user `nisargkavi`**, **repository `design-rover`**, and **workflow filename `publish-cli.yml`**. Allow direct `npm publish`, which this workflow uses; an optional environment name must match the workflow if one is configured later. Complete npm's account/2FA prompts when changing package settings. The job uses OIDC with `id-token: write`, so it does not require an `NPM_TOKEN` secret. See [npm's trusted-publisher setup](https://docs.npmjs.com/trusted-publishers/).

The GitHub workflow token needs `contents: write` for release commits, tags and assets, and `packages: write` for the scoped mirror. After the first mirror publication, a maintainer checks its repository connection and package visibility: GitHub Packages defaults new packages to private. Installing from that registry requires authentication even for public packages; the unscoped npm package remains the usual installation path. See [GitHub's npm registry guidance](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry).

### Resume an incomplete tagged release

If a version tag exists but publication or release assets failed, fix the configuration or transient service problem, then:

1. Open **Actions → Release → Run workflow**.
2. Select the matching **`vX.Y.Z` tag**, and set **`resume_version` to `X.Y.Z`** without the `v`.
3. Run the workflow and inspect validation and publication results.

Validation runs again. The resume script verifies that the checked-out tree matches that tag, checks release identity, rebuilds and smoke-tests the candidate, then resumes publication. Existing npm or mirror versions must pass content verification before being reused. The final GitHub assets come from the verified npm download. A content mismatch requires a new fix release; the retry does not silently accept different package bytes.

[GitHub Releases](https://github.com/nisargkavi/design-rover/releases) · [Release notes](releases/v0.3.3.md)
