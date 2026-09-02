# Programmable Click Trigger Implementation Plan

> **已被用户定论取代（2026-09-02）**：本计划的独立 `click` 事件、`trigger("click")`、`POST /__atom/api/click` 与浏览器桥方案不得执行。点击属于 Graph Transform 的注册 `$` 动作：CLI 使用 `transform {"thing$click":"EXACT路径"}`，Web 翻译为同一动作；Strut 的内嵌 `if` Program可据此判定并只在 strict true 时向后项投递。实施前必须依据 `specs/2026-08-31-atom-world-program-design.md` 重写新计划。本页仅保留为被否决方案的追溯证据。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让每次物理点击形成无上限累计次数，并由 Atom Program 通过精确点击次数声明安全触发运行。

**Architecture:** Web 输入仲裁器继续负责既有单击、双击、三击视觉意图，同时额外逐击发布稳定目标与累计次数。浏览器桥把事件串行提交给 4784；交互运行时把它作为不由客户端指定 Program 的 `click` 触发事件交给 Program 调度器，调度器按 exact 节点与 exact 次数匹配，并继续通过 Program 所属 Agent、实际 Graph 路径和锁链提交效果。

**Tech Stack:** Browser JavaScript、Node.js ESM、Python AST Program worker、Node test runner、Playwright。

**Spec:** `docs/superpowers/specs/2026-08-31-atom-web-spatial-design.md` §5.3。

## Global Constraints

- 每次物理点击是一个原子事件；同一稳定 Thing、同一按钮和有效间隔内次数不设上限。
- 目标或按钮变化、相邻点击超时后从 `1` 重新计数。
- Program 只声明 exact 正整数次数；Web 不得把三点击用途或 Program 名称写死。
- 浏览器不能授予运行权限；服务端按 Program 所属 Agent、Graph 路径和锁重新鉴权。
- 没有匹配 Program 时保留既有单击选择、双击进入和三击动作。
- 重复提交同一 `eventId` 最多运行一次。

---

### Task 1: 无上限点击序列与逐击事件

**Files:**
- Modify: `spatial-gesture-arbiter.js`
- Modify: `spatial-engine.js`
- Test: `tests/spatial-gesture-arbiter.test.js`
- Test: `tests/gesture-contract.test.js`

**Interfaces:**
- Consumes: `createPrimaryClickArbiter({ delay, setTimer, clearTimer, commit })`。
- Produces: 新增可选 `observe({ signature, count, action })`；`submit()`返回`pending:N`且不在 3 次后重置。

- [ ] **Step 1: Write the failing sequence tests**

```js
test('primary arbiter observes every same-target click without a count ceiling', () => {
  // submit four times; observe receives 1,2,3,4 and pendingCount remains 4
});

test('primary arbiter resets observed count after target change or timeout', () => {
  // target switch and settled sequence both restart at 1
});
```

- [ ] **Step 2: Run tests to verify RED**

Run: `node --test tests/spatial-gesture-arbiter.test.js tests/gesture-contract.test.js`

Expected: FAIL because the arbiter has no `observe` callback and resets at three.

- [ ] **Step 3: Implement the minimal arbiter and browser event**

```js
const observe = typeof options.observe === 'function' ? options.observe : function noop() {};
// after increment: observe(Object.freeze({ signature: safeSignature, count: pendingCount, action: actionForCount() }));
// preserve immediate third-click UI commit with an uiCommitted flag, but keep the sequence pending.
```

`spatial-engine.js` must dispatch one `CustomEvent('atom-program-click', {detail:{eventId,targetPath,button,count}})` from `observe`; `targetPath` comes only from the stable projected node `atomPath`.

- [ ] **Step 4: Run tests to verify GREEN**

Run: `node --test tests/spatial-gesture-arbiter.test.js tests/gesture-contract.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add spatial-gesture-arbiter.js spatial-engine.js tests/spatial-gesture-arbiter.test.js tests/gesture-contract.test.js
git commit -m "feat(web): emit unbounded click counts"
```

### Task 2: Program `click` Trigger 合同与调度

**Files:**
- Modify: `work-engine/atom-language/program-worker.py`
- Modify: `work-engine/atom-language/program-runtime.mjs`
- Modify: `work-engine/atom-language/engine.mjs`
- Test: `tests/atom-program-click-trigger.test.mjs`

