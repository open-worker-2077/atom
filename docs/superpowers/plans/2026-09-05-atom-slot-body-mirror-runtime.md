# Atom Slot Body Mirror Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让槽体由自身 Program 完成无改名封装，使任一槽例的数据事件按需借用槽模逻辑并只写回该槽例，并用最小两步少数据链证明 Flow 支撑可实际运行。

**Architecture:** `slot_body`以当前 Program 路径确定槽体，不接受业务方另传 body；封装保留候选 DataFlow 名称，以打印计划中的稳定角色和修订连接槽模逻辑与槽例数据。运行时从槽例事件进入，映射槽模内部相对／内部绝对选择器到当前槽例；外部绝对选择器保持真实目标。每次只执行实际触达链，不复制 Program，不扫描其他槽例。

**Tech Stack:** Node.js 24、Python Program worker、Atom Graph-JSON、`node:test`、现有 Program Scheduler／World Transaction。

**Spec:** `docs/superpowers/specs/2026-08-31-atom-world-program-design.md` §4.2

## Global Constraints

- Program 节点负责逻辑，文本／事实节点负责槽例数据；白板函数不在本计划实现。
- Strut 后项由 Graph clause 决定，接收 Program 不得重新引入 `nodes`。
- 不直接编辑生产 `atom.json`；真实验收只在隔离少数据世界完成，确认后再部署代码。
- 验证只按“单项 RED/GREEN → 槽体聚焦链 → 最小两步真实旅程 → 必要系统门禁 → 最终候选全量一次”升级。
- 不为旧 `{action,body}` 合同保留永久双轨兼容；一次性世界迁移若必要，另行生成可回滚迁移计划。

---

### Task 1: Self-declared sealing without forced renaming

**Files:**
- Modify: `work-engine/atom-language/program-worker.py`
- Modify: `work-engine/atom-language/program-runtime.mjs`
- Modify: `work-engine/atom-language/slot-body-plan-runtime.mjs`
- Modify: `work-engine/atom-language/engine.mjs`
- Test: `tests/atom-slot-body-runtime.test.mjs`
- Test: `tests/atom-slot-body-plan-integration.test.mjs`

**Interfaces:**
- Consumes: `slot_body({"action":"seal"})` emitted by the current Program; generated print Program emits `slot_body({"action":"print","name":NAME})`.
- Produces: a sealed layout whose model is the one non-reserved direct child, retaining its original Thing name; receipts still expose exact `body`, `revision`, and print target.

- [x] **Step 1: Write the failing self-declaration tests**

```js
test('slot body Program seals itself and preserves the candidate DataFlow name', async () => {
  const world = [atom('订单槽体', 'slot_body({"action":"seal"})', [
    atom('订单流程', '', [atom('输入'), atom('输出')])
  ], [], ['program'])];
  const result = await runProgram(world, '订单槽体');
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.ok(find(result.atoms, '订单槽体/订单流程'));
  assert.equal(find(result.atoms, '订单槽体/槽模'), null);
  assert.ok(find(result.atoms, '订单槽体/print'));
  assert.ok(find(result.atoms, '订单槽体/槽例'));
});

test('slot_body rejects the retired caller-selected body parameter', async () => {
  const result = await runSource('slot_body({"action":"seal","body":"Root/别处"})');
  assert.equal(result.failures[0].code, 'INVALID_SLOT_BODY_EFFECT');
});
```

- [x] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
node --test --test-isolation=none tests/atom-slot-body-runtime.test.mjs tests/atom-slot-body-plan-integration.test.mjs
```

Expected: the self-declared seal fails because `body` is required, and the preservation assertion fails because `initialSeal` renames the candidate to `槽模`.

- [x] **Step 3: Implement the minimal self-declared contract**

```js
// Normalized public effect shape after Program validation.
const body = entry.action === 'seal'
  ? sourceProgramPath
  : sourceProgramPath.split('/').slice(0, -1).join('/');
