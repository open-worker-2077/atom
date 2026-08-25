## Context

See `proposal.md` and the four delta specs. The implementation at commit `cdc763d` already replaces the physical `空槽例` template with a visible print plan, stable role/revision relations, relative `./` scope and instance-local support routing. Its first revision still treats model-slot `detail` as `default_detail`, performs three-way character merging, preserves deleted customized roles by detaching them, and exposes `limit/cursor` reseal batching.

The formal v1 model corrects those points. A model contains abstract slot structure, support and shared Programs only. Slot `detail`／`situation` is contract metadata. Concrete material is an ordinary, unmapped Thing subtree added below a mapped instance slot. Re-seal must update mapped structure while preserving those material subtrees byte-for-byte, and must complete every instance in one atomic call. The parallel `feature/graph-four-axis-support` branch still owns the physical four-axis representation; this change consumes it through the existing semantic adapter and does not redefine axes.

## Goals / Non-Goals

**Goals:**

- Keep one ordinary candidate DataFlow as the source definition and one visible, deterministic print plan as the generation authority.
- Print all abstract slots and support structure with no Program copies and no default material.
- Bind shared Programs to one runtime-owned `scope_root`, route events to exactly one instance, and reject domain escape.
- Re-seal every instance in one call, preserving every unmapped local material subtree byte-for-byte and rolling back on structural conflict.
- Let outside orchestration provide variables only by first materializing a local Thing below the target instance slot.

**Non-Goals:**

- Cross-instance reads or calculations, direct external-node reads, shared-material lookup, `FILTER`/`SUM`, or a general query language.
- Default material in the model, three-way default-character merging, manual reseal batches, partial revision adoption, or continuation cursors.
- A new persistent Graph axis, ESG edits, shared 4784 writes, branch merge, or remote push.

## Decisions

### Seal one candidate child into a three-part body

Before first seal, `body` resolves to an ordinary container with exactly one direct child: the candidate DataFlow. An outside Program calls `slot_body({"action":"seal","body":"..."})`. The candidate child is renamed in place to `槽模`; the executor adds direct children `print@program` and `槽例`. It neither copies the candidate nor creates `空槽例`.

On re-seal, exactly those three direct children identify the body. Arbitrary model, print-revision and instance contents remain allowed beneath them. The same source nodes and Program text survive first seal.

Alternative considered: copy an independently located model into a new body. That leaves two definitions and makes later edits ambiguous.

### Compile slot contracts, never default material

The compiler consumes the normalized semantic model and emits canonical JSON containing:

- `schema`, `body`, `revision`, ordered roles and normalized local support edges;
- for each abstract slot, stable `role_id`, relative contain path, parent role, types, description and slot contract metadata;
- for each Program, its stable role and exact model path, but no copy payload;
- a source-role-to-target-Program trigger index.

Canonicalization sorts keys, roles, type sets and support edges before hashing. `revision` is the digest of the plan without its revision field. `print@program` exposes the current plan in its Program detail and stores immutable plan records for revisions still adopted by instances.

Each instance root carries reserved relation `采用槽模修订`; mapped model and instance slots carry `槽模角色`. These visible system relations are filtered from business support traversal. Model-slot `detail`／`situation` is compiled only as slot contract metadata. No plan field named `default_detail` and no material payload exists.

Alternative considered: use relative paths as identity. It cannot distinguish rename/move from delete/add. Treating contract characters as material was rejected because material must be an independently addressable Thing subtree.

### Generate mapped slots with no material and no Program copies

Printing builds a new instance directly from the current visible plan. It emits every non-Program mapped slot, contain order, type/description/contract metadata and plan-owned support. Support targets that are Programs continue to reference the single model Program. The printer does not create any unmapped child, so a new instance contains no concrete material.

The runtime accepts an internal print effect only from the body’s current `print@program` and only when the revision matches the visible plan. Missing caches are rebuilt from visible facts and never authorize or replay a print.

Alternative considered: public direct `slot_body(action=print)`. It lets callers bypass the visible Program authority and remains rejected.

### Bind `.` and `./…` to a runtime-owned domain

Program world functions recognize exactly `.` and `./segment[/segment...]`. Parsing rejects empty segments, later `.`, `..`, backslashes and absolute paths. Resolution walks unique direct contain children from the bound `scope_root`; it never falls back to global name lookup.

Development execution binds the candidate DataFlow. Instance execution derives the owning instance from the event path and adopted revision. `use_program()` may select shared code by exact Program path but inherits the caller’s scope. Relative Transform selectors are normalized to exact paths only inside the candidate transaction while diagnostics retain the original selector.

A registered nested instance root is a domain boundary: the outer scope may return the boundary node but cannot traverse beneath it. Zero matches, duplicate siblings and boundary crossing have distinct errors.

Alternative considered: caller-supplied instance scope or `../`. Both would allow sibling-instance or external-data access.

### Route support from one event to one instance

The semantic adapter supplies direct contain children, directed support targets and system-relation classification. The compiler builds revision-local support reachability and visits each role once. A Transform event first resolves the nearest owning instance root through the path index, converts the event path to a mapped role, and consults only that revision’s trigger index. Each reachable Program runs once with that instance as `scope_root`.

