# Atom Slot Adjacent Signal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement ephemeral `slot({"to":"up|down","labels":[...]})` delivery between direct Slot relatives, with receiver-owned `trigger("slot",...)` matching and invocation-local `signal()` access.

**Architecture:** Program source emits a validated Slot signal effect but never chooses a target. A small Graph resolver expands the sender’s direct parent or children into typed deliveries; the scheduler indexes Slot triggers by the receiving Program’s own path, matches `from` plus label policy, and provides one invocation-local signal to each execution. The interaction engine queues signal events alongside Transform events and commits all receiver effects through the existing candidate-world transaction.

**Tech Stack:** Node.js 24 ESM, Python isolated Program worker, Atom four-axis Graph runtime, `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-03-atom-slot-signal-design.md`

## Global Constraints

- Use existing Slot parent/child structure; do not add `climb` or a fifth Graph relation.
- Public send syntax is only `slot({"to":"up|down","labels":[...]})`; no path, target, cross-level, or horizontal option.
- Receiver syntax is `trigger("slot", {"from":"up|down","labels":[...],"match":"all|exact"}, callback)`; `match` defaults to `all`.
- A receiver Program owns only its own trigger; Slot and Strut Program contracts must not copy or introduce `nodes` target selection.
- `signal()` exposes only `{"from":"up|down","labels":[...]}` from the current invocation and fails outside a Slot-triggered invocation.
- Signals are ephemeral, do not increment world revision, do not auto-forward, and do not grant Transform permission.
- Receiver effects remain inside the current central atomic transaction; failure leaves no partial world write.
- Implement one current ABI only; do not add legacy aliases or a dual execution branch.

---

## File Structure

- **Create `work-engine/atom-language/slot-signal-runtime.mjs`**: validate/expand sender effects into direct-relative typed deliveries; contains no Program execution or persistence.
- **Modify `work-engine/atom-language/program-worker.py`**: public `slot()` and `signal()` functions, Slot trigger source validation, invocation-local callback behavior.
- **Modify `work-engine/atom-language/program-runtime.mjs`**: normalize effects, index receiver-owned Slot triggers, match typed deliveries, isolate invocation context, claim/deduplicate execution.
- **Modify `work-engine/atom-language/engine.mjs`**: queue ephemeral Slot events through reconciliation and confirm/release delivery claims with the surrounding transaction.
- **Modify `work-engine/atom-language/program-function-registry.json`**: publish the two new functions and bump the registry to version 7.
- **Modify `work-engine/atom-language/program-function-registry.mjs`, `work-engine/atom-language/cli.mjs`**: consume registry version 7 and document the single public contract.
- **Create `tests/atom-slot-signal-runtime.test.mjs`**: Graph resolution unit tests.
- **Create `tests/atom-slot-signal-scheduling.test.mjs`**: Program ABI, matching, invocation isolation, and delivery deduplication tests.
- **Create `tests/atom-slot-signal-e2e.test.mjs`**: complete upward/downward interaction, transaction, and revision behavior.
- **Modify `tests/atom-program-function-registry.test.mjs`**: registry and Help assertions for the current ABI.

---

### Task 1: Program ABI and Receiver-Owned Trigger Contract

**Files:**
- Modify: `work-engine/atom-language/program-worker.py`
- Modify: `work-engine/atom-language/program-runtime.mjs`
- Test: `tests/atom-slot-signal-scheduling.test.mjs`

**Interfaces:**
- Produces: Program result `slotSignals: Array<{sourceProgramPath,to,labels}>`.
- Produces: trigger contract `{mode:"slot",parameters:{from,labels,match},entrypoint}`.
- Consumes later: `programArguments={mode:"slot",from,labels,id,revision,sourcePath,recipientPath}`.

The new scheduling test uses this exact fixture builder so slash-separated Program paths become real nested Slot structure rather than synthetic names:

```js
function atom(thing, situation = '', slot = [], type = '') {
  return { [`thing${type ? `@${type}` : ''}`]: thing, situation, slot, strut: [] };
}

function program(path, situation, slot = []) {
  const names = path.split('/');
  let value = atom(names.pop(), situation, slot, 'program');
  while (names.length) value = atom(names.pop(), '', [value]);
  return value;
}
```

- [ ] **Step 1: Write failing source-contract tests**

