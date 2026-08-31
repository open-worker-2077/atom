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
- Reject Program-owned and Program-consequent fact endpoints, keep directionless legacy relations inert, and keep archived backup support outside the active Graph.
- Permit slot-model revision only as one same-Program, same-body Transform + reseal transaction; reject cross-body capability borrowing atomically.

## Capabilities

### New Capabilities

- `support-program-decision`: Defines the role, boolean semantics, locality, execution isolation, and effect-free boundary of a Program referenced by a support condition.

### Modified Capabilities

- None.

## Impact

- Primary regression surface: support endpoint/projection tests plus the directly affected slot structure-lock and public CLI chain.
- Runtime surfaces changed only at proven seams: Graph/Form/slot endpoint validation, inactive-backup projection, legacy directionless-relation projection, and same-transaction slot reseal authorization.
- Existing Program-consequent relations are migrated through an authorized, backed-up central transaction. Business facts remain private; GitHub carries only sanitized counts, hashes, contracts, and test evidence.