**Interfaces:**
- Consumes: `trigger(mode, parameters, entrypoint)`、`ProgramRuntimeScheduler.refresh(atoms,{triggerEvent})`。
- Produces: `trigger("click",{"nodes":[exactPath],"count":N},main)`与`triggerEvent={mode:"click",nodes:[exactPath],event:{eventId,targetPath,button,count}}`。

- [ ] **Step 1: Write failing Program contract tests**

```js
test('click trigger requires one event argument and an exact positive count', async () => {
  // valid count 4 compiles; zero, fractions, extra keys and no-argument main reject.
});

test('click event runs only the exact node and exact count subscriber once', async () => {
  // count 3 runs the count-3 subscriber but not count-2 or another node.
});
```

- [ ] **Step 2: Run tests to verify RED**

Run: `node --test tests/atom-program-click-trigger.test.mjs`

Expected: FAIL with `trigger() supports only transform or strut mode`.

- [ ] **Step 3: Implement the Program worker contract**

```python
elif mode == "click":
    if len(function.args.args) != 1 or function.args.vararg or function.args.kwarg:
        raise ProgramSecurityError("trigger click entrypoint must accept one event argument")
```

Validate parameters as exactly `{"nodes": non_empty_unique_strings, "count": positive_int}` and call `entrypoint(request["programArguments"])` only when triggered.

- [ ] **Step 4: Implement runtime event validation and exact-count filtering**

Accept `click` beside `transform` and `strut`; require one existing target node and an event whose `targetPath`, `count`, `button`, and `eventId` match the trigger envelope. Build the Program argument on the server with authoritative `revisionOfWorldFacts(atoms)`. Filter indexed node subscribers by `contract.parameters.count === triggerEvent.event.count` before marking them forced.

- [ ] **Step 5: Forward the event through the world engine**

Add `options.programTriggerEvent` to the initial scheduler refresh options. It is valid only for parsed `atom` with `programMode:'reconcile'`; Program effects continue through the existing candidate runtime, authorization and central commit path.

- [ ] **Step 6: Run tests to verify GREEN**

Run: `node --test tests/atom-program-click-trigger.test.mjs tests/atom-program-service-e2e.test.mjs`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add work-engine/atom-language/program-worker.py work-engine/atom-language/program-runtime.mjs work-engine/atom-language/engine.mjs tests/atom-program-click-trigger.test.mjs
git commit -m "feat(program): add exact click triggers"
```

### Task 3: 4784 点击入口、幂等和浏览器桥

**Files:**
- Modify: `src/atom-system/public/interaction-runtime.mjs`
- Modify: `work-engine/atom-language/graph-server.mjs`
- Modify: `cli/lib/server.mjs`
- Modify: `spatial-browser-bridge.js`
- Test: `tests/atom-interaction-runtime.test.mjs`
- Test: `tests/atom-language-graph-server.test.mjs`
- Create: `tests/spatial-browser-bridge-contract.test.js`

**Interfaces:**
- Consumes: Task 1 `atom-program-click` event；Task 2 `programTriggerEvent`。
- Produces: `POST /__atom/api/click` body `{eventId,targetPath,button,count}`；`interactionRuntime.triggerProgramClick(payload)`。

- [ ] **Step 1: Write failing interaction and HTTP tests**

```js
test('Program click endpoint rejects client-selected Program names and malformed counts', async () => {
  const selected = await postClick({ eventId: 'e-1', targetPath: 'Root/Target', button: 0, count: 3, program: 'Root/Unsafe' });
  assert.equal(selected.error.code, 'INVALID_PROGRAM_CLICK_EVENT');
  const malformed = await postClick({ eventId: 'e-2', targetPath: 'Root/Target', button: 0, count: 0 });
  assert.equal(malformed.error.code, 'INVALID_PROGRAM_CLICK_EVENT');
});

test('duplicate eventId returns one receipt and executes one world interaction', async () => {
  const event = { eventId: 'e-3', targetPath: 'Root/Target', button: 0, count: 3 };
  const [first, second] = await Promise.all([postClick(event), postClick(event)]);
  assert.deepEqual(second, first);
  assert.equal(worldCalls.length, 1);
});