```js
test('slot trigger declares receiver-owned labels without nodes', async () => {
  const world = [program('Root/Receiver', [
    'def receive():',
    '    notice = signal()',
    'trigger("slot", {"from":"up","labels":["状态上报"]}, receive)'
  ].join('\n'))];
  const scheduler = createProgramRuntimeScheduler();
  await scheduler.refresh(world);
  assert.deepEqual(scheduler.triggerContracts.get('Root/Receiver').contract, {
    mode: 'slot',
    parameters: { from: 'up', labels: ['状态上报'], match: 'all' },
    entrypoint: 'receive'
  });
});

test('slot effect contains direction and labels but no destination', async () => {
  const cycle = await createProgramRuntimeScheduler().refresh([
    program('Sender', 'slot({"to":"down","labels":["受伤通告","紧急"]})')
  ], { programSelector: 'Sender', force: true });
  assert.deepEqual(cycle.slotSignals, [{
    sourceProgramPath: 'Sender', to: 'down', labels: ['受伤通告', '紧急']
  }]);
});
```

- [ ] **Step 2: Run the focused tests and confirm RED**

Run: `node --test tests/atom-slot-signal-scheduling.test.mjs`

Expected: FAIL because `slot`, `signal`, Slot trigger mode, and `cycle.slotSignals` do not exist.

- [ ] **Step 3: Add strict Python source and effect validation**

Implement in `program-worker.py`:

```python
def slot(specification):
    specification = require_object(specification, "slot")
    if set(specification) != {"to", "labels"}:
        raise EngineCallError("INVALID_SLOT_SIGNAL", "slot() requires only to and labels")
    if specification["to"] not in {"up", "down"}:
        raise EngineCallError("INVALID_SLOT_SIGNAL_DIRECTION", "slot.to must be up or down")
    labels = specification["labels"]
    if (not isinstance(labels, list) or not labels
            or any(not isinstance(label, str) or not label for label in labels)
            or len(set(labels)) != len(labels)):
        raise EngineCallError("INVALID_SLOT_SIGNAL_LABELS", "slot.labels must be unique non-empty strings")
    effects["slotSignals"].append({
        "sourceProgramPath": current_atom().path,
        "to": specification["to"],
        "labels": list(labels),
    })

def signal():
    value = request.get("programArguments")
    if (request.get("triggered") is not True or not isinstance(value, dict)
            or value.get("mode") != "slot"):
        raise EngineCallError("SLOT_SIGNAL_REQUIRED", "signal() requires one active Slot signal invocation")
    return {"from": value["from"], "labels": list(value["labels"])}
```

Add both names to the worker namespace/effect envelope. Extend `extract_trigger_contract()` so Slot callbacks accept zero arguments; require `from`, `labels`, optional `match`; normalize omitted `match` to `all`; reject every other key and value.

- [ ] **Step 4: Normalize Slot effects in JavaScript runtime**

In `validateProgramResult()` validate each Python effect and return:

```js
const slotSignals = (result.slotSignals ?? []).map((entry) => ({
  sourceProgramPath: program.path,
  to: entry.to,
  labels: [...entry.labels]
}));
```

Reject malformed source paths, directions, empty/duplicate labels, and extra fields with `INVALID_SLOT_SIGNAL_EFFECT`. Add `slotSignals` to empty/cached results and to the cycle aggregation only for executions with `cached === false`.

- [ ] **Step 5: Run contract tests and existing Python runtime tests**

Run: `node --test tests/atom-slot-signal-scheduling.test.mjs tests/atom-python-program-runtime.test.mjs`

Expected: PASS; existing Python sandbox tests remain green.

- [ ] **Step 6: Commit Task 1**

```bash
git add work-engine/atom-language/program-worker.py work-engine/atom-language/program-runtime.mjs tests/atom-slot-signal-scheduling.test.mjs
git commit -m "feat(slot): add signal program contract"
```

---

### Task 2: Direct Slot Resolution and Typed Delivery

**Files:**
- Create: `work-engine/atom-language/slot-signal-runtime.mjs`
- Create: `tests/atom-slot-signal-runtime.test.mjs`

**Interfaces:**
- Consumes: `{sourceProgramPath,to,labels}` from Task 1.
- Produces: `resolveSlotSignalDeliveries(atoms,effects,{revision,createId})` returning typed deliveries.

- [ ] **Step 1: Write Graph resolution RED tests**

