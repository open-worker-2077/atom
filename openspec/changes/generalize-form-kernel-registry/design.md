## Context

See `proposal.md` for motivation and the two capability specs for observable behavior. The current Python worker exposes a hand-maintained namespace, `form()` delegates only to `compile_form()`, and CLI Help lists functions as prose. `work_order()` already supplies an application-level lifecycle and must remain compatible. `@program` remains the only executable Atom type, and every world mutation remains owned by the existing Transform/revision/transaction boundary.

## Goals / Non-Goals

**Goals:**

- Add one pure, recursive Form component evaluator without growing a second Graph model.
- Make registered-function classification machine-readable and consistent across Python, CLI, Web and Help.
- Encode layer, capability category, and scope as separate dimensions.
- Preserve all current direct Form compilation and application behavior.

**Non-Goals:**

- Rewrite `work_order()`, the advancement-flow template, or their business sequence.
- Implement the pending `use_program()` Explore-ref change.
- Add automatic harvesting, publication, permissions, application types, or a general plugin marketplace.
- Let a Program modify the protected registry or runtime source.

## Decisions

### 1. Extend `form()` by an explicit evaluation action while retaining direct compilation

The old four-axis object remains the direct compile form. The new shape is JSON-keyed and unambiguous:

```python
form({
    "action": "evaluate",
    "components": [
        {
            "name": "调研",
            "activation": "disabled",
            "value": {},
            "requirements": [{"path": ["结论"]}],
            "components": []
        }
    ]
})
```

Only the action envelope uses these keys; compiled or persisted Graph data still has exactly `name`, `detail`, `children`, and `partners`. A separate `evaluate_form()` registered function was rejected because it would split one kernel contract and expand the public namespace unnecessarily.

### 2. Evaluate activation recursively without application semantics

Every evaluated component declares `required`, `optional`, or `disabled`; there is no inferred default. Required components always validate. Optional components validate only when their own JSON value or descendant value has content. Disabled components short-circuit the full subtree. Requirements use arrays of JSON keys, not dotted strings, so ordinary periods remain data and the evaluator does not invent traversal grammar.

The result contains `valid`, `required`, `optional`, `disabled`, `active`, and `missing`. Component paths are arrays of component names; missing requirement paths are returned unchanged. The evaluator is pure and emits no effects.

Alternative rejected: hard-code a minimal/standard/large Form mode. Scale is the number and nesting of caller-selected components, so named size modes would become another application policy.

### 3. Use one registry file as the public function inventory

A versioned JSON registry owns Atom function metadata. Both the JavaScript public loader and Python worker load that file. The worker derives the allowed Atom function names from it and verifies that each declared function has an implementation; Python built-ins remain a separate sandbox list. This prevents Help metadata and executable namespace from drifting.

The registry records:

- `layer`: `kernel` or `application`;
- `category`: stable capability responsibility;
- `scope.kind`: `atom` or `public`;
- `scope.path`: hierarchical segments for public entries;
- type metadata identifying `program` as the only executable kernel type.

Current runtime functions are public. Atom-local behavior is represented by ordinary `@program` instances and is deliberately absent from the public function inventory.

### 4. Public hierarchy is prefix inheritance, not a third scope

Public constraints are declared by path prefix. Effective constraints are accumulated from root to leaf and exposed in catalog results. This supports broad and locally public libraries without a separate `cross-atom` state or new authorization model.

### 5. Usage and backend responsibilities are architectural, not runtime identities

The architecture document uses only usage-side and backend-development responsibilities. A domain-specialized participant remains usage-side and receives no protected-code authority. Local code and patterns are eligible material; selection and abstraction are backend work. The runtime does not auto-copy or auto-promote local Programs in this change.

## Risks / Trade-offs

- **Optional nested content can be misread as activation** → activation remains explicit; content only decides whether an already optional component's declared requirements apply.
- **A registry can become stale beside the worker namespace** → derive allowed Atom names from the registry and add completeness/duplicate tests.
- **Classification can freeze premature application taxonomies** → require a second-level category for actual registered entries, but do not predeclare domain roles or future application types.
- **Public hierarchy may be mistaken for authorization** → document it as catalog scope and inherited contract only; existing lock and transaction boundaries remain authoritative.
- **Compatibility branch can become permanent ambiguity** → direct four-axis objects are compile calls; only objects with explicit `action` enter runtime evaluation.

## Migration Plan

1. Add failing Form evaluation and function-registry contract tests while retaining old compilation assertions.
2. Add the pure evaluator and wire the explicit `form({action: ...})` branch.
3. Add the shared registry, derive Python Atom-function names, and reject inventory drift.
4. Expose read-only Program, CLI and Web catalog projections and render grouped Help.
5. Run focused Program, work-order, advancement-flow, CLI/Web and architecture suites.
6. Roll back by removing the new registry/evaluation commits; no world-data migration is required because no new Graph axis or Atom type is persisted.
