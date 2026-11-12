---
title: Git tracking
description: Choose a shared team model or local-only setup, and keep generated artifacts separate from reviewed decisions.
---

Choose how the project will use Design Rover before committing `.design-rover/`. A team model shares reviewed decisions with contributors and CI. A local-only setup keeps the model and generated instructions on one developer's machine.

## Share a team model

Commit reviewed canonical records, approval/rejection history and any intentional baseline under `.design-rover/`. Review those changes alongside the source they describe.

Keep transient artifacts out of commits with these root `.gitignore` entries:

```text
/.design-rover/cache/
/.design-rover/generated/
/.design-rover/.write*/
/.design-rover/.write.lock
/.design-rover/.recovery-required.json
```

Choose separately whether to track generated AGENTS.md, CLAUDE.md, Cursor rules and Agent Skills. Checked-in guidance helps agents discover the model, but it must be regenerated when stale. Keep the canonical directory tracked when teammates and CI depend on its decisions.

The evidence cache can contain source text. Inspect the model before publishing a repository; source references and design evidence can contain project metadata. Credentials do not belong in tool artifacts.

## Keep everything local

For a local-only setup, use these exact tool paths in the root `.gitignore`:

```text
/.design-rover/
/AGENTS.md
/CLAUDE.md
/.cursor/rules/design-rover.mdc
/.agents/skills/design-rover/
```

Ignore AGENTS.md and CLAUDE.md this way only when they are new tool-generated files. Preserve existing tracked or human-authored instructions. `.gitignore` does not untrack files already committed; inspect `git status` and review any tracking changes deliberately.

Avoid broad patterns such as `.cursor/`, which can hide unrelated project configuration.

## Understand write failures

Canonical writes use locking and staged updates with rollback. Concurrent changes are checked against the model read by an operation; a conflict requires reloading and reviewing the latest diff before retrying. Watch retries conflicting saves automatically while preserving approval boundaries.

If an interrupted write leaves a `.recovery-required.json` marker, keep its referenced backup and inspect the interrupted state before recovery. Deleting a lock alone does not repair a partial model. If `system.json` is missing while canonical records remain, restore the model rather than initializing over those records.

Stored repository roots are relative (`.`), so sharing the model does not share your absolute checkout path.
