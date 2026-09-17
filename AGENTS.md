## graphify

This project has a graphify knowledge graph at .graphify/.

Rules:
- For codebase or architecture questions, when `.graphify/graph.json` exists, first run `graphify query "<question>"` (or `graphify path "<A>" "<B>"` / `graphify explain "<concept>"`); these return a scoped subgraph, usually much smaller than `GRAPH_REPORT.md` or raw grep output
- If .graphify/wiki/index.md exists, navigate it instead of reading raw files
- If .graphify/graph.json is missing but graphify-out/graph.json exists, run `graphify migrate-state --dry-run` first; if tracked legacy artifacts are reported, ask before using the recommended `git mv -f graphify-out .graphify` and commit message
- If .graphify/needs_update exists or .graphify/branch.json has stale=true, warn before relying on semantic results and run /graphify . --update when appropriate
- Before proposing or committing .graphify artifacts, run `graphify portable-check .graphify`; commit-safe graph artifacts must use repo-relative paths, and never commit .graphify/branch.json, .graphify/worktree.json, .graphify/needs_update, or .graphify/cache/. If a repo already tracks any of them, first add them to .gitignore, then propose `git rm --cached .graphify/branch.json .graphify/worktree.json .graphify/needs_update` and `git rm -r --cached .graphify/cache`; never mutate git state without asking
- Before deep graph traversal, prefer `graphify summary --graph .graphify/graph.json` for compact first-hop orientation
- For review impact on changed files, use `graphify review-delta --graph .graphify/graph.json` instead of generic traversal
- Read `.graphify/GRAPH_REPORT.md` only for broad architecture review or when `query` / `path` / `explain` do not surface enough context
- After modifying code files in this session, run `graphify update . --all --force` from D:\POS to keep the graph current.
  Do NOT use `graphify hook-rebuild` or a bare `graphify update` in this repo: they resolve scope to `auto` -> `committed`,
  which sees only the 34 files in the single existing commit, builds an 18-node graph, and is then refused as a regression.
  `--all` walks the whole tree; exclusions come from `.graphifyignore`, not from git.
- `.graphify/`, `AGENTS.md`, `.graphifyignore`, `.gitattributes`, `graph.html`, `graph-watch.cmd` and `refresh-graph.cmd`
  are gitignored on purpose - graphify must never reach GitHub. Ignore the "add to version control" / "commit-safe
  artifacts" advice above; nothing graphify-related gets committed.
- `D:\POS\graph.html` is the visual studio (self-contained, double-click to open). Regenerate graph + viewer together with
  `sh .git/hooks/graphify-refresh.sh` from D:\POS - that is what the git hooks run. `graphify watch` refreshes graph.json
  only, NOT graph.html.
