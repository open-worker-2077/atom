## Why

Atom currently evaluates a support-decision Program and uses its strict boolean only to establish the projected support edge. The value never reaches a consequent-owned action, so the accepted user flow “state decision → support true → consequent-owned action → lock” cannot run without recomputing the decision or abusing Transform as a signal.

## What Changes

- Publish a typed, revision-bound delivery only for a support clause that evaluates to strict `true`.
- Let a Program explicitly subscribe to support delivery for one ordinary consequent and receive the strict boolean plus clause coordinates.
- Keep support evaluation effect-free and non-imperative: no subscription means no execution, and support never discovers or executes a Program merely because it is contained by or related to the consequent.
- Keep ordinary antecedent and consequent Things free of boolean state.
- Execute at most one successful subscriber invocation per Program, slot scope, candidate revision,
  clause, and consequent, including repeated or concurrent refreshes of the same delivery.

## Capabilities

### New Capabilities

### Modified Capabilities

- `support-program-decision`: Extend the strict-bool support contract with optional, explicit consequent-owned delivery consumption while preserving the ban on implicit consequent execution.

## Impact

- Program trigger declaration and invocation ABI.
- Support evaluation result handoff from the projection boundary to the Program scheduler.
- Slot-body relative-domain trigger binding.
- Focused support/slot/lock integration tests and CLI Help.
