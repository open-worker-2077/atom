## Context

See `proposal.md` for motivation. Program-side `explore()` already returns `AtomView` values containing an opaque `ref`, exact `path`, type information and immutable facts for the current evaluation. `lock()` already treats the revision-local `ref` as the stable write-target coordinate. In contrast, `use_program()` currently scans available records itself for either a matching path or name.

Another Agent is already using the legacy `{name, arguments}` form, so the standard contract must change without an immediate breaking removal. Program calls must remain inside the current worker sandbox and existing Program/Transform/commit lifecycle.

## Goals / Non-Goals

**Goals:**

- Make the existing Explore result coordinate the standard reusable-Program target.
- Remove independent traversal semantics from the standard `use_program()` path.
- Preserve active legacy callers during a documented migration period.
- Keep revision, type, recursion, effects and transaction safety unchanged.

**Non-Goals:**

- Dynamic registration of user Programs as global runtime functions.
- Cross-world Program invocation or persisted cross-revision handles.
- Changes to `form()`, `work_order()`, advancement-flow templates or Agent authority.
- A scheduled removal release for the compatibility form.

## Decisions

### 1. Reuse the existing opaque `ref` coordinate

The standard call will be JSON-shaped and use the `ref` already returned by Explore:

```python
target = explore({"name": "项目/程序库/处理器"})[0]
result = use_program({"ref": target.ref, "arguments": {"批次": 1}})
```

`arguments` remains optional and defaults to `{}`. This passes the existing coordinate directly; it does not introduce a second coordinate system.

Passing the entire `AtomView` was rejected because registered world functions otherwise use JSON-shaped root inputs and because an opaque ref is sufficient for exact revision-local identity. Continuing to use a name or path as the standard target was rejected because it leaves selection responsibility inside `use_program()`.

### 2. Resolve standard calls only by current-record ref

The worker will look up the supplied ref in the records of the current immutable evaluation, then require the `program` type before compiling or executing it. A missing ref, a non-Program ref, or a value from another evaluation fails without fallback lookup. This makes stale and cross-world coordinates naturally invalid.

### 3. Route the legacy selector through Explore semantics

The existing `{name, arguments}` shape remains accepted. Its selector will be resolved through the worker's existing Explore engine call rather than the current Program-only name/path list scan. The resolved result then enters the same ref/type validation path as the standard call.

Help will present `{ref, arguments}` as standard and `{name, arguments}` as compatibility-only. No automatic removal date or runtime warning is added in this change because an active Agent still depends on the legacy form.

Alternative rejected: keep both resolution implementations indefinitely. That preserves an avoidable semantic split and permits future Explore behavior to drift from Program composition.

### 4. Preserve one execution and effect boundary

The referenced Program continues to receive the same registered functions and shared effect collectors as its caller. JSON round-tripping of the return value, recursion detection, the depth limit and transaction processing remain unchanged. The change selects the target differently; it does not create a nested transaction or new authorization boundary.

### 5. Keep dependency invalidation conservative

The runtime must continue invalidating callers when an available referenced Program relevant to composition changes. This change will verify existing dependency and projection-lifecycle behavior before narrowing any invalidation logic. Optimization is outside scope unless a regression test proves it is required for correctness.

## Risks / Trade-offs

- **Two accepted call forms can prolong migration** → Help documents only the ref form as standard and labels the name form compatibility-only.
- **Opaque refs expire whenever the world changes** → refs are consumed only inside the same Program evaluation; missing refs fail instead of being rebound silently.
- **Legacy Explore resolution can change error wording** → contract tests assert stable error categories and no-effects behavior rather than incidental Python text.
- **Called Programs can emit writes** → all effects remain subject to the caller's existing lock, Transform, revision and central commit checks.

## Migration Plan

1. Add failing contract tests for Explore-ref invocation, omitted input, type/revision rejection, legacy compatibility and Help text.
2. Introduce the ref-based target path and funnel both standard and legacy calls through one validated target resolver.
3. Update Help and Program runtime documentation while retaining the legacy examples only as migration notes.
4. Re-run Program reference, projection lifecycle, sandbox, lock, transaction and CLI contract suites.
5. Roll back the implementation commit if regressions occur; because the legacy form remains supported, rollback requires no world-data migration.
