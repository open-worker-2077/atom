## Context

See `proposal.md` and the four delta specs. The current `slot-body-runtime.mjs` recognizes `槽体 → 槽模／槽例 → 空槽例`, writes `槽模映照`, clones the blank subtree, and syncs instance structure from mappings. Program Explore currently receives only world-global exact selectors; scheduler caching is Program/world oriented rather than instance-scope oriented. Program effects already join the central candidate-world transaction, and the repaired Program-structure scheduler already prevents one known unrelated `SLOT_BODY_EXAMPLE_EXISTS` replay.

The redesign must replace the blank-template law without redefining Graph's axes. The parallel `feature/graph-four-axis-support` branch owns the eventual thing/situation/contain/support representation; this branch needs a narrow semantic adapter and must keep current Graph JSON compatible until total control merges both branches. The 4784 world and ESG business material are outside this branch's write authority.

## Goals / Non-Goals

**Goals:**

- Make one ordinary candidate DataFlow the only source definition before and after sealing.
- Keep the current and still-adopted historical print plans visible in Graph and use them as transaction inputs, not as documentation copies of hidden state.
- Give Program Explore/Transform one strict relative selector and one runtime-owned `scope_root` binding.
- Route one instance event to reachable shared Programs through only that body revision's local support graph.
- Re-seal and batch-sync with stable role identity, three-way defaults, per-instance revision evidence and atomic derived recomputation.

**Non-Goals:**

- Cross-instance reads, external shared material, arbitrary analytic predicates, `FILTER`/`SUM`, or a general query language.
- A second executable Atom type, a hidden template store, or a new persistent Graph axis.
- Permanent coexistence of multiple logical versions inside one slot body; users create another body for that.
- Editing ESG artifacts, running shared 4784 write acceptance, merging, or pushing from this branch.

## Decisions

### Seal one candidate child into a three-part body

Before first seal, `body` resolves to an ordinary container with exactly one direct child: the candidate DataFlow. `slot_body({"action":"seal","body":"..."})` is called by a Program outside that candidate. The candidate child is renamed in place to `槽模`; the executor adds direct children `print@program` and `槽例`. It does not copy the candidate and never creates `空槽例`.

On re-seal, the recognized layout is exactly those three direct children. Other direct technical or business children are rejected, while arbitrary structure remains allowed below `槽模`, `print`, and each instance. The same source nodes and Program text therefore survive first seal.

Alternative considered: accept an independently located model path and copy it under a new body. That would leave two definitions and make it unclear which later edit is authoritative. Wrapping the candidate root itself was also rejected because it changes the candidate's own data/metadata role; renaming its containing child preserves the ordinary graph object.

### Compile a canonical visible plan and immutable revision records

The compiler consumes a normalized semantic model and emits canonical JSON with:

- `schema`, `body`, `revision`, and ordered `roles`;
- each role's stable `role_id`, relative contain path, name-key types/description, default detail, and parent role;
- Program roles with exact model paths but no copy payload;
- normalized local support edges and the source-role-to-target-Program trigger index.

Canonicalization sorts object keys, roles by `role_id`, type sets and support edges before hashing. `revision` is `sha256:` plus the canonical plan digest excluding the revision field itself. The generated `print@program` detail contains a literal `PRINT_PLAN` plus `main(arguments)`, which emits an internal print effect containing `body`, `name`, and `revision`. Its child `修订` container stores one immutable child per still-adopted revision with the full canonical plan. The current plan appears both in executable Program detail and its revision record; old records may be removed only after no instance references them.

Each instance root carries reserved relation `采用槽模修订` to its immutable revision record. Each model/instance role carries reserved relation `槽模角色` to a stable role record below the relevant revision. These are visible audit relations, excluded by the semantic adapter from business support traversal. They solve rename/move identity without depending on path-derived runtime refs, which change with world revision and address.

Alternative considered: infer role identity from relative paths. It cannot distinguish rename/move from delete/add and makes three-way merge unsafe. Storing only a digest on the instance was rejected because it cannot recover the old defaults needed for merge.

### Generate every ordinary slot and no Program copies

Printing constructs a new instance directly from the current plan. It emits every non-Program role, preserves contain order, name-key types/description, detail defaults, and translates local support endpoints to instance roles. Support endpoints to Program roles remain exact links to the single model Program. No input/output vocabulary exists in the compiler or executor.

The runtime accepts the generated print effect only when `sourceProgramPath` is the body's current `print` path and its revision matches the visible current plan. A missing cache is rebuilt from visible plans; the cache never authorizes a print. This prevents hand-authored or stale effects from bypassing audit state.

