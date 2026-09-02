# Task 3 Review: remediation required

## P1 — default detail mode is not applied

- `defaultDetailMode` persists, but `createNode()` still initializes `detailMode: "floating"`.
- Ordinary startup and new domains therefore ignore configured `name` or `surface` modes.
- The browser test checks storage/select persistence but not actual node rendering mode.
- Required remediation: add RED coverage for startup/new-domain application while preserving explicit history snapshot priority, then implement and verify.

## P2 — settings window is only visually modal

- `aria-modal="true"` is declared without backdrop/inert/focus containment.
- Global keyboard handling can still execute scene intents behind the open settings window.
- Required remediation: add RED coverage for background interaction suppression and keyboard-usable focus/close behavior, then implement and verify.

## Review state

- Commit under review: `6b4c7f1`.
- Task 3 is not accepted or complete until both findings are fixed and re-reviewed.
