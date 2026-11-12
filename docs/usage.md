# Using Design Rover

Start with the [documentation overview](index.md) or [quick start](guides/quickstart.md). Use the task guides for workflows and the reference pages for command and model details.

Run commands from your application root, or add `--cwd /absolute/path/to/app`. Use a reviewed, pinned package version when reproducibility matters.

## Discover and review

Follow the [quick start](guides/quickstart.md) to initialize a project, inspect evidence and generate agent guidance.

[Review and approvals](guides/review.md) explains observed inventory, pending rules, individual decisions and manual sync. Approved or human-annotated removals require their explicit removal change ID.

## Watch for live updates

[Watch mode](guides/watch.md) keeps observed components and tokens current as you edit. The guide covers polling, debounce, generated guidance, JSON events, errors and clean shutdown.

Approved records, human annotations and policies stay deferred for explicit review.

## Look up an API or decision

Use [task context](guides/context.md) to find existing components and relevant design decisions. It explains query/path scoping, whole-record budgets, source references and omission warnings.

The [CLI reference](reference/cli.md#inspect-and-retrieve) covers direct `query`, `explain` and `status` commands.

## AI agents and MCP

[Connect an MCP client](guides/mcp.md) to retrieve local context and APIs through stdio tools. To write managed AGENTS.md, CLAUDE.md, Cursor and Agent Skill guidance, follow [generated agent setup](guides/quickstart.md#give-your-agent-context).

[Context freshness](guides/context.md#handle-stale-knowledge) explains default checks, returned review/refresh actions and explicit snapshot-only retrieval. Context requests do not apply updates or approve knowledge.

## Check changes and adopt gradually

[CI and gradual adoption](guides/ci.md) covers findings, failure thresholds, reviewed baselines, pre-push hooks and GitHub Actions installation.

Read the [support boundaries](reference/limits.md) before treating a clean check as a project gate. Missing untracked local guidance and missing Git-tracked guidance have different gate behavior.

## Git tracking

Choose a [Git tracking setup](guides/git-tracking.md) before committing the model or generated files.

### Shared team model

[Share reviewed knowledge](guides/git-tracking.md#share-a-team-model) with teammates and CI while excluding transient caches and generated snapshots.

### Local-only setup

[Keep the model local](guides/git-tracking.md#keep-everything-local) using exact tool paths. Preserve existing tracked or human-authored instructions.

## Supported behavior and limits

[Support and limitations](reference/limits.md) describes component/type analysis, scoped tokens, monorepo constraints, checks and experimental integrations.

The [knowledge model](reference/model.md) explains record states, saved files, projections and approval boundaries. For recovery, stale context or watch issues, use [troubleshooting](guides/troubleshooting.md).

[CLI reference](reference/cli.md) · [Contribute](guides/contributing.md) · [Development and releases](development.md)