Normal event routing never enumerates sibling instances, other bodies or all Programs. Read-only exact Explore and cache/index restoration clear effects and cannot replay old print Programs.

Alternative considered: global Program trigger selection followed by an instance argument. That selects work before the owning domain is known and recreates world scans.

### Preserve unmapped material while synchronizing mapped slots

For every instance, re-seal performs this algorithm inside one candidate transaction:

1. Resolve existing abstract slots by `槽模角色`, never by name.
2. Classify children of mapped slots. A child with a valid role relation is another mapped slot; an ordinary child without one is the root of a local material subtree. Descendants below that root are opaque to slot synchronization.
3. Snapshot each local material subtree as complete Graph facts, including thing/situation characters and contain/support relations.
4. Update or rebuild only mapped slots from the new plan, applying name, parent, type, description, contract and plan-owned support changes; add new roles empty.
5. Reattach each material snapshot to its continuing mapped slot without normalizing, comparing or editing any byte.
6. Before deleting a mapped role, inspect it and mapped descendants for a material root. If present, return `SLOT_MATERIAL_CONTAINMENT_CONFLICT` with exact instance, slot and first material path. Do not detach, move or delete it. If absent, delete the obsolete mapped subtree.
7. Recompute derived Programs in the instance scope and change `采用槽模修订` only after every instance and effect validates.

One `seal` processes all instances and commits once. There is no `limit`, `cursor`, `next_cursor`, partial revision state or continuation registry. A failure in any instance rolls back the visible plan and every instance. Success receipts may list revision, processed instances, `complete:true` and preserved material paths, but no batching fields.

Alternative considered: rebuild instances without detaching material first. That loses user facts. Detaching a deleted role as local content silently changes ownership and is therefore replaced by a conflict. Partial batches were rejected because successful v1 re-seal means the whole body adopts one revision.

### Materialize outside variables before local execution

The slot Program never receives an external selector. Outside orchestration first creates or updates an unmapped ordinary Thing subtree below the designated mapped slot of exactly one instance, then emits the normal event for that instance’s mapped source slot. The router derives the same local scope as any other event. Shared Program source reads `./slot/material`; it cannot enumerate siblings or return to the external variable node.

Alternative considered: inject an external node handle into scope. It creates a two-domain Program and violates v1 isolation.

### Commit structure and recomputation together

Program `slot_body()` calls only register candidate effects. After the Program ends, the executor validates source authority, locks, expected world revision, new plan, all instance syncs, local recomputations and final Graph before one central commit. Nested slot-body effects during derived recomputation remain forbidden. Any error leaves no half-plan, half-instance or mixed revision.

## Errors and receipts

- Layout/plan: `INVALID_SLOT_BODY_LAYOUT`, `INVALID_SLOT_PRINT_PLAN`, `SLOT_BODY_NOT_SEALED`, `SLOT_BODY_EXAMPLE_EXISTS`, `SLOT_PRINT_PLAN_STALE`.
- Scope/role: `SLOT_SCOPE_ROOT_UNBOUND`, `SLOT_RELATIVE_SELECTOR_REQUIRED`, `SLOT_RELATIVE_TARGET_NOT_FOUND`, `SLOT_RELATIVE_TARGET_AMBIGUOUS`, `SLOT_SCOPE_BOUNDARY_CROSSING`, `SLOT_SCOPE_ROLE_MISMATCH`.
- Material/transaction: `SLOT_MATERIAL_CONTAINMENT_CONFLICT`, `SLOT_BODY_NESTED_EFFECT_FORBIDDEN`, plus existing world revision, lock, Program and Graph validation errors.

Material conflicts include the body, target revision, instance path, mapped slot path and first material path. Other errors include only exact paths that do not leak beyond the bound domain. Receipts remain commit evidence to be verified by exact Explore, not a substitute for facts.

## Risks / Trade-offs

- **[Historical plans grow]** → retain only current and still-adopted revisions after verifying zero remaining references.
- **[Whole-body reseal grows linearly]** → keep normal events strictly instance-local; reserve enumeration for explicit re-seal and commit atomically.
- **[Material detection depends on role evidence]** → validate every system role relation before synchronization; missing/duplicate mappings fail instead of guessing.
- **[Parallel four-axis work changes representation]** → keep contain/support reads behind the semantic adapter; total control owns merge refactoring.

## Migration Plan

1. Revise red contracts for contract-only plans, no default material and absence of batching fields.
2. Add red tests for two independent nested material subtrees, structural add/remove, byte-preserving re-seal and exact material-conflict rollback.
3. Replace default-detail compilation/merge and cursor logic with mapped-slot synchronization plus opaque material preservation.
4. Add an integration test in which outside orchestration materializes a local variable Thing and triggers only its owning instance.
5. Update Help and function registry; run focused suites, the full suite, strict OpenSpec validation, forbidden-constant scans and impact review.
6. Create a follow-up local commit without rewriting `cdc763d`; do not push or merge.
7. Return Help/test/commit evidence to total control. Total control alone schedules real ESG trials, exclusive 4784 writes, human review, cross-branch merge and remote push.

Rollback is the parent of the follow-up commit. No migration writes run against production facts from this branch.
