# Contributing to Design Rover

Bug reports, focused fixes, features and documentation improvements are welcome. Start with a small change that is easy to reproduce and review.

## Report a problem or propose a feature

Search existing issues first. For a bug, include the Design Rover version, Bun/Node versions, a minimal source example, the exact command, and expected versus actual behavior. Redact private source, paths and credentials from logs.

For a substantial feature, open an issue explaining the task it would help with and its expected behavior before investing in an implementation. Small fixes and documentation corrections can go straight to a pull request.

### Security reports

Do not disclose an unpatched vulnerability, credentials or exploit details in a public issue. Use the repository's [Security](https://github.com/nisargkavi/design-rover/security) → **Report a vulnerability** option when available. If that option is unavailable, open an issue requesting a private reporting channel without describing the vulnerability.

## Work locally

Use the Bun version in `package.json` (currently 1.4.4) and Node >=20.19.0.

```sh
bun install --frozen-lockfile
bun run design-rover --help
```

Keep application fixtures separate from the library checkout. Commands such as `init`, `sync`, `approve` and `generate` write project files; exercise them in an isolated temporary project or a copied fixture. Tests should clean up their temporary files and avoid external services or real user projects.

## Validate the change

Add a regression test for a behavior fix. Prefer a test that reproduces the user-visible failure over one that repeats the implementation. Run the tests relevant to the change, for example:

```sh
bun run test -- tests/model-reliability.test.ts
```

Run `bun run typecheck` for TypeScript changes. When CLI behavior, dependencies or packaging change, also validate the installable package:

```sh
bun run pack:cli
bun run smoke:cli
```

Documentation-only changes need working links and accurate commands; explain when code tests are unnecessary. CI runs the repository checks. Include the commands you ran and their results in the pull request.

## Open a pull request

Keep each PR focused on one problem. Explain the trigger, the behavior before and after, and any compatibility or migration impact. Include a reproduction or issue link when applicable. Changes written with AI tools follow the same review and validation requirements.

Use a Conventional Commit title because maintainers squash-merge PRs:

| PR title | Release effect |
| --- | --- |
| `fix: preserve approved decisions during sync` | Patch |
| `feat: support another static token format` | Minor |
| `docs: clarify the local-only setup` | No release by itself |
| `chore: update development tooling` | No release by itself |
| `feat!: change the canonical model format` | Major |

Mark breaking changes with `!` and describe how users migrate. A `BREAKING CHANGE:` footer in the final squash commit also requests a major release.

Maintainers review the scope and validation, then squash-merge only after required checks pass. Validated changes on `main` drive automated versioning, npm publication and GitHub Releases. Contributors should not edit package versions, create release tags or publish packages manually.
