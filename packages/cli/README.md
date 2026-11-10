# Design Rover

Repository design knowledge for people and AI agents.

```sh
bunx design-rover init
bunx design-rover diff
bunx design-rover approve
bunx design-rover generate
bunx design-rover check
```

This source prepares 0.2.0; it must be published before the new npm entrypoint is available.

Canonical models live in `.design-rover/`. Review proposed changes before updating approved knowledge. Notes outside generated managed blocks are preserved, and customized adapters require resolution instead of silent overwrites.

Analysis is local and does not upload source code. React/TypeScript extraction and heuristic checks have explicit limits; hosted collaboration and external JSON evidence import are experimental. See the [repository README](https://github.com/nisargkavi/design-rover#readme) for development and supported behavior.