```js
test('up resolves only the direct parent and flips to receiver-relative down', () => {
  const world = [atom('Root', '', [atom('Parent', '', [program('Child', '')], 'program')], 'program')];
  const deliveries = resolveSlotSignalDeliveries(world, [{
    sourceProgramPath: 'Root/Parent/Child', to: 'up', labels: ['状态上报']
  }], { revision: 'sha256:r1', createId: () => 'signal-1' });
  assert.deepEqual(deliveries, [{
    mode: 'slot', id: 'signal-1', revision: 'sha256:r1',
    sourcePath: 'Root/Parent/Child', recipientPath: 'Root/Parent',
    from: 'down', labels: ['状态上报']
  }]);
});

test('down broadcasts only to direct children and marks them from up', () => {
  const world = [program('Parent', '', [program('A', ''), program('B', '', [program('Grandchild', '')])])];
  assert.deepEqual(
    resolveSlotSignalDeliveries(world, [{
      sourceProgramPath: 'Parent', to: 'down', labels: ['通告']
    }], { revision: 'sha256:r2', createId: (() => { let n = 0; return () => `s${++n}`; })() })
      .map(({ recipientPath, from }) => ({ recipientPath, from })),
    [{ recipientPath: 'Parent/A', from: 'up' }, { recipientPath: 'Parent/B', from: 'up' }]
  );
});
```

- [ ] **Step 2: Run the resolver tests and confirm RED**

Run: `node --test tests/atom-slot-signal-runtime.test.mjs`

Expected: FAIL because the resolver module is absent.

- [ ] **Step 3: Implement the pure resolver**

Use `walkAtoms(atoms)` to build exact path entries. For `up`, take `source.path.slice(0,-1)` and require a real direct parent; for `down`, select entries whose path length is exactly `source.path.length + 1` and whose prefix equals the sender path. Preserve child ordinal order, generate one identity per delivery, freeze cloned labels, and throw `SLOT_SIGNAL_SOURCE_NOT_FOUND` when the claimed source Program no longer exists.

- [ ] **Step 4: Add boundary tests**

Cover: top-level `up` yields zero deliveries; leaf `down` yields zero; grandchildren are excluded; duplicate sender effects receive distinct ids; input arrays are not mutated.

- [ ] **Step 5: Run and commit Task 2**

Run: `node --test tests/atom-slot-signal-runtime.test.mjs`

Expected: PASS.

```bash
git add work-engine/atom-language/slot-signal-runtime.mjs tests/atom-slot-signal-runtime.test.mjs
git commit -m "feat(slot): resolve adjacent signal recipients"
```

---

### Task 3: Scheduler Matching, Invocation Isolation, and Deduplication

**Files:**
- Modify: `work-engine/atom-language/program-runtime.mjs`
- Modify: `tests/atom-slot-signal-scheduling.test.mjs`

**Interfaces:**
- Consumes: internal trigger event `{mode:"slot",nodes:[recipientPath],signals:[delivery...]}`.
- Produces: exactly one receiver execution per unique signal identity and `slotSignalClaims` for transaction confirmation.

- [ ] **Step 1: Add matching and isolation RED tests**

```js
test('all and exact match independently on the receiver path', async () => {
  const scheduler = createProgramRuntimeScheduler();
  const world = [
    program('Root/All', receiver('up', ['A'], 'all')),
    program('Root/Exact', receiver('up', ['A'], 'exact')),
    program('Other', receiver('up', ['A'], 'all'))
  ];
  await scheduler.refresh(world);
  const cycle = await scheduler.refresh(world, { triggerEvent: slotEvent([
    delivery('s1', 'Root/All', 'up', ['A', 'B']),
    delivery('s2', 'Root/Exact', 'up', ['A', 'B'])
  ]) });
  assert.deepEqual(cycle.messages.map(({ text }) => text), ['up:A,B']);
  assert.deepEqual(cycle.executedProgramPaths, ['Root/All']);
});

test('signal context is invocation-local during concurrent refreshes', async () => {
  const scheduler = createProgramRuntimeScheduler();
  const world = [program('Receiver', receiver('up', ['A'], 'all'))];
  await scheduler.refresh(world);
  const cycles = await Promise.all([
    scheduler.refresh(world, { triggerEvent: slotEvent([delivery('s1', 'Receiver', 'up', ['A'])]) }),
    scheduler.refresh(world, { triggerEvent: slotEvent([delivery('s2', 'Receiver', 'up', ['A', 'B'])]) })
  ]);
  assert.deepEqual(cycles.flatMap((cycle) => cycle.messages.map(({ text }) => text)).sort(), [
    'up:A', 'up:A,B'
  ]);
});
```