Alternative considered: keep direct public `slot_body(action=print)` as a convenience. It permits a caller to omit or forge the plan and undermines the requirement that the print node itself is authoritative, so only the generated Program may emit print effects.

### Use `.` and `./…` with a runtime-owned scope binding

Program world functions recognize exactly `.` and `./segment[/segment...]` as relative names. Parsing rejects empty segments, `.` after the root, `..`, backslashes, and absolute names. Resolution starts at a bound `scope_root` and walks unique direct contain children. A scope-bound Program's data Explore and Transform must use relative names; `use_program()` may still select shared code by exact Program path, but the callee inherits the existing scope and cannot replace it.

Scope binding has two entry paths:

- Development: explicit `transform {"name.run.EXACT候选DataFlow":"EXACT_PROGRAM"}` uses the existing dot-command parameter position to carry `scope_root`; the runtime verifies that the root contains the selected Program and is the candidate being tested. This binding is execution context, not Program source and does not add a fifth persistent Graph key.
- Instance: the event router derives the instance root and revision; callers cannot supply or override the binding.

The Python worker receives `scopeRoot` beside the current Program record. Engine-side Explore resolves relative selectors before returning records. Relative Transform effects are normalized to exact paths only inside the candidate transaction and keep the original relative selector in diagnostics. This keeps absolute instance paths out of Program source and cached dependency keys include `(program, scope_root, revision)`.

Alternative considered: infer development scope from the Program's immediate parent. Nested Programs make that parent an accidental boundary. A caller-supplied instance scope was rejected because it would allow cross-instance execution.

### Treat registered instance roots as domain boundaries

Ordinary nested contain remains traversable. A nested boundary exists only at a direct instance root that has a valid `采用槽模修订` relation to another sealed body's visible revision. Resolution may return that boundary root as a value but cannot traverse below it from the outer scope. The nested body's own event routing establishes its scope.

At each segment, zero matches, multiple matches, and boundary crossing produce distinct errors. The runtime never falls back to global name lookup. Although valid Graph normally prevents duplicate siblings, explicit ambiguity handling protects corrupted candidates and makes failure deterministic.

Alternative considered: let `../` expose parents. It immediately permits sibling instances and external materials, contradicting v1 isolation, so parent traversal is absent rather than permission-gated.

### Compile support semantics through an adapter and route by event path

A small semantic interface supplies `directChildren(node)`, `directedSupports(node)`, `resolveSupportTarget(edge)`, and `isSystemRelation(edge)`. The current adapter reads Graph `children` and directed `partners`; the four-axis branch can replace only this adapter after merge. Reserved role/revision relations are system relations and never business triggers.

The plan compiler builds local support adjacency from model roles. In v1 the condition is precise structural/event matching: the changed source role and event mode must match an edge in the compiled local graph; arbitrary value predicates remain Program logic. Traversal stays within model roles, visits each role once, and schedules each reachable Program role once in deterministic plan order. Invalid or dangling local targets fail seal; cycles do not loop because reachability is visited-set bounded, while recomputation uses the same deterministic once-per-Program order.

For a Transform event, the router uses the changed exact path and an incrementally maintained instance-prefix index to find the nearest registered instance root. It reads that instance's revision relation, converts the suffix to a role through the revision plan, and consults only that plan's trigger index. It does not enumerate the `槽例` container, other bodies, or all Programs. Missing index entries are reconstructed by walking ancestors and validating visible body/instance markers, not by world scan.

Alternative considered: reuse global trigger selection with instance arguments. That selects Programs before it knows the owning instance and recreates cross-instance scans. Treating every Program dependency as a trigger was rejected because exact Explore must remain a pure read and unrelated Program catalogs must not replay effects.

### Synchronize by stable roles and three-way detail comparison

Re-seal first compiles a new plan while retaining all adopted old plans. For each selected instance:

1. Resolve existing model-owned nodes by `槽模角色`, not name.
2. Apply contain/name/type/description/support changes for continuing roles.
3. For detail, compare old plan default, current instance characters, and new plan default byte-for-byte. Equal-to-old becomes new; otherwise current stays and receipt records `preserved_customized`.
4. Create new roles with new defaults.
5. Remove a deleted role only when its instance subtree equals old defaults and has no instance-local relations. Otherwise detach model ownership, keep the subtree as local content, and report it.
6. Run the new plan's reachable derived Programs with this instance scope, then change `采用槽模修订` only if all effects validate.

One batch operates on a copy-on-write clone of the target body and commits once. A failure in any instance rolls back the batch. The default request processes all instances; an optional positive `limit` returns an opaque cursor containing body identity, target revision and last stable instance role/name, authenticated by a plan digest. Continuation validates all fields against current facts. Receipts contain `revision`, `processed`, `remaining`, `next_cursor`, `complete`, `default_updated`, and `preserved_customized`.

