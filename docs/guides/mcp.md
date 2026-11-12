---
title: Connect an agent with MCP
description: Start the local stdio MCP server and retrieve bounded context, existing APIs and design findings.
---

The MCP server exposes the same local model used by the CLI. Initialize the target project first:

```sh
bunx design-rover init --cwd /absolute/path/to/project
```

## Add the server to your client

For clients that accept an `mcpServers` configuration object:

```json
{
  "mcpServers": {
    "design-rover": {
      "command": "bunx",
      "args": [
        "design-rover@latest",
        "mcp",
        "--cwd",
        "/absolute/path/to/project"
      ]
    }
  }
}
```

Replace the path with your project root. Client configuration formats differ; use your client's stdio-server configuration if it does not use `mcpServers`. Bun and Node.js 20.19.0 or newer must be available to the process launching the server.

`@latest` starts the current release. For a reproducible setup, replace it with a release version you have reviewed. Restart the MCP server after changing its version or project path.

## Request context for a task

Ask the agent to call `get_context` before making a UI change, for example:

```json
{
  "query": "add a settings form",
  "path": "src/App.tsx",
  "maxChars": 12000
}
```

Use a path in your project. Inspect the returned freshness, coverage and omission warnings, then read the relevant implementation before reusing an API.

`get_context` checks supported source observations by default. When saved observations are stale, it returns review/refresh actions with a working directory. It never applies those actions or approves knowledge. Set `checkFreshness: false` only for an explicitly unchecked saved snapshot. See [context retrieval](context.md) for the full workflow.

## Choose the right tool

| Tool | Use |
| --- | --- |
| `get_context` | Task/path context within a record and character budget. |
| `get_component` | An API by ID or unambiguous name; supply `source` to disambiguate. |
| `get_system` | Repository freshness and model summary. |
| `search_system` | Search whole saved knowledge records. |
| `get_pattern`, `get_conventions`, `get_intents`, `get_exceptions` | Inspect saved design knowledge. |
| `check_code` | Check a snippet against the saved model. |
| `explain_violation` | Explain a finding or relevant saved record. |

Pending knowledge is opt-in for tools that support `includePending`. Missing models and ambiguous names are reported explicitly.

Run [watch mode](watch.md) in another terminal to keep observed inventory updated. Subsequent MCP requests read the updated model; an agent's existing conversation is not refreshed automatically.
