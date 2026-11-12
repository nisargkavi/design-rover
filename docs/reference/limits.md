---
title: Support and limitations
description: What Design Rover analyzes today, where it reports uncertainty and which integrations are experimental.
---

Design Rover analyzes existing implementation. Use its source evidence and resolution information to decide whether a result applies to your task.

## Supported analysis

| Area | Current behavior |
| --- | --- |
| Components | React JSX, CVA variants, supported local TypeScript props, local imports and barrel exports. |
| Tokens | CSS custom properties with selector/media scope, source identity and importance. |
| Tailwind | Supported static color configuration, including nested names and `DEFAULT`. Configuration is parsed, never executed. |
| Token dependencies | Supported `var()` references in compatible scopes; missing references and cycles are reported. |
| Retrieval | Task/path scoping, whole records, source references and omission reporting. |
| Checks | Supported API/token drift, basic sizing/restyling findings, conventions, intent and scoped exceptions. |

Type resolution can remain partial or unresolved for external package declarations, complex types, import cycles and ambiguous exports. Read the implementation when an API is incomplete. Unresolved information is not a verified contract.

Dynamic styling and token configuration may not be statically recoverable. Unresolved dynamic token values are excluded from default usable context. CSS declarations from different files stay distinct because the tool cannot assume bundle or cascade order.

## Project scope

Analysis reads the root project's configuration. Per-package tsconfig resolution, inherited configurations and non-React templates are not fully supported. In a monorepo, run from the relevant app root and inspect coverage before relying on the inventory.

CSS class APIs such as `.btn` and `.field` variants are outside the React component model. A class-based design convention can exist even when there is no corresponding component API record.

The CLI analyzes supported source locally and does not upload application code. Uploading a model to a hosted service is a separate action. Model records can still contain source references and project metadata; inspect them before sharing a repository.

## Checks and freshness

A clean check does not establish visual quality, accessibility, complete design-system conformance or pixel parity with a design file. It only describes the supported checks and their recorded evidence.

Freshness compares supported observations at a point in time. Rejected proposals remain suppressed. Edits after the check and unsupported source constructs can change what an agent should rely on.

Watch mode uses polling and a stability window. It updates eligible observed components and tokens; it does not automatically accept approved API changes, human annotations or policies. Agent clients see changes on their next request, not as a pushed update to an existing conversation.

## Experimental integrations

- **Figma and Storybook:** import local JSON evidence. There is no direct service fetch or automatic design-to-code synchronization.
- **Studio:** a local read-only viewer. The separate Next.js viewer uses `DESIGN_ROVER_ROOT` for local viewing.
- **Hosted snapshots:** an in-memory prototype, not durable team collaboration. Hosted viewing uses `DESIGN_ROVER_API`, `DESIGN_ROVER_ORG`, `DESIGN_ROVER_REPO` and `DESIGN_ROVER_TOKEN`; the server requires a nonempty token.
- **Lint mapping:** `@shadcn/lint` is an optional enforcement adapter. Only compatible approved policies map to its rules.

Report a reproducible gap through the [contribution workflow](../guides/contributing.md), including the relevant source shape and command output.
