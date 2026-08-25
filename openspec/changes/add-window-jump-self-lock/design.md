## Context

See `proposal.md` and the three delta specs. At `ed64e2d`, Program execution already has one Python worker, one result validator, a Transform reverse index, request-driven Program lock snapshots, a central candidate-world commit, and slot-body revision-local support plans. Agent resolution already supplies one exact interaction path to Explore/Transform authorization. Slot examples use stable `槽模角色` mappings and instance-local `scope_root`; reseal already distinguishes mapped slots from opaque unmapped material.

The baseline still exposes legacy AtomView fields internally, while the separately developed Graph target is thing/situation/contain/support. This change therefore needs one contained coordinate adapter seam and must not redefine either four-axis contract.

## Goals / Non-Goals

**Goals:**

- Make jump/recycle, self-lock enforcement, slot structural locking and their derived rebinding part of the existing candidate transaction.
- Reuse the current reverse indexes, nested Program invocation, authorization controller, lock snapshot discipline and slot-body stable-role plan.
- Keep exact coordinates opaque to Program authors: an object returned by `explore()` is accepted directly, and only the engine resolves its identity.
- Keep default self-lock computable from the current Agent position, with only explicit overrides requiring a snapshot.
- Provide a non-role-based recovery route for explicit self-lock overrides without creating an unlocked active window.

**Non-Goals:**

- A second scheduler, polling loop, global world scan, native M:N, `support@program`, route planner, slot-instance business domain, owner/controller identity or authorization role model.
- Monitoring slots invented inside a running window, or treating ordinary material as a mapped slot.
- Editing ESG, shared 4784, formal Atom data, or merging the concurrent four-axis branch.

## Decisions

### Normalize exact Explore results behind one Thing-coordinate adapter

`jump`, `changed`, self-lock rule `from`, and window-self-lock administration call a shared `normalizeThingCoordinate(value, candidateWorld)` boundary. The worker accepts the opaque value returned by absolute or current-relative exact `explore()` (the current AtomView or the merged four-axis Thing coordinate), verifies that it still resolves to exactly one Thing in the candidate world, and serializes only an internal canonical path plus revision evidence into the effect. Program authors never read `.ref`, `.path`, array order or neighbor position. The only string start accepted by a self-lock rule is the reserved literal `current`.

The Program function registry declares a reusable `ThingCoordinate` runtime type with `source: "explore exact result"`; it does not freeze current AtomView storage fields as the future Graph API. A narrow adapter is kept in its own module so the four-axis merge changes translation only, not jump, lock or slot semantics.

Alternative considered: accept strings or expose current refs. Strings reintroduce ambiguity and refs are revision-scoped implementation data, both contrary to the fixed contract.

### Emit jump and changed metadata through the existing Program result

The worker adds `jumps` effects and `changedThings` metadata to its existing result envelope. `jump()` validates only its four fixed keys and converts Program-coordinate arguments into exact nested Program paths. `changed(things)` records normalized dependencies on every projection/registration execution; it returns whether the current indexed Transform event intersects them. Because the call itself is cheap, a Program can write `if not changed(explore(...)): return` and no later explore/calculation runs on a miss.

The Program runtime folds `changedThings` into its existing `triggerIndex`. Slot support plans add their mapped-role source paths to that same index. A hit selects the source Program once; nested `recycle`, `when`, then (only if needed) `where` Programs execute through the existing bounded Program invocation path. The runtime does not enumerate unrelated Programs or slots.

Alternative considered: add a window-jump poller. That duplicates scheduling and would make no-change short-circuiting impossible to prove.

### Apply recycle or move as one candidate-world effect

Within the existing candidate cycle, jump effects run after source Program validation but before publication. The evaluator invokes `recycle`; true produces the existing reversible window-recycle mutation and terminates the branch. Otherwise it invokes `when`; absent/false produces no mutation. Only true invokes `where`, normalizes its exact Thing destination, checks cycle/contain constraints, and plans one existing Transform move of the interaction Agent.

Move/recycle authorization uses the same access controller as CLI/Program Transform. A denial is translated to the jump-specific stable receipt while preserving the underlying matched-lock details. The candidate then derives the new Agent path, self-lock snapshot key, slot `scope_root`, local support sources and changed dependencies before any single authoritative commit. Any nested Program error, destination error, lock denial, slot-role mismatch or downstream effect failure discards the entire candidate.

Alternative considered: commit the move and rebuild indexes afterward. That exposes half-moved windows and leaves a crash window where the old slot can still trigger.

### Rebind by stable slot roles, never by rewriting template support

The slot-body plan remains the authority for stable mapped roles and revision-local support. After a successful candidate move, the runtime resolves whether the Agent is inside a printed slot instance, maps the plan's monitored roles to that instance's concrete Things, and replaces only that window's derived index entries. The old scope entries are removed in the same candidate. Ordinary unmapped material can trigger only where the sealed role plan explicitly permits material changes; newly invented mapped roles are never inferred.

Alternative considered: rewrite the shared template's support endpoints to the new instance. That would corrupt the single shared template and cross-trigger other examples.

### Compute defaults and store only explicit self-lock overrides

The authorization controller gains a second, independent decision after exact resolution and before fact exposure/mutation. The default read/write sets are calculated from the current Agent path and candidate contain tree, so a move automatically changes them without persistent duplicate facts. Explicit `jump.lock` is normalized to two independently evaluated rule sides:

