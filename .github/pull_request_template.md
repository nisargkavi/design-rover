## Problem and change

Describe the trigger and the behavior before and after this change. Link an issue or a minimal reproduction when applicable.

## Validation

List the commands you ran and their results. For behavior fixes, describe the regression test. For documentation-only changes, explain why code tests are unnecessary.

- [ ] Relevant tests pass, or I explained what could not be run.
- [ ] TypeScript changes pass `bun run typecheck`; CLI/package changes also pass `bun run pack:cli` and `bun run smoke:cli` (mark inapplicable checks in the explanation).
- [ ] This PR contains no credentials or private project data. Suspected vulnerabilities follow the private reporting guidance in [CONTRIBUTING.md](https://github.com/nisargkavi/design-rover/blob/main/CONTRIBUTING.md#security-reports).

## Compatibility and review

Describe any breaking behavior or migration steps. Use a Conventional Commit PR title (`fix:`, `feat:`, `docs:`, or `chore:`); add `!` for a breaking change.

Leave package versions, release tags and publication to the automated release workflow. Maintainers squash-merge after required checks pass.
