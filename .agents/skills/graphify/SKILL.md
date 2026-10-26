---
name: graphify
description: Use Graphify to navigate Study's code relationships, callers, dependencies and likely change impact. Use rg for exact text or filenames.
---

# Graphify

The devcontainer installs Graphify and refreshes `graphify-out/graph.json` from local code when it starts. The graph is a navigation aid; verify important claims in the owning source files. `INFERRED` edges especially need confirmation.

- For a relationship question, use `graphify query "<question>" --budget 1200`, then inspect the returned source paths. `graphify explain "Symbol"`, `graphify path "A" "B"`, and `graphify affected "Symbol"` narrow the result.
- For an unknown entry point, `graphify god-nodes --top 10` shows highly connected nodes. Use `rg` when the task needs an exact name or string.
- After code changes, run `graphify update .` to refresh local code edges. If the graph is absent, run `graphify extract . --code-only --cargo --no-cluster --max-workers 4` from the repository root. These commands do not call a model.
- Keep generated `graphify-out/` data local. Read source and tests before editing; a graph can miss dynamic calls or become stale.
