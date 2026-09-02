# Atom Slot Signal Relocation Closure Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to execute this follow-up plan task-by-task.

**Goal:** Close the two load-bearing relocation gaps found by the final Slot-signal review so no pending or initial Slot signal loses its real sender/receiver identity when the same atomic interaction renames or moves Graph nodes.

**Architecture:** Keep Slot deliveries typed and receiver-owned. Reuse the engine's authoritative relocation records to rewrite (1) initial explicit-run Slot sender paths before resolution and (2) every already-queued Slot delivery whenever a preceding candidate-world effect relocates its source or recipient. Preserve delivery id, revision, labels, direction and claim identity while rebuilding routing `nodes` from rewritten recipient paths. Transform-trigger index refresh remains ordered before delivery.

**Spec:** `docs/superpowers/specs/2026-09-03-atom-slot-signal-design.md`

## Global Constraints

- Preserve the public ABI and Program registry v7; no new public field, alias, compatibility branch or Graph relation.
- A relocation changes identity paths, not signal identity, labels, direction, revision or delivery id.
- Pending Slot events must be rewritten through every authoritative relocation before they are consumed; unrelated queued events remain FIFO.
- Initial explicit-run Slot effects must resolve from the sender's post-application path, including sender or ancestor rename/move.
- Receiver-owned trigger indexes must be refreshed at the rewritten path before the Slot delivery executes.
- All work remains in the current candidate transaction; failure rolls back and releases claims exactly as the completed Slot implementation requires.
- Do not touch live 4784, production worlds, remote branches, generated bundles or unrelated files.

---

### Task 1: Relocation-Stable Initial and Pending Deliveries

**Files:**
- Modify: `work-engine/atom-language/engine.mjs`
- Modify: `tests/atom-slot-signal-e2e.test.mjs`

**Interfaces:**
- Consumes authoritative relocation records already produced by candidate-world effect application.
- Rewrites internal Slot effect/delivery paths only; public `slot()`/`signal()` contracts remain unchanged.

- [ ] **Step 1: Add focused RED tests**
  - Explicit `.run.` sender renames itself or an ancestor and emits Slot in the same atomic run; the post-relocation direct receiver must execute.
  - Ordinary Transform-triggered sender queues Slot, then the earlier Transform-refresh event invokes a Program that renames or moves that receiver again; the already-queued delivery must follow the same receiver and execute once at its final path.
  - Assert no stale-path execution, duplicate execution, new-neighbor capture or claim leak.

- [ ] **Step 2: Confirm RED on the reviewed head**

Run:

```bash
node --test --test-isolation=none tests/atom-slot-signal-e2e.test.mjs
```

Expected: the new explicit sender/ancestor relocation and cascading queued-delivery cases fail while existing cases stay green.

- [ ] **Step 3: Implement one relocation rewrite path**
  - Introduce one focused helper that applies authoritative relocation records to Slot source/recipient paths.
  - Before resolving initial explicit-run Slot effects, rewrite each source Program path through the initial application relocations.
  - After every candidate application that returns relocations, rewrite all pending Slot trigger events before their next consumption; rebuild each event's internal routing `nodes` from its rewritten deliveries.
  - Preserve delivery id, revision, `from`, labels and FIFO position. Do not dynamically add unrelated new relatives.
  - Ensure the Transform refresh event for a relocation is consumed before its rewritten Slot delivery so the receiver-owned trigger index exists at the final path.

- [ ] **Step 4: Add boundary and regression assertions**
  - Chained rename plus move composes in order.
  - Relocating an unrelated node leaves the delivery byte-equivalent.
  - Removing or invalidating the true receiver fails explicitly or yields the existing non-match behavior without executing another node.
  - Existing direct rename/move parity, rollback, retry, `use_program()`, cache and `signal()` boundary tests remain green.

- [ ] **Step 5: Verify and commit**

Run:

```bash
node --test --test-isolation=none tests/atom-slot-signal-e2e.test.mjs
node --test --test-isolation=none tests/atom-slot-signal-runtime.test.mjs tests/atom-slot-signal-scheduling.test.mjs tests/atom-slot-signal-e2e.test.mjs tests/atom-program-function-registry.test.mjs
git diff --check
```

Commit:

```bash
git add work-engine/atom-language/engine.mjs tests/atom-slot-signal-e2e.test.mjs
git commit -m "fix(slot): rebase pending deliveries through relocations"
```

---

### Task 2: Final Verification and Recovery Evidence

**Files:**
- Modify: `docs/superpowers/plans/2026-09-03-session-recovery-checkpoint.md`

- [ ] **Step 1: Run relevant and broad gates**

Run the established Program/Strut/jump suite from the preceding report, then:

```bash
npm run test:system
npm test
git diff --check
```

- [ ] **Step 2: Run isolated real command verification**
  - Use a new temporary world and ephemeral port, never 4784.
  - Verify explicit sender/ancestor relocation and cascading receiver relocation each deliver once to the final path.
  - Restart the temporary server and confirm persisted receiver effects.

- [ ] **Step 3: Persist evidence and commit**
  - Record commits, exact test totals, temporary endpoint/path, restart result, and remaining live-4784 P0 in the recovery checkpoint.

```bash
git add docs/superpowers/plans/2026-09-03-session-recovery-checkpoint.md
git commit -m "docs(superpowers): close slot relocation recovery evidence"
```