- [ ] **Step 2: Run focused scheduling tests and confirm RED**

Run: `node --test tests/atom-slot-signal-scheduling.test.mjs`

Expected: FAIL because Slot trigger events are not accepted or indexed.

- [ ] **Step 3: Index Slot triggers by receiver ownership**

Update `setTriggerContract`, `removeTriggerContract`, and `backfillTriggerIndexForEvent` so `mode:"slot"` is indexed as `slot\0${program.path}`. Do not read `parameters.nodes`. Add:

```js
function slotSignalMatches(parameters, signal) {
  if (parameters.from !== signal.from) return false;
  const required = new Set(parameters.labels);
  const actual = new Set(signal.labels);
  return parameters.match === 'exact'
    ? required.size === actual.size && [...required].every((label) => actual.has(label))
    : [...required].every((label) => actual.has(label));
}
```

- [ ] **Step 4: Execute one operation per matching delivery**

Validate Slot trigger events strictly. Build `slotSignalInvocationsByProgram`, include only a delivery whose `recipientPath === program.path` and whose contract matches, and pass the delivery as `programArguments`. Keep `invokeMain:false`; Python `trigger()` invokes its zero-argument callback and `signal()` reads `programArguments`.

- [ ] **Step 5: Add claim lifecycle and duplicate-event test**

Use key `programPath + "\0" + signal.revision + "\0" + signal.id + "\0" + signal.recipientPath`. Add `confirmSlotSignals()` and `releaseSlotSignals()` parallel to the proven Strut claim lifecycle; clone the map into candidate runtimes. Return `slotSignalClaims` only for successfully executed uncached receivers.

Test two sequential and two concurrent refreshes with the same typed signal; after confirmation, total messages must equal one. Mark a Slot-triggered receiver failure as `blocking:true`, matching typed Strut delivery semantics, because isolating it would permit partial sender/receiver state. On receiver failure or filtered context, release the claim so a later legitimate retry can execute.

- [ ] **Step 6: Verify scheduling and regression tests**

Run: `node --test tests/atom-slot-signal-scheduling.test.mjs tests/atom-program-runtime-scheduling.test.mjs tests/atom-program-projection-lifecycle.test.mjs`

Expected: PASS.

- [ ] **Step 7: Commit Task 3**

```bash
git add work-engine/atom-language/program-runtime.mjs tests/atom-slot-signal-scheduling.test.mjs
git commit -m "feat(slot): schedule receiver-owned signals"
```

---

### Task 4: Atomic Engine Reconciliation and Public Contract

**Files:**
- Modify: `work-engine/atom-language/engine.mjs`
- Modify: `work-engine/atom-language/program-function-registry.json`
- Modify: `work-engine/atom-language/program-function-registry.mjs`
- Modify: `work-engine/atom-language/program-worker.py`
- Modify: `work-engine/atom-language/cli.mjs`
- Create: `tests/atom-slot-signal-e2e.test.mjs`
- Modify: `tests/atom-program-function-registry.test.mjs`
- Modify: `docs/superpowers/plans/2026-09-03-session-recovery-checkpoint.md`

**Interfaces:**
- Consumes: `cycle.slotSignals` and `resolveSlotSignalDeliveries()`.
- Produces: queued internal Slot event without world revision change; receiver effects enter the existing candidate transaction.

- [ ] **Step 1: Write upward/downward E2E RED tests**

```js
test('down signal triggers only matching direct child and atomically persists its effect', async () => {
  const world = [program('Parent', [
    'def main(arguments):',
    '    slot({"to":"down","labels":["交棒"]})'
  ].join('\n'), [
    program('Receiver', [
      'def receive():',
      '    notice = signal()',
      '    transform({"thing":"Target","situation.rep." + notice["labels"][0]:None})',
      'trigger("slot", {"from":"up","labels":["交棒"]}, receive)'
    ].join('\n'))
  ]), atom('Target', 'before')];
  const result = await executeFixture(world, 'transform {"thing.run.":"Parent"}');
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(readSituation(result.world, 'Target'), '交棒');
});
```

Add the mirror case for child `to:"up"` and parent `from:"down"`; add an unmatched sibling; add a receiver Transform denial that proves the entire interaction leaves the persisted world byte-identical.

