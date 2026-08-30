## Why

Atom already accepts `thing@program` references inside a support condition, but its regression vocabulary and acceptance coverage conflate that independent decision Program with the support relation's ordinary antecedent Thing. Issue #44 needs a durable contract that fixes the three roles and proves that support evaluation is boolean, local, non-propagating, and side-effect free before any kernel change is considered.

## What Changes

- Define an explicit support-decision Program as an independent `thing@program` referenced by a support condition, distinct from both the ordinary antecedent Thing and the ordinary consequent Thing.
- Require a focused synthetic contract with exactly those three roles: ordinary antecedent, independent support-decision Program, and ordinary consequent.
- Require a Transform whose `changedPaths` select only the support decision that depends on that Program; the ordinary antecedent supplies no boolean value.
- Require strict false/true outcomes: false does not establish the support edge, while true establishes it.
- Forbid implicit execution of the consequent Thing or any Program associated with the consequent while deciding support.
- Reject every side effect emitted by a support-decision Program.
- Treat the test as a characterization gate: change runtime code only if the focused regression first demonstrates that the current kernel violates the contract.

## Capabilities

### New Capabilities

- `support-program-decision`: Defines the role, boolean semantics, locality, execution isolation, and effect-free boundary of a Program referenced by a support condition.

### Modified Capabilities

- None.

## Impact

- Primary regression surface: `tests/atom-program-support-endpoint.test.mjs` and the support projection/runtime integration tests selected by the contract.
- Runtime surfaces to inspect only after a failing characterization: `work-engine/atom-language/support-runtime.mjs`, Program support evaluation in `work-engine/atom-language/program-runtime.mjs`, and projection wiring in `src/atom-system/adapters/legacy-projection-adapter.mjs`.
- No production data, `atom.json`, business nodes, external API, or GitHub state is modified.
