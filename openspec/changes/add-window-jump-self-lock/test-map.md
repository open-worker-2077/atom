## Test Mapping

### `window-jump-scheduling`

- **`tests/atom-window-jump-contract.test.mjs`** — catches accepting strings/refs/non-Program coordinates, unknown jump keys, wrong nested return types, wrong recycle/when/where order, implicit changed short-circuiting, or missing registry/Help contracts. Covers direct Explore coordinates, invalid references, guard-window defaults, false short circuit, recycle priority, true destination calculation, invalid changed inputs, hit/miss bool and Help discovery.
- **`tests/atom-window-jump-transaction.test.mjs`** — catches separate commits, partial movement, missing rollback, lock bypass or scope/index drift. Covers successful atomic jump, invalid/ambiguous/cyclic destination, lock denial, second-instance rebinding, old-instance non-triggering and invented-slot exclusion.

### `agent-window-self-lock`

- **`tests/atom-window-self-lock.test.mjs`** — catches incorrect default geometry or rule evaluation. Covers default positive/negative reads, descendant-only writes, self/peer/parent/branch write denial, exact-path enforcement, independent read/write, `current`, absolute Explore and current-relative Explore starts, fuzzy/ref rejection, positive integer validation, highest-priority resolution, deny-on-tie, default fallback, unique direct parent and node-lock intersection.
- **`tests/atom-window-self-lock-lifecycle.test.mjs`** — catches non-atomic snapshot replacement, path-stale overrides, self-expansion, hard-coded roles or hidden unlocks. Covers self tightening, self expansion denial, reachable external replacement/removal to defaults, recycle cleanup, movement remap, failed recompute retention and the minimal external recovery path.

### `slot-body-structure-locking`

- **`tests/atom-slot-body-structure-lock.test.mjs`** — catches non-boolean/default-on lock behavior, invisible/non-deterministic projection, subtree-wide denial, role forgery or role inference. Covers lock off/on, atomic projection, mapped self denial, allowed descendant material, fake/new/copied/moved role denial and ordinary material preservation.
- **`tests/atom-slot-body-structure-lock-integration.test.mjs`** — catches reseal bypass, partial projection, material loss or role-based authorization. Covers above-window lock intersection, authorized reseal, denial rollback, new/existing instance coverage and Help examples/risk.

Every assertion uses a hand-checked world fixture and observable result/committed world. No test derives its expected authorization or path set through production helpers.