test('browser bridge serializes atomic click posts in count order', async () => {
  dispatchClick(1); dispatchClick(2); dispatchClick(3); dispatchClick(4);
  await deliveryTail;
  assert.deepEqual(receivedCounts, [1, 2, 3, 4]);
});
```

- [ ] **Step 2: Run tests to verify RED**

Run: `node --test tests/atom-interaction-runtime.test.mjs tests/atom-language-graph-server.test.mjs tests/spatial-browser-bridge-contract.test.js`

Expected: FAIL because the runtime method, endpoint and bridge listener do not exist.

- [ ] **Step 3: Implement interaction runtime and handler**

`triggerProgramClick()` validates the four public fields, then executes source `atom` with `programMode:'reconcile'` and the normalized server trigger event. No `agentPath` or Program selector is accepted from the browser.

- [ ] **Step 4: Implement HTTP idempotency**

`cli/lib/server.mjs` keeps a bounded 1,000-entry `eventId → {fingerprint,promise}` map. Same id and same payload share the receipt; same id with different payload returns `CLICK_EVENT_ID_CONFLICT`.

- [ ] **Step 5: Implement serialized browser delivery**

`spatial-browser-bridge.js` listens for `atom-program-click` and appends each request to one promise tail. Failures set the bridge degraded/offline state but do not cancel the already-dispatched visual intent.

- [ ] **Step 6: Run tests to verify GREEN**

Run: `node --test tests/atom-interaction-runtime.test.mjs tests/atom-language-graph-server.test.mjs tests/spatial-browser-bridge-contract.test.js`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/atom-system/public/interaction-runtime.mjs work-engine/atom-language/graph-server.mjs cli/lib/server.mjs spatial-browser-bridge.js tests/atom-interaction-runtime.test.mjs tests/atom-language-graph-server.test.mjs tests/spatial-browser-bridge-contract.test.js
git commit -m "feat(web): dispatch click events to Programs"
```

### Task 4: Help、端到端验收和恢复账本

**Files:**
- Modify: `work-engine/atom-language/cli.mjs`
- Modify: `tests/atom-agent-cli-contract.test.mjs`
- Modify: `tests/browser/atom-web-critical-journeys.spec.mjs`
- Modify: `docs/superpowers/plans/2026-09-02-atom-cli-feedback-triage.md`
- Modify: `docs/superpowers/README.md`

**Interfaces:**
- Consumes: Tasks 1—3 的完整点击链。
- Produces: Help 中公开 click trigger 合同、真实浏览器第三击运行测试 Program 的证据和最终恢复点。

- [ ] **Step 1: Add failing Help and browser journey assertions**

验证 Help 包含 `trigger("click", {"nodes":[...],"count":N}, main)`，并在隔离世界创建一个 count-3 Program：前两击结果节点不变，第三击只写一次，第四击不重复第三击 Program。

- [ ] **Step 2: Run tests to verify RED**

Run: `node --test tests/atom-agent-cli-contract.test.mjs`

Run: `npx playwright test tests/browser/atom-web-critical-journeys.spec.mjs --config=playwright.config.mjs`

- [ ] **Step 3: Update Help and minimal browser-facing diagnostics**

Help 明确无上限累计、重置条件、exact count、单参数事件、客户端不可指定 Program，以及无匹配时保留现有 UI 行为。

- [ ] **Step 4: Run focused and full verification**

Run: `node --test tests/spatial-gesture-arbiter.test.js tests/gesture-contract.test.js tests/atom-program-click-trigger.test.mjs tests/atom-interaction-runtime.test.mjs tests/atom-language-graph-server.test.mjs tests/spatial-browser-bridge-contract.test.js tests/atom-agent-cli-contract.test.mjs`

Run: `npm test`

Run: `npx playwright test tests/browser/atom-web-critical-journeys.spec.mjs --config=playwright.config.mjs`

Expected: all PASS with no warnings attributable to this change.

- [ ] **Step 5: Update recovery ledger and commit**

```bash
git add work-engine/atom-language/cli.mjs tests/atom-agent-cli-contract.test.mjs tests/browser/atom-web-critical-journeys.spec.mjs docs/superpowers/plans/2026-09-02-atom-cli-feedback-triage.md docs/superpowers/README.md
git commit -m "docs: close programmable click trigger"
```

- [ ] **Step 6: Merge and push**

Fast-forward the reviewed implementation branch into `main`, verify `HEAD == origin/main`, and keep the isolated worktree until final verification evidence is recorded.
