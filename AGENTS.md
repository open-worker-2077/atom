<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **atom** (6535 symbols, 18144 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "main"})`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({search_query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method without first running `impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit changes without running `detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/atom/context` | Codebase overview, check index freshness |
| `gitnexus://repo/atom/clusters` | All functional areas |
| `gitnexus://repo/atom/processes` | All execution flows |
| `gitnexus://repo/atom/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->

# Atom development workflow

- Start or resume substantive development by invoking the globally installed official superpowers:using-superpowers skill.
- Read the relevant approved design under docs/superpowers/specs and the current plan under docs/superpowers/plans before changing code.
- Treat docs/history/development-control as read-only historical evidence; it never supplies current status or instructions.
- GitHub Issues and Projects are optional intake and collaboration records, not Atom requirement or completion authority.
- Official Superpowers Skill files, references, templates, rules, and definitions must not be edited, copied, wrapped, overridden, or shadowed.
- Project contributors must not edit, copy, wrap, override, or shadow official Superpowers definitions.
- Persist progress through the approved spec, current plan checkboxes, Git commits, current diffs, and fresh verification evidence.
- Keep real Atom worlds, business facts, credentials, and private backup locations outside version control.
