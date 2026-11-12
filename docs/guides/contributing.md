---
title: Contributing
description: Report problems, improve documentation and validate focused changes to Design Rover.
---

Bug reports, documentation fixes and focused contributions are welcome. The repository's [CONTRIBUTING.md](https://github.com/nisargkavi/design-rover/blob/main/CONTRIBUTING.md) is the contribution policy.

## Report a problem

Search [existing issues](https://github.com/nisargkavi/design-rover/issues) first. Include:

- Design Rover, Bun and Node versions.
- A minimal source example and the exact command.
- Expected behavior, actual output and relevant resolution or freshness warnings.

Remove private source, paths and credentials from shared logs. For a substantial feature, describe the task and expected behavior in an issue before starting a large implementation. Small fixes can go straight to a pull request.

For security issues, follow [the security reporting instructions](https://github.com/nisargkavi/design-rover/blob/main/CONTRIBUTING.md#security-reports). Do not post unpatched vulnerabilities or exploit details in a public issue.

## Work locally

Use Bun 1.4.4. The packaged CLI supports Node >=20.19.0; the Astro documentation app requires Node >=22.23.4. Node 24 is recommended when working across the repository.

```sh
git clone https://github.com/nisargkavi/design-rover.git
cd design-rover
bun install --frozen-lockfile
bun run design-rover --help
```

Exercise write commands in a temporary project or copied fixture. `init`, `sync`, `approve` and `generate` can change project files. Tests should clean up their own temporary files and avoid real user projects or external services.

## Validate the change

Add a regression test that reproduces the user-visible problem. Run focused tests first, then the checks required by the change:

```sh
bun run typecheck
bun run test
bun run test:scripts
```

For CLI behavior, dependencies or packaging changes, verify the installable artifact:

```sh
bun run pack:cli
bun run smoke:cli
```

The smoke check installs the package into a fresh project and exercises CLI/MCP behavior, including live watch updates. Report the validation you ran in the PR.

## Work on the documentation

Guides and reference pages are Markdown under `docs/`; the Astro/Starlight app lives in `apps/docs`. Keep commands and examples consistent with the CLI.

```sh
bun run docs:dev
```

For a documentation change, check the content and production build:

```sh
bun run docs:check
bun run docs:build
bun run docs:verify
bun run docs:preview
```

Check navigation, links and command examples in the preview. CLI code tests are unnecessary for prose-only edits; explain the checks you ran.

## Open a focused pull request

Explain the concrete problem, the resulting behavior and any compatibility impact. Include a reproduction or issue link, and the check results. AI-assisted changes have the same review requirements as other contributions.

Use a Conventional Commit PR title because maintainers squash-merge:

| Prefix | Release effect |
| --- | --- |
| `fix:` | Patch |
| `feat:` | Minor |
| `docs:` or `chore:` | No release by itself |
| `feat!:` or a `BREAKING CHANGE:` footer | Major |

Leave versions, tags and publication to the release workflow. Validated commits on `main` drive automated npm publishing and GitHub Releases; contributors do not need publishing credentials.