- [ ] **Step 2: Run E2E tests and confirm RED**

Run: `node --test tests/atom-slot-signal-e2e.test.mjs`

Expected: FAIL because the engine does not reconcile ephemeral signal effects.

- [ ] **Step 3: Queue Slot events without requiring a world change**

Replace the single pending-event overwrite with an ordered queue local to `reconcileProgramsForWorld`. After each cycle:

```js
const deliveries = resolveSlotSignalDeliveries(reconciledAtoms, cycle.slotSignals ?? [], {
  revision: revisionOf(reconciledAtoms),
  createId: () => crypto.randomUUID()
});
if (deliveries.length) pendingTriggerEvents.push({
  mode: 'slot',
  nodes: [...new Set(deliveries.map(({ recipientPath }) => recipientPath))],
  signals: deliveries
});
```

Enqueue any Transform event separately instead of overwriting the Slot event. Continue reconciliation while the queue is non-empty even when revision is unchanged; signal-only completion returns the original atoms and revision.

- [ ] **Step 4: Bind signal claims to transaction outcome**

Remember `cycle.slotSignalClaims` beside Strut claims. Confirm both only after successful commit, or immediately after a signal-only interaction with no world change; release both on every failure path. Add a regression assertion that an authorized receiver Transform commits once and a denied Transform leaves the signal retryable.

- [ ] **Step 5: Publish registry version 7**

Add `slot` to kernel Graph functions and `signal` to kernel Program functions with exact argument/result/error contracts. Change every Program registry version gate from 6 to 7 in JSON, JavaScript CLI/validator, Python worker, and tests. Do not change the unrelated Work Order registry version.

- [ ] **Step 6: Update Help and registry tests**

Help must show:

```text
Slot信号：slot({"to":"up|down","labels":[...]})只沿直接父子Slot投递；接收节点自己的Program用trigger("slot", {"from":"up|down","labels":[...],"match":"all|exact"}, main)，回调内signal()读取本次来源与标签。信号不写事实、不自动续传、不授予权限。
```

Update the Graph/Program function lists and assert that the registry contains both functions, version 7, and no Slot trigger `nodes` field.

- [ ] **Step 7: Run focused, system, and full verification**

Run:

```bash
node --test tests/atom-slot-signal-runtime.test.mjs tests/atom-slot-signal-scheduling.test.mjs tests/atom-slot-signal-e2e.test.mjs tests/atom-program-function-registry.test.mjs
npm run test:system
npm test
git diff --check
```

Expected: all commands exit 0; no whitespace errors.

- [ ] **Step 8: Run isolated real command verification**

Start a temporary Atom server on an ephemeral port with a temporary world containing the upward and downward fixtures. Use the actual CLI endpoint to run the sender Program, exact Explore the receiver-written target, restart the temporary server, and repeat once. Verify:

- `up` and `down` each reach only direct relatives;
- unmatched Programs do not run;
- `signal()` exposes only `from` and `labels`;
- signal-only delivery leaves revision unchanged;
- receiver Transform is persisted and survives restart;
- an injected receiver failure leaves the world byte-identical.

- [ ] **Step 9: Persist evidence and commit Task 4**

Update the recovery checkpoint with test commands, results, implementation commits, remaining P0 queue work, and next resume point.

```bash
git add work-engine/atom-language/engine.mjs work-engine/atom-language/program-function-registry.json work-engine/atom-language/program-function-registry.mjs work-engine/atom-language/program-worker.py work-engine/atom-language/cli.mjs tests/atom-slot-signal-e2e.test.mjs tests/atom-program-function-registry.test.mjs docs/superpowers/plans/2026-09-03-session-recovery-checkpoint.md
git commit -m "feat(slot): deliver adjacent signals atomically"
```

---

## Self-Review

- **Spec coverage**：发送、相邻层级、来源视角、`all/exact`、`signal()`隔离、无自动续传、无事实写入、原子 effects、权限守恒、内部防重和真实验证均有对应任务。
- **Boundary coverage**：顶层 `up`、叶子 `down`、排除孙级、未匹配标签、并发上下文、重复投递、失败重试、无修订信号和失败零副作用均有测试。
- **Scope separation**：Strut `nodes`清除与 Transform diff envelope不混入本计划；它们留在恢复账本的后续独立工作。
- **Type consistency**：外部 effect、内部 typed delivery、trigger contract、worker `programArguments`和`signal()`返回值使用一套字段名。
