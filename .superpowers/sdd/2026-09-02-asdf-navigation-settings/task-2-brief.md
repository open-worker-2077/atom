# Task 2 Brief: 真实 owner 域径与原子游走提交

## Scope

- Work only in `D:\Project\〇\subprojects\atom\.worktrees\asdf-navigation-settings`.
- Preserve and complete the existing uncommitted Task 2 partial work.
- Do not modify Atom backing JSON, Program, locks, Graph semantics, build artifacts, or unrelated files.
- Do not spawn subagents.

## Required behavior

- F-mode entering a visible nested node must derive the transition from that node's real `ownerPath`, not from the active overview path.
- Route planning must validate and clone the known owner route; an unknown foreign route must fail without changing active state.
- One commit boundary must synchronously replace `{domainStack,currentPath,depth,crumbs,nodes}` before publishing the new view.
- Back navigation must return along the true owner route.
- Shortcut navigation must keep the same complete route contract.

## Existing partial work

- `spatial-view-mode-model.js` adds `resolveImmersiveOwnerContext` and model tests are green.
- `tests/browser/atom-web-critical-journeys.spec.mjs` adds the F-mode nested-owner journey.
- Production integration in `spatial-engine.js` is not implemented.

## TDD sequence

1. Run the new focused Playwright journey and record the expected RED.
2. Add only the minimal engine integration and any focused contract assertion required by the plan.
3. Run model, engine contract, and focused browser tests to GREEN.
4. Inspect diff for scope, then commit exactly Task 2 as `fix(web): enter immersive domains from real owner routes`.
5. Write the commands, results, commit hash, and residual risks to `task-2-report.md` beside this brief.

## Plan/spec

- `docs/superpowers/plans/2026-09-02-asdf-navigation-settings.md`, Task 2.
- `docs/superpowers/specs/2026-09-02-asdf-navigation-settings-design.md`.