return { action: entry.action, ...(entry.name ? { name: entry.name.trim() } : {}), body, sourceProgramPath };
```

In `layoutOf`, recognize a sealed body as exactly `print`, `槽例`, and one other direct child; set `modelPath` from that child's actual name. In `initialSeal`, remove endpoint relocation and the Thing rename, then create only `print` and `槽例`. Export one read-only layout helper for `engine.mjs`; use it in `programResealsModelPath(atoms, slotBodies, sourceProgramPath, targetPath)` so reseal authorization compares against the actual candidate path instead of appending `/槽模`.

- [x] **Step 4: Run the focused tests and verify GREEN**

Run:

```powershell
node --test --test-isolation=none tests/atom-slot-body-runtime.test.mjs tests/atom-slot-body-reseal.test.mjs tests/atom-slot-body-plan-integration.test.mjs
```

Expected: all tests pass; the sealed candidate keeps its original name, print succeeds, and reseal still preserves instance material.

- [ ] **Step 5: Commit Task 1**

```powershell
git add work-engine/atom-language/program-worker.py work-engine/atom-language/program-runtime.mjs work-engine/atom-language/slot-body-plan-runtime.mjs work-engine/atom-language/engine.mjs tests/atom-slot-body-runtime.test.mjs tests/atom-slot-body-plan-integration.test.mjs tests/atom-slot-body-reseal.test.mjs
git commit -m "refactor(slot-body): self-declare seals without renaming"
```

### Task 2: Map template-local logic onto the active instance

**Files:**
- Modify: `work-engine/atom-language/slot-relative-scope.mjs`
- Modify: `work-engine/atom-language/query-capability.mjs`
- Modify: `work-engine/atom-language/program-runtime.mjs`
- Modify: `work-engine/atom-language/engine.mjs`
- Test: `tests/atom-slot-body-plan-integration.test.mjs`
- Test: `tests/atom-slot-relative-scope.test.mjs`

**Interfaces:**
- Consumes: `{scopeRoot, programRoot}` from `slotProgramInvocationsForEvent`; Program selectors may be `.`, `./内部角色`, `PROGRAM_ROOT/内部角色`, or an exact path outside `programRoot`.
- Produces: template-local selectors normalized to the matching path below `scopeRoot`; external exact selectors unchanged; Transform effects carry enough invocation context for the same normalization after worker return.

- [x] **Step 1: Write failing selector and instance-isolation tests**

```js
test('scoped selector maps internal absolute paths but leaves external facts exact', () => {
  assert.equal(normalizeSlotMirrorSelector({
    selector: 'Root/订单槽体/订单流程/输出/结果料',
    programRoot: 'Root/订单槽体/订单流程',
    scopeRoot: 'Root/订单槽体/槽例/甲'
  }), 'Root/订单槽体/槽例/甲/输出/结果料');
  assert.equal(normalizeSlotMirrorSelector({
    selector: 'Root/共享/汇率',
    programRoot: 'Root/订单槽体/订单流程',
    scopeRoot: 'Root/订单槽体/槽例/甲'
  }), 'Root/共享/汇率');
});

test('one instance event reads and writes only that instance with shared template code', async () => {
  const changed = await run(runtime,
    'transform {"thing":"Root/订单槽体/槽例/甲/输入","situation.rep.甲":null}', scheduler);
  assert.equal(changed.ok, true, JSON.stringify(changed.errors));
  assert.equal(find(await committed(), 'Root/订单槽体/槽例/甲/输出').situation, '甲');
  assert.equal(find(await committed(), 'Root/订单槽体/槽例/乙/输出').situation, '');
  assert.equal(find(await committed(), 'Root/订单槽体/订单流程/输出').situation, '默认值');
});
```

- [x] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
node --test --test-isolation=none tests/atom-slot-relative-domain.test.mjs tests/atom-slot-body-plan-integration.test.mjs
```

Expected: an internal absolute selector is rejected as `SLOT_RELATIVE_SELECTOR_REQUIRED`, demonstrating the missing mirror mapping.

- [x] **Step 3: Implement one shared selector normalizer**

```js
export function normalizeSlotMirrorSelector({ selector, scopeRoot, programRoot }) {
  const relative = parseSlotRelativeSelector(selector);
  if (relative !== null) {
    return relative.length === 0 ? scopeRoot : `${scopeRoot}/${relative.join('/')}`;
  }
  if (selector === programRoot) return scopeRoot;
  if (selector.startsWith(`${programRoot}/`)) {
    return `${scopeRoot}/${selector.slice(programRoot.length + 1)}`;
  }
  return selector;
}
```

Use this function for Program Explore and post-worker Transform normalization. Pass `programRoot` alongside `scopeRoot` in `executeExplore` execution context and in validated Transform effects. Do not map paths outside `programRoot`; let ordinary Graph resolution and authorization handle them.

- [x] **Step 4: Verify GREEN and failure atomicity**

Run:

```powershell
node --test --test-isolation=none tests/atom-slot-relative-domain.test.mjs tests/atom-slot-body-plan-integration.test.mjs tests/atom-world-transaction.test.mjs
```

Expected: all tests pass; internal reads/writes affect only the active instance, external paths remain external, and a mapped write failure leaves the candidate world unchanged.

- [ ] **Step 5: Commit Task 2**

```powershell
git add work-engine/atom-language/slot-relative-scope.mjs work-engine/atom-language/query-capability.mjs work-engine/atom-language/program-runtime.mjs work-engine/atom-language/engine.mjs tests/atom-slot-relative-scope.test.mjs tests/atom-slot-body-plan-integration.test.mjs
git commit -m "feat(slot-body): borrow template logic for instance data"
```

### Task 3: Prove the minimal two-step Flow journey and publish the contract

**Files:**
- Create: `tests/atom-slot-body-two-step-flow.test.mjs`
- Modify: `work-engine/atom-language/cli.mjs`
- Modify: `work-engine/atom-language/program-function-registry.json`
- Modify: `docs/superpowers/plans/2026-09-03-atom-current-requirement-ledger.md`
- Modify: `docs/superpowers/plans/2026-09-03-session-recovery-checkpoint.md`