Alternative considered: rebuild each instance from the new plan. That loses personalized material. Updating only structure while preserving every detail also fails the confirmed requirement that untouched old defaults should advance to new defaults.

### Recompute inside the same candidate transaction

After one instance is structurally merged, the slot executor asks the scheduler to run the new plan's derived Program set against the candidate world with that instance scope. Relative transforms are applied back to the same candidate. Nested slot-body effects from a derived calculation are rejected as `SLOT_BODY_NESTED_EFFECT_FORBIDDEN` to avoid recursive transaction ownership; ordinary messages remain receipts, not proof of commit. Lock authorization, expected world revision, final Graph validation and persistence still happen once at the outer transaction boundary.

Alternative considered: commit structure and enqueue recomputation afterward. It exposes instances whose revision claims new logic while derived values are stale, and a recompute failure cannot roll back the structural half.

### Keep scheduling isolation positive and cache-safe

Only explicit `.run.`, exact changed-Program validation, normal indexed trigger, or the new instance support index selects a Program. Project/read-only modes validate and rebuild projection/index data with all messages, transforms and slot-body effects cleared. Dependency and result caches include scope/revision and never replay effects on cache hits.

This extends rather than replaces the existing Program-structure isolation repair. Regression tests retain the historical non-idempotent printer case and add exact Explore, new Program creation, service restart, multi-instance and re-seal variants.

## Errors and receipts

Public errors are grouped by the point where recovery is possible:

- Layout/plan: `INVALID_SLOT_BODY_LAYOUT`, `INVALID_SLOT_PRINT_PLAN`, `SLOT_BODY_NOT_SEALED`, `SLOT_BODY_EXAMPLE_EXISTS`, `SLOT_PRINT_PLAN_STALE`.
- Scope/role: `SLOT_SCOPE_ROOT_UNBOUND`, `SLOT_RELATIVE_SELECTOR_REQUIRED`, `SLOT_RELATIVE_TARGET_NOT_FOUND`, `SLOT_RELATIVE_TARGET_AMBIGUOUS`, `SLOT_SCOPE_BOUNDARY_CROSSING`, `SLOT_SCOPE_ROLE_MISMATCH`.
- Revision/transaction: `SLOT_BODY_REVISION_CONFLICT`, `SLOT_BODY_NESTED_EFFECT_FORBIDDEN`, plus existing world revision, lock, Program and Graph validation errors.

Every error includes `body`, `revision` when known, `scope_root` when bound, the original relative selector or role, and exact affected path only when it does not violate scope isolation. Success receipts expose exact paths for post-commit readback, but a receipt remains a plan/commit result rather than a substitute for Explore verification.

## Risks / Trade-offs

- **[Visible historical plans grow with revisions]** → Retain only current and still-adopted revisions; remove an old revision record only after local verification finds zero instance references.
- **[Stable role relations add technical Graph edges]** → Reserve two documented verbs, filter them in the semantic adapter, and expose them in Help so they are auditable rather than magical.
- **[Scoped scheduler changes affect caching and triggers]** → Key every cache by scope/revision and keep existing non-slot Programs on the unscoped path; run full scheduler, projection, CLI and transaction regressions.
- **[Batch failure can redo expensive work]** → Keep batches caller-sized and instance-atomic within one batch; return deterministic progress and never advance the cursor on failure.
- **[Parallel four-axis work changes representation]** → Keep all contain/support reads behind one adapter and avoid naming or persisting new axes; total control resolves any merge refactor.

## Migration Plan

1. Add red contract tests for the new three-part layout, visible plan schema, role/revision evidence, direct print and rejection of old blank layouts.
2. Add red scoped Explore/Transform, nested boundary, ambiguity, multi-instance support routing and unrelated Program isolation tests.
3. Replace the old blank-template runtime with plan compilation/printing, then add scoped scheduler execution and the semantic adapter.
4. Add red and green re-seal tests for structural changes, three-way defaults, preserved deleted material, batch cursor, per-instance revision and transactional recomputation.
5. Update registry and Help; run targeted suites, full `npm.cmd test`, strict OpenSpec validation, runtime constant scans and diff/impact review.
6. Commit locally with implementation and planning evidence. Do not push or merge.
7. Hand exact Help/test instructions and the local commit to total control. Total control alone schedules real ESG positive/negative trials in Atom `test`, exclusive 4784 writes, cross-branch merge/refactor and remote push.

Rollback is the common baseline/local parent commit. No migration writes are run against production facts from this branch; existing worlds using the old physical blank layout remain unchanged until an explicitly run new seal attempts them, where they receive `INVALID_SLOT_BODY_LAYOUT` rather than partial conversion.
