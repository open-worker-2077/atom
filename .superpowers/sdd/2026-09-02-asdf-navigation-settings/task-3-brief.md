# Task 3 Brief: 星轨统一设置窗口与 CapsLock 默认模式

## Scope

- Work only in `D:\Project\〇\subprojects\atom\.worktrees\asdf-navigation-settings`.
- Implement only Task 3 from the approved plan/spec; Task 1—2 commits are already reviewed.
- Do not modify Atom backing JSON, Program, locks, Graph semantics, generated browser bundles, or unrelated files.
- Do not spawn subagents.

## Required behavior

- Replace the scattered top-right controls with one star-orbit settings entry.
- Open one centered, keyboard/mobile-usable settings window with five clear sections; preserve existing settings/tool capabilities by moving them behind that entry.
- Add persisted `defaultDetailMode: 'name'|'surface'|'floating'`, normalize invalid/missing stored values to `floating`.
- Apply the chosen default on startup and new domain entry; an explicit restored history snapshot remains authoritative.
- The mapping section must be clearly separated and contain the default CapsLock detail mode control.

## TDD sequence

1. Add model/contract/browser tests and run the required RED before production edits.
2. Implement the minimal settings model, centered window, and default-detail behavior.
3. Run focused model/contract tests and `tests/browser/mapping-layout-controls.spec.mjs` to GREEN.
4. Inspect scope and commit exactly Task 3 as `feat(web): add unified orbital settings`.
5. Write commands, results, commit hash, and residual risks to `task-3-report.md` beside this brief.

## Plan/spec

- `docs/superpowers/plans/2026-09-02-asdf-navigation-settings.md`, Task 3.
- `docs/superpowers/specs/2026-09-02-asdf-navigation-settings-design.md`.
