# Work-order Form Runtime

## Scope

The runtime adds one protected Graph-native form kernel, `work_order` version 1,
and a rebuildable per-Atom year ring. It does not add a fifth Graph axis, a
parallel form store, organizational dispatch, claiming, or cross-order routing.

Authoritative instances remain ordinary Atoms using only:

```text
name · detail · children · partners
```

## Work-order shape

Each version 1 instance has exactly three direct groups:

```text
work order
├─ Output
├─ Step
└─ Criteria
```

The directed functional relations are stored as `partners`: Criteria constrains
Step, Step produces Output, Output is submitted to Criteria, and Criteria can
return rejected work to Step. The root owns only the whole-order status; the
groups retain their own outcome, evidence, and acceptance facts.

## Shared public registry

CLI, Web, and Program read the same versioned registry data:

```powershell
atom.cmd --work-order-registry
```

```http
GET /__atom/api/work-order-registry
```

```python
work_order_catalog({'template': 'work-order', 'version': '1'})
```

The registry is read-only and reports the exact actions, input/result fields,
runtime errors, and central commit-receipt fields. Web Help renders this endpoint;
the CLI prints the same payload without requiring an Agent context.

## Version 1 actions

| Action | Required public input | Primary result |
| --- | --- | --- |
| `create` | `title`, `creation_id`, `version` | template/version, created flag, exact path |
| `fill` | exact `path`, declared group `values` | changed flag, status, path |
| `validate` | exact `path` | valid flag, responsible missing paths, status |
| `submit` | exact `path`; `submitted_at` on first complete submission; review fields when approving | submitted/idempotent result, status, missing paths |
| `reject` | exact `path`, reasons, reviewer, review time | rejected/idempotent result, status, responsible Step |
| `revise` | exact `path`, declared values, revision note | revised/idempotent result, status, path |
| `read-back` | exact `path` | status, values, guidance, validation, available actions |

The lifecycle is:

```text
待执行 → 执行中 → 待验收 → 已通过
                     └→ 已驳回 → 执行中
```

`已暂缓` is readable but has no version 1 mutation action. Unsupported actions,
unknown group content, an invalid state transition, an ambiguous path, or an
unsupported version fail before a partial effect is committed.

## Transaction boundary

`form()` and `work_order()` only emit intents. Every mutation follows the same
authoritative path as other Atom changes:

```text
Program intent
→ Transform compilation and access checks
→ expected-revision comparison
→ one central commit
→ durable receipt
→ read-back
```

The protected Program-only full-detail intent keeps user text opaque, including
literal `.rep.` or `.sum.` text. It never becomes a new persisted Graph field.
Concurrent writes based on one old revision allow at most one commit. A failed
multi-group action writes neither partial facts nor a transaction receipt.

## Year ring

Committed receipts retain command/correlation identity, time, source,
before/after revisions, affected Atom path or reference, affected Graph axes,
outcome, and rollback relation. Old receipts without the added metadata remain
readable.

Read and Program diagnostics are stored separately in
`runtime-diagnostics.json`. They retain bounded timing, outcome, Program
identity/fingerprint, compact failure information, and affected paths or
references. They do not copy full private detail or unchanged world snapshots.

The year-ring index is a projection rebuilt from transaction receipts and the
bounded diagnostic stream. Rebuilding or querying it never writes `atom.json`.
Transaction compaction retains compact historical receipts and only the latest
safe rollback snapshot.

## Operational guidance

- Start the shared runtime with `npm start`; do not open `index.html` directly.
- Select an exact template version and a stable `creation_id` when creating.
- Use exact work-order paths for all later actions.
- Read `missing` paths after validation; do not infer completion from a Program
  message alone.
- After a mutation, confirm both the central receipt and `read-back` facts.
- On `WORLD_REVISION_CONFLICT`, re-read current facts and re-evaluate; never
  replay blindly.
- On `WORLD_COMMITTED_PROJECTION_PENDING`, do not repeat the mutation; use the
  existing local projection-recovery operation.
- Treat the year ring as audit/query projection, never as an editable source of
  world truth.

## Acceptance commands

The change is accepted only after the OpenSpec validation, focused form/runtime/
transaction/interface suites, isolated top-level `test` Atom workflow, Web
Chromium rendering check, and repository-wide regression have been run. Exact
results and any unrelated baseline failures are recorded in the dated handoff.
