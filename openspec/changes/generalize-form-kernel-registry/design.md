## Context

See `proposal.md` for motivation and the two capability specs for observable behavior. The current Python worker exposes a hand-maintained namespace, `form()` delegates only to `compile_form()`, and CLI Help lists functions as prose. `work_order()` already supplies an application-level lifecycle and must remain compatible. `@program` remains the only executable Atom type, and every world mutation remains owned by the existing Transform/revision/transaction boundary.

## Goals / Non-Goals

**Goals:**

- Add one pure, recursive Form component evaluator without growing a second Graph model.
- Make registered-function classification machine-readable and consistent across Python, CLI, Web and Help.
- Keep the functional catalog centered on registered functions and Atom types, with coarse function families and a simple per-function scope.
- Preserve all current direct Form compilation and application behavior.

**Non-Goals:**

- Rewrite `work_order()`, the advancement-flow template, or their business sequence.
- Implement the pending `use_program()` Explore-ref change.
- Add automatic harvesting, publication, permissions, application types, or a general plugin marketplace.
- Let a Program modify the protected registry or runtime source.
- Model research roles, organizational identities, or a public hierarchy in registry data.

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

The registry records only the facts needed by code:

- `layer`: `kernel` or `application`;
- `family`: one coarse function family; kernel uses `graph`, `form`, or `program`;
- `scope`: the simple value `atom` or `public`;
- type metadata identifying `program` as the only executable kernel type.

Current runtime functions are public. Atom-local behavior is represented by ordinary `@program` instances and is deliberately absent from the public function inventory.

Alternative rejected: separate categories for execution, reading, planning, templates, and governance. Those labels expose implementation fragmentation at the top of the catalog and force callers to reconstruct the broader Program family.

### 4. Public is a visibility value, not a platform hierarchy

Registered functions use one simple public marker. The registry does not declare public paths, parent constraints, or allowed application structures. Programs compose public components according to their own application needs; existing locks, access checks, revisions, and transactions still govern actual world operations.

### 5. Help owns the development guidance

Research and development roles are not registry types. Help states the operational surface instead: Agents may freely write, refine, and reuse local `@program` code through `use_program()`; no Program function mutates the protected registry or runtime source. Agents may still supply mature implementations as material, so the boundary does not prohibit usage-side research.

### 6. Keep replaceable tool output outside the source-work view

The repository ignores subproject-local `.agents/`, `.claude/`, `CLAUDE.md`, and `test-results/`. Project-specific `AGENTS.md` remains tracked because it carries repository instructions rather than a reusable Skill bundle. Playwright writes run artifacts to an operating-system temporary directory so test execution does not recreate output inside the software tree.

## Risks / Trade-offs

- **Optional nested content can be misread as activation** → activation remains explicit; content only decides whether an already optional component's declared requirements apply.
- **A registry can become stale beside the worker namespace** → derive allowed Atom names from the registry and add completeness/duplicate tests.
- **Coarse families can hide implementation detail** → retain every exact function entry and use families only for navigation, not dispatch.
- **Public may be mistaken for unrestricted world access** → Help states that public describes function availability; locks and transaction boundaries remain authoritative.
- **Ignored tool files can hide intended project policy** → keep `AGENTS.md` tracked and ignore only replaceable integration bundles and run output.
- **Compatibility branch can become permanent ambiguity** → direct four-axis objects are compile calls; only objects with explicit `action` enter runtime evaluation.

## Migration Plan

1. Add failing Form evaluation and function-registry contract tests while retaining old compilation assertions.
2. Add the pure evaluator and wire the explicit `form({action: ...})` branch.
3. Add the shared registry, derive Python Atom-function names, and reject inventory drift.
4. Simplify the registry to coarse families and simple scope, then expose equivalent Program, CLI, Web and Help projections.
5. Ignore local integration bundles and route Playwright artifacts to the operating-system temporary directory.
6. Run focused Program, work-order, advancement-flow, CLI/Web and architecture suites.
7. Roll back by reverting the registry/hygiene commits; no world-data migration is required because no new Graph axis or Atom type is persisted.