**Interfaces:**
- Consumes: self-declared seal/print contract from Task 1 and mirror selector contract from Task 2.
- Produces: one tiny two-step fixture that proves seal, print, instance data entry, strict Strut true/false, receiver-owned Trigger, business lock transition, status write-back, controlled jump, sibling isolation, rollback, cold restart, and Help/registry discoverability.

- [ ] **Step 1: Write the failing two-step journey**

```js
test('two-step slot instance unlocks and jumps without touching template or sibling', async (t) => {
  const runtime = await setupTwoStepWorld(t, { instances: ['甲', '乙'] });
  await run(runtime, 'transform {"thing.run.":"Root/两步槽体"}', scheduler);
  await run(runtime, 'transform {"thing.run.":"Root/打印甲"}', scheduler);
  await run(runtime, 'transform {"thing.run.":"Root/打印乙"}', scheduler);

  const completed = await run(runtime,
    'transform {"thing":"Root/两步槽体/槽例/甲/步骤一","situation.rep.✅ 完成":null}', scheduler);

  assert.equal(completed.ok, true, JSON.stringify(completed.errors));
  const world = await readWorld(runtime);
  assert.equal(find(world, 'Root/两步槽体/槽例/甲/步骤二').situation, '🏃‍♀️ 进行中');
  assert.equal(find(world, 'Root/两步槽体/槽例/乙/步骤二').situation, '⌛️ 等待');
  assert.equal(find(world, 'Root/两步槽体/两步流程/步骤二').situation, '⌛️ 等待');
  assert.equal(completed.jump?.destination, 'Root/两步槽体/槽例/甲/步骤二');
  assert.equal(await canEdit(runtime, 'Root/两步槽体/槽例/甲/步骤二'), true);
  assert.equal(await canEdit(runtime, 'Root/两步槽体/槽例/乙/步骤二'), false);
});
```

- [ ] **Step 2: Run only the two-step test and verify RED**

Run:

```powershell
node --test --test-isolation=none tests/atom-slot-body-two-step-flow.test.mjs
```

Expected: fail at the first unsupported contract or wrong instance effect; record that first failure in the ledger before changing production code.

- [ ] **Step 3: Close the journey one failure at a time**

For each failure, keep the same tiny fixture, add one assertion that names the broken contract, rerun to RED, make the smallest production change, then rerun to GREEN. Do not add a second fixture unless the first cannot express false, rollback, restart, or concurrency without weakening the assertion.

- [ ] **Step 4: Verify the complete affected chain**

Run:

```powershell
node --test --test-isolation=none tests/atom-slot-body-runtime.test.mjs tests/atom-slot-body-reseal.test.mjs tests/atom-slot-relative-scope.test.mjs tests/atom-slot-body-plan-integration.test.mjs tests/atom-slot-body-two-step-flow.test.mjs tests/atom-program-runtime-scheduling.test.mjs tests/atom-world-transaction.test.mjs
npm run test:system
git diff --check
```

Expected: zero failures and no diff-check errors. Do not run `npm test` until this chain and the actual isolated CLI journey are green.

- [ ] **Step 5: Run an actual isolated CLI journey and cold restart**

Start a server on an OS-assigned non-4784 port with a temporary two-step `atom.json`; use exact `--endpoint` and `--agent Verifier` for seal, print, input, false, true, lock readback, jump receipt, and sibling readback. Stop and restart that same temporary world, then repeat only the final exact reads. Assert its source template and sibling are unchanged and the restarted world retains the active instance result.

- [ ] **Step 6: Update Help, registry, and Superpowers evidence**

Document only the final public calls:

```python
slot_body({"action":"seal"})
use_program({"name":"Root/两步槽体/print","arguments":{"name":"工单甲"}})
```

The first call lives in the slot-body Program itself. The second call is used by an authorized caller Program because the existing `.run.` Transform deliberately carries no arbitrary Program arguments.

Record RED, GREEN, focused counts, CLI paths, restart evidence, commit, deployment revision, and remaining defects immediately in the existing ledger/checkpoint. Do not document whiteboard as implemented.

- [ ] **Step 7: Run the final candidate gate once**

Run:

```powershell
npm test
git diff --check
```

Expected: zero failures. If a test fails, diagnose that exact failure; do not repeat the whole suite until the candidate changes.

- [ ] **Step 8: Commit, integrate, deploy, and read back**

```powershell
git add tests/atom-slot-body-two-step-flow.test.mjs work-engine/atom-language/cli.mjs work-engine/atom-language/program-function-registry.json docs/superpowers/plans/2026-09-03-atom-current-requirement-ledger.md docs/superpowers/plans/2026-09-03-session-recovery-checkpoint.md
git commit -m "test(slot-body): prove two-step mirrored flow"
```

Fast-forward the verified implementation to `main`, deploy 4784 through the existing controlled restart path, confirm health/projection/build revision, then repeat the minimal public seal/print/read journey in an authorized disposable Graph domain. Push only under the user's existing explicit authorization and verify `origin/main` resolves to the local commit.
