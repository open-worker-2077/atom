# Atom Interaction Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消除 Atom 完整交互之间的全局等待，保证每个交互独立闭环，且终止交互永不能迟到提交。

**Architecture:** HTTP 层不再串行完整 Atom 操作，而是为每个交互建立独立期限与 AbortSignal。该信号逐层传入 Interaction Runtime 和 World Service，在世界提交前作最后强制检查。权威写入仍由修订 CAS 与短提交临界区保护。

**Tech Stack:** Node.js 24, ESM, `node:test`, AbortController, Atom transactional world persistence.

**Spec:** `docs/superpowers/specs/2026-09-03-atom-interaction-isolation-design.md`

## Global Constraints

- Explore 不等待任何活跃写交互。
- 交互终止后不得提交。
- 不在内核盲目重放 Transform。
- 投影不属于权威提交临界区。
- 保留 interaction id 幂等回执。

---

### Task 1: HTTP 交互独立性

**Files:**
- Modify: `cli/lib/server.mjs`
- Test: `tests/atom-language-graph-server.test.mjs`

**Interfaces:**
- Consumes: `options.atomCommand(payload, lifecycle)`
- Produces: `lifecycle.signal: AbortSignal`; `ATOM_INTERACTION_TIMEOUT`; `drainAtomInteractions()` 等待活跃集合而非全局尾链。

- [ ] **Step 1: Write the failing tests**

新增两个真实 HTTP 行为用例：挂起 Transform 后 Explore 仍返回；挂起 Transform 不阻塞另一 Transform。不断言 mock 调用顺序，只断言 HTTP 完成与返回内容。

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test --test-name-pattern="hung Atom interaction" tests/atom-language-graph-server.test.mjs`

Expected: Explore/第二 Transform 在旧 `atomInteractionTail` 后无法完成，用例超时失败。

- [ ] **Step 3: Replace the global operation tail with active interaction tracking**

在 `atomCommandRequest` 中直接启动每个唯一 id 操作，将运行 Promise 放入 `Set`，终态后移除。`drainAtomInteractions()` 只用于服务关闭时等待当时快照，不介入请求调度。

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `node --test --test-name-pattern="hung Atom interaction|independent explore|duplicate HTTP" tests/atom-language-graph-server.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

Commit: `fix(runtime): isolate atom http interactions`

### Task 2: 交互期限与提交防护

**Files:**
- Modify: `cli/lib/server.mjs`
- Modify: `work-engine/atom-language/graph-server.mjs`
- Modify: `src/atom-system/public/interaction-runtime.mjs`
- Modify: `src/atom-system/adapters/legacy-engine-adapter.mjs`
- Test: `tests/atom-language-graph-server.test.mjs`
- Test: `tests/atom-interaction-runtime.test.mjs`
- Test: `tests/atom-legacy-runtime-composition.test.mjs`

**Interfaces:**
- Consumes: Task 1 `lifecycle.signal`
- Produces: 超时终态回执；`world.execute({... signal })`；提交前 `signal.aborted` 防护。

- [ ] **Step 1: Write failing timeout and late-commit tests**

用可控 deferred world 执行验证：期限后返回 `ATOM_INTERACTION_TIMEOUT`；随后释放旧计算也不调用权威 commit。

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test --test-name-pattern="interaction timeout|late commit" tests/atom-language-graph-server.test.mjs tests/atom-interaction-runtime.test.mjs tests/atom-legacy-runtime-composition.test.mjs`

Expected: 旧生命周期无 signal/期限，测试失败。

- [ ] **Step 3: Thread AbortSignal through the runtime**

HTTP 层为交互建立 AbortController；Graph handler 将 signal 传入 runtime intent/options；Interaction Runtime 传入 world request；Legacy adapter 在开始、Program 边界、及 `persistence.commit` 前调用统一 `throwIfAborted`。

- [ ] **Step 4: Settle timeout receipts exactly once**

期限命中时 abort 当前交互，以 `ATOM_INTERACTION_TIMEOUT` 拒绝原回执；同 id 后续重试获得相同终态。迟到结果不得第二次 settle。

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `node --test --test-name-pattern="interaction timeout|late commit|duplicate HTTP" tests/atom-language-graph-server.test.mjs tests/atom-interaction-runtime.test.mjs tests/atom-legacy-runtime-composition.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

Commit: `fix(runtime): abort expired atom interactions before commit`

### Task 3: 提交临界区收缩

**Files:**
- Modify: `src/atom-system/world-runtime/commit-coordinator.mjs`
- Test: `tests/atom-world-transaction.test.mjs`

**Interfaces:**
- Consumes: candidate transition bound to `expectedRevision`; `AbortSignal`
- Produces: only journal/CAS/finalize serialization; `WORLD_REVISION_CONFLICT` for stale candidates.

- [ ] **Step 1: Write failing concurrency tests**

挂起一个 transition 计算，验证另一个候选计算不被它阻塞；两个候选提交时通过 CAS 保证最多一个基于旧修订成功。

- [ ] **Step 2: Run focused test and verify RED**

Run: `node --test --test-name-pattern="transition calculation|concurrent candidate" tests/atom-world-transaction.test.mjs`

Expected: 旧 coordinator 将 transition 包在 tail 内，第二个计算被阻塞。

- [ ] **Step 3: Calculate candidates before serialized commit**

读基础快照并计算 transition 时不持有 coordinator tail。进入短临界区后重新核对 expected revision，再 prepare/CAS/commit。

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `node --test tests/atom-world-transaction.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

Commit: `fix(runtime): serialize only authoritative atom commits`

### Task 4: 最小链验收

**Files:**
- Modify: `docs/superpowers/plans/2026-09-03-session-recovery-checkpoint.md`

**Interfaces:**
- Consumes: Tasks 1–3
- Produces: reproducible verification evidence and recovery checkpoint.

- [ ] **Step 1: Run the impacted chain**

Run: `node --test tests/atom-language-graph-server.test.mjs tests/atom-interaction-runtime.test.mjs tests/atom-legacy-runtime-composition.test.mjs tests/atom-world-transaction.test.mjs`

Expected: PASS.

- [ ] **Step 2: Run one ephemeral cold-start acceptance**

启动隔离世界，发起可控挂起 Transform，再发 Explore 和第二 Transform；验证两者不等待第一个，第一个期限后无权威写入。

- [ ] **Step 3: Run the system suite once**

Run: `npm run test:system`

Expected: PASS.

- [ ] **Step 4: Record exact evidence and commit**

在恢复断点记录命令、通过数、隔离服务修订和未触碰真实世界。

Commit: `docs(superpowers): record atom interaction isolation evidence`