```json
{
  "read": {
    "allow": [
      {"priority": 2, "from": "current", "descendants": "all"}
    ],
    "deny": [
      {"priority": 3, "from": "current", "parent": true}
    ]
  },
  "write": {
    "allow": [
      {"priority": 1, "from": "<ThingCoordinate from explore()[0]>", "descendants": 1}
    ],
    "deny": []
  }
}
```

Each rule includes its exact start and optionally the start's unique direct parent, same-parent peers and bounded/all descendants. Matching is evaluated independently for read/write: select the greatest positive-integer priority; deny wins any tie; if no rule matches, use the corresponding default. This fallback preserves current-node readability and descendant-only default writes instead of turning the presence of rules into a global allow or deny. A parent flag never includes the parent's peers. Omitted `read` or `write` contains no explicit matches and therefore uses the default throughout. The effective node-lock and self-lock decisions are intersected, retaining their distinct error codes.

Overrides live in the existing request-driven lock snapshot repository as a separate `windowSelfLocks` record keyed by the locked Agent path and source Program. Jump atomically remaps the key when it moves that same Agent. A same-window replacement is accepted only if set inclusion proves that every newly allowed coordinate was already allowed; priority/rule edits and relation-depth changes are reduced to the same effective-set comparison on the candidate tree.

Alternative considered: persist default boundaries on every Agent. They are derived from position, would become stale on movement and would create a second world fact representation.

### Reuse request-driven lock replacement for external recovery

The existing `lock()` result gains an optional, mutually exclusive window-self-lock form whose target is one exact Agent Thing coordinate and whose value is the same `{read,write}` policy. It uses `refresh.policy: "on_request"`: a successful explicit run atomically replaces the source Program's target override; emitting no window-self-lock entry removes that explicit override and restores the always-present default.

Before replacement, the caller must be able to write the exact target Agent through both its own self-lock and all ordinary node locks. If caller and target are the same Agent, the subset-only rule still applies; a different reachable caller may broaden, narrow or remove the override. No role, Agent type or named controller is privileged. Recycling the target removes its override. This is the minimum recovery mechanism: there is no active window with self-lock disabled and no hidden bypass.

Alternative considered: reserve a “总控” role. That would turn application vocabulary into kernel identity and fail when projects use other structures.

### Represent slot structural locks as plan-owned node-lock projections

`slot_body({"action":"seal","body":"...","lock":true})` writes `structureLock: true` into the deterministic visible plan. `false` or omission writes no structural projection. Each mapped instance role produces a plan-owned node lock with two classifiers:

- `self`: deny external Transform of name/type/detail/situation/contain position/support/Program rules, move, copy-as-role and delete;
- `descendants`: delegate to the normal node-lock and caller self-lock intersection, permitting unmapped material creation/modification.

Transform planning classifies the operation against the pre- and post-candidate role map, not only the touched field. Creating or importing a `槽模角色` mapping outside the active reseal plan is `SLOT_ROLE_FORGERY_DENIED`; ordinary unmapped subtrees remain material. Reseal carries an unforgeable in-process plan-source marker, but it is not an authorization bypass: the initiating caller must first pass its self-lock and the body/model node locks. Once admitted, the plan may replace its own mapped self projections while preserving existing material-conflict and whole-transaction rollback behavior.

Alternative considered: lock every mapped-slot subtree. That blocks the required fill/material use case and conflates a slot's definition with its contents.

### Publish contracts from one registry source

The function registry becomes the machine source for `jump`, `changed`, the `ThingCoordinate` runtime type, window-self-lock allow/deny policy/administration, slot-body boolean `lock`, errors and evaluation order. CLI Help renders concise syntax, default fallback, priority/deny resolution and denial behavior from the same definitions. It includes Program examples that place both absolute and current-relative `explore({...})[0]` return objects directly in `from`, without `.ref`. The slot Help explicitly states that `lock:false` permits any otherwise-authorized writer to alter instance structure and shows both allowed material fill and denied mapped-self mutation.

## Risks / Trade-offs

- **[Coordinate adapter meets two baselines]** → Isolate and contract-test current AtomView plus the future Thing-coordinate input; reject strings and refs at the public boundary.
- **[Set-inclusion checks are position-sensitive]** → Compare policies against the same candidate tree before publication; a move and policy change are validated together.
- **[External override producer is deleted or broken]** → Preserve its last valid request-driven snapshot, matching existing fail-closed lock lifecycle; recovery requires a reachable Program at the same source path or recycling the window.
- **[Nested Program evaluation approaches the 10-second budget]** → Index before evaluation, short-circuit recycle/when/changed, execute where only on a true hit, and charge all nested calls to the existing single-round budget.
- **[Role-forgery detection could misclassify material]** → Classify only the stable plan mapping verb/identity; never infer from name, type label or position.
- **[Concurrent four-axis merge changes internal records]** → Keep changes behind the coordinate adapter and do not modify the public four-axis target or restore retired support semantics.

## Migration Plan

1. Add red contract, scheduler, transaction, self-lock, slot-lock, Help and regression tests; verify each fails for the intended missing behavior.
2. Add the coordinate adapter and registry contracts, then `changed`/jump result validation and shared index entries.
3. Add candidate jump/recycle execution, atomic path/scope/index rebinding and rollback.
4. Add self-lock authorization/snapshots/external recovery, then slot structural projections and reseal marker checks.
5. Run focused suites throughout, strict OpenSpec validation, GitNexus impact/change detection, diff/requirement audit, then the full suite once for the final candidate.
6. Commit locally only. Total control owns four-axis integration, shared 4784 loading, ESG real acceptance, merge and push.

Rollback reverts the local commit. No production migration runs in this branch; explicit snapshot formats receive a version bump and fail closed if a newer record is read by an older runtime.
