# A Mode Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Atom Web 的结构游走收束为唯一 A 模式，以右键单击普通向内剖开、右键双击沉浸向内剖开，并以空白右键单击返回一层。

**Architecture:** 保留现有 A 的 nested Slot 投影为唯一结构投影，把旧 F 的真实 owner 路线进入能力改为 A 内部的沉浸动作，不再作为可选模式。已有 secondary click arbiter 负责右键单／双击仲裁，本地展示设置提供`240–800ms`可配间隔；Graph事实、Transform、左键`$click`和权限链不变。

**Tech Stack:** Browser JavaScript (IIFE modules), Canvas spatial engine, Node.js 24 test runner, Playwright, localStorage presentation settings.

**Spec:** `docs/superpowers/specs/2026-08-31-atom-web-spatial-design.md` §4.1, §5.2, §6.2.

## Global Constraints

- 术语只使用“向内剖开”，不得写成“向外展开”。
- 右键沉浸连击间隔默认`420ms`，可调范围`240–800ms`，只影响无修饰键的右键导航。
- `Ctrl+右键`关系编辑、`Shift+右键`魔杖与左键可编程点击计数不进入右键导航仲裁。
- 团上右键单击保留团外上下文；同一团右键双击隐藏团外节点、边和上级背景。
- 当前团空白处右键单击返回一个直接父层并转为非沉浸；空白双击不得连退两层。
- S、D 与独立 F 不保留活跃键位、设置、帮助或双轨兼容路径；回退依据 Git 标签`pre-a-mode-consolidation-20260904`与退役清单。
- 默认只运行最小受影响链；候选实现稳定后才运行一次完整`npm test`。
- 不修改 Atom backing JSON，不改 Graph、Slot、Strut、Program、Transform 或权限合同。

## Minimality Checkpoint A

- **复用既有**：复用`createSecondaryClickArbiter`、`enterNode(node, true)`、owner route、nested child-domain投影和`spatial-demo-model` localStorage，不新建手势引擎、路由器或设置仓。
- **最短链路**：只新增一个沉浸向内动作意图和一个已有设置对象字段；右键空白双击复用同一`applyParentView`作为双击结果。
- **单轨收束**：删除 S／D／独立 F 可达路径与死配置，不加 feature flag、双读双写或兼容适配器。
- **无新依赖**：标准 DOM、定时器、Node test 和已安装 Playwright 已覆盖全部需求，不增加 npm 包。

---

### Task 1: 将输入合同收束为 A 单轨

**Files:**
- Modify: `input-config.js`
- Modify: `spatial-view-mode-model.js`
- Test: `tests/input-config.test.js`
- Test: `tests/spatial-view-mode-model.test.js`

**Interfaces:**
- Consumes: 现有`resolvePointer(event, context)`、`resolveKeyboard(event, context)`和稳定 Thing 命中身份。
- Produces: `VISUAL_INTENTS.applyInwardView`、`VISUAL_INTENTS.applyImmersiveInwardView`；节点右键 single/double 分别解析到两个意图，空白 single/double 均解析到`applyParentView`。

- [x] **Step 1: Write failing A-only input tests**

```js
assert.equal(input.resolvePointer({ button: 2 }, { onNode: true, gesture: 'tap' }), 'applyInwardView');
assert.equal(input.resolvePointer({ button: 2 }, { onNode: true, gesture: 'double' }), 'applyImmersiveInwardView');
assert.equal(input.resolvePointer({ button: 2 }, { onNode: false, gesture: 'double' }), 'applyParentView');
assert.equal(input.resolveKeyboard({ code: 'KeyA', type: 'keydown', repeat: false }, { editing: false }), 'setNestedView');
for (const code of ['KeyS', 'KeyD', 'KeyF']) {
  assert.equal(input.resolveKeyboard({ code, type: 'keydown', repeat: false }, { editing: false }), null);
}
assert.deepEqual(model.modes, ['nested']);
assert.equal(model.modeForKey('KeyA'), 'nested');
assert.equal(model.modeForKey('KeyF'), null);
```

- [x] **Step 2: Run the focused tests and verify RED**

Run: `node --test tests/input-config.test.js tests/spatial-view-mode-model.test.js`

Expected: FAIL because the old contract still exposes peripheral/hierarchy/immersive modes and right double-click has no intent.

- [x] **Step 3: Implement the minimal A-only contract**

```js
const MODES = Object.freeze(['nested']);
const MODE_LABELS = Object.freeze({ nested: 'A · 向内剖开' });
const KEY_MODES = Object.freeze({ KeyA: 'nested' });

const VISUAL_INTENTS = Object.freeze({
  applyInwardView: 'applyInwardView',
  applyImmersiveInwardView: 'applyImmersiveInwardView',
  applyParentView: 'applyParentView',
  setNestedView: 'setNestedView'
});
```

Update both input presets so `nodeSecondary`, `nodeDoubleSecondary`, `fieldSecondary`, and `fieldDoubleSecondary` use the produced intents. Remove S/D/F keyboard bindings, mode-cycle descriptions, and the corresponding setting/help items; preserve Ctrl/Shift secondary bindings unchanged.

- [x] **Step 4: Run the focused tests and verify GREEN**

Run: `node --test tests/input-config.test.js tests/spatial-view-mode-model.test.js`

Expected: PASS.

- [x] **Step 5: Commit the A-only input contract**

```bash
git add input-config.js spatial-view-mode-model.js tests/input-config.test.js tests/spatial-view-mode-model.test.js
git commit -m "refactor(web): make A the only structural view"
```

### Task 2: 增加可持久化的右键连击间隔

**Files:**
- Modify: `spatial-demo-model.js`
- Modify: `index.html`
- Modify: `spatial-engine.js`
- Test: `tests/spatial-demo-model.test.js`
- Test: `tests/mobile-interaction-contract.test.js`

**Interfaces:**
- Consumes: `normalizeSettings(input)`、`updateDemoSettings(nextSettings)`与现有`graph-4d.presentation-settings.v2` localStorage 链。
- Produces: `settings.secondaryNavigationDelayMs: number`；`withSecondaryNavigationDelayInput(settings, value)`；DOM `#secondaryNavigationDelay`与`#secondaryNavigationDelayValue`。

- [x] **Step 1: Write failing settings normalization tests**

```js
assert.equal(model.normalizeSettings({}).secondaryNavigationDelayMs, 420);
assert.equal(model.normalizeSettings({ secondaryNavigationDelayMs: 120 }).secondaryNavigationDelayMs, 240);
assert.equal(model.normalizeSettings({ secondaryNavigationDelayMs: 1200 }).secondaryNavigationDelayMs, 800);
assert.equal(model.withSecondaryNavigationDelayInput({}, '515').secondaryNavigationDelayMs, 515);
```

Also assert that `index.html` contains an accessible range input with `min="240"`, `max="800"`, `value="420"` in the mapping section.

- [x] **Step 2: Run the focused tests and verify RED**

Run: `node --test tests/spatial-demo-model.test.js tests/mobile-interaction-contract.test.js`

Expected: FAIL because the setting and controls do not exist.

- [x] **Step 3: Implement settings normalization and UI wiring**

```js
const DEFAULT_SECONDARY_NAVIGATION_DELAY_MS = 420;
function validSecondaryNavigationDelay(value) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.min(800, Math.max(240, Math.round(number)))
    : DEFAULT_SECONDARY_NAVIGATION_DELAY_MS;
}
function withSecondaryNavigationDelayInput(settingsInput, value) {
  const settings = normalizeSettings(settingsInput);
  return normalizeSettings({
    ...settings,
    secondaryNavigationDelayMs: validSecondaryNavigationDelay(value)
  });
}
```

Add the value to `normalizeSettings`, export the updater, bind the range input through `updateDemoSettings`, and display `${value}ms`. Do not create a second localStorage key.

- [x] **Step 4: Run the focused tests and verify GREEN**

Run: `node --test tests/spatial-demo-model.test.js tests/mobile-interaction-contract.test.js`

Expected: PASS.

- [x] **Step 5: Commit the persisted interval setting**

```bash
git add spatial-demo-model.js spatial-engine.js index.html tests/spatial-demo-model.test.js tests/mobile-interaction-contract.test.js
git commit -m "feat(web): configure immersive right-click interval"
```

### Task 3: 让右键单／双击仲裁使用当前设置

**Files:**
- Modify: `spatial-gesture-arbiter.js`
- Modify: `spatial-engine.js`
- Test: `tests/spatial-gesture-arbiter.test.js`
- Test: `tests/gesture-contract.test.js`

**Interfaces:**
- Consumes: `settings.secondaryNavigationDelayMs`与`candidateArbiterKey(candidate)`。
- Produces: `createSecondaryClickArbiter({ delayFor, setTimer, clearTimer, commitSingle, commitDouble })`；`submit(singleAction, doubleAction, signature)`在同一 signature 窗口内只提交 double，超时只提交 single。

- [x] **Step 1: Write failing dynamic-delay and exact-signature tests**

```js
let delayMs = 420;
const arbiter = createSecondaryClickArbiter({
  delayFor: () => delayMs,
  setTimer(fn, delay) { scheduled.push({ fn, delay }); return scheduled.length; },
  clearTimer() {},
  commitSingle(action) { commits.push(['single', action.intent]); },
  commitDouble(action) { commits.push(['double', action.intent]); }
});
assert.equal(arbiter.submit(single, double, 'node:root:a'), 'pending');
assert.equal(scheduled.at(-1).delay, 420);
assert.equal(arbiter.submit(single, double, 'node:root:a'), 'double');
assert.deepEqual(commits, [['double', 'applyImmersiveInwardView']]);
```

Add a field case proving two submissions of `field:root/a` commit exactly one `applyParentView`, plus a changed-signature case proving the first single settles before the second sequence begins.

- [x] **Step 2: Run the focused tests and verify RED**

Run: `node --test tests/spatial-gesture-arbiter.test.js tests/gesture-contract.test.js`

Expected: FAIL because the engine bypasses `secondaryClickArbiter.submit` and delay is fixed at construction.

- [x] **Step 3: Implement dynamic secondary arbitration**

```js
const delayFor = typeof options.delayFor === 'function'
  ? options.delayFor
  : () => (Number.isFinite(options.delay) ? options.delay : 420);

function schedule() {
  const delay = Math.min(800, Math.max(240, Number(delayFor()) || 420));
  pendingTimer = setTimer(settleSingle, delay);
}
```

In `commitPointerCandidate`, route only unmodified `button === 2` navigation candidates through `secondaryClickArbiter.submit(singleAction, doubleAction, candidateArbiterKey(candidate))`. Direct commands, Ctrl+right, Shift+right, edits, middle click, drag, and primary click keep cancelling/bypassing this arbiter exactly as before.

- [x] **Step 4: Run the focused tests and verify GREEN**

Run: `node --test tests/spatial-gesture-arbiter.test.js tests/gesture-contract.test.js`

Expected: PASS.

- [x] **Step 5: Commit right-click arbitration**

```bash
git add spatial-gesture-arbiter.js spatial-engine.js tests/spatial-gesture-arbiter.test.js tests/gesture-contract.test.js
git commit -m "feat(web): arbitrate A-mode right clicks"
```

### Task 4: 实现 A 普通剖开、沉浸剖开与单层返回

**Files:**
- Modify: `spatial-engine.js`
- Modify: `spatial-view-mode-model.js`
- Test: `tests/cluster-engine-contract.test.js`
- Test: `tests/gesture-contract.test.js`
- Test: `tests/spatial-view-mode-model.test.js`

**Interfaces:**
- Consumes: Task 1的`applyInwardView`/`applyImmersiveInwardView`意图与 Task 3的仲裁结果。
- Produces: `applyInwardView(node, options)`只打开 nested child domain；`applyImmersiveInwardView(node)`通过现有真实 owner route进入该团；`applyParentView(domainContext)`一次只退一层。

- [x] **Step 1: Write failing engine contract tests**

```js
assert.match(engineSource, /case "applyInwardView"/);
assert.match(engineSource, /case "applyImmersiveInwardView"/);
assert.match(engineSource, /applyImmersiveInwardView\(node\)[\s\S]*enterNode\(node, true\)/);
assert.doesNotMatch(engineSource, /case "setPeripheralView"|case "setHierarchyView"|case "setImmersiveView"/);
assert.doesNotMatch(engineSource, /mode === "peripheral"|state\.viewMode === "immersive"/);
```

Add model tests proving batch/recursive A actions always use nested projection and cannot select a second structural mode.

- [x] **Step 2: Run the focused tests and verify RED**

Run: `node --test tests/cluster-engine-contract.test.js tests/gesture-contract.test.js tests/spatial-view-mode-model.test.js`

Expected: FAIL on old mode branches and missing A action functions.

- [x] **Step 3: Implement the single A runtime path**

```js
function applyInwardView(node, optionsInput = {}) {
  if (!node?.capabilities?.portal) return false;
  const ownerPath = nodeOwnerPath(node);
  const childPath = childPathFor(node, ownerPath);
  if (state.expandedClusterDomains.has(childPath)) return collapseClusterDomain(childPath);
  state.clusterFieldOpen = true;
  return toggleClusterChildDomain(node, ownerPath, 'nested');
}

function applyImmersiveInwardView(node) {
  if (!node?.capabilities?.portal) return false;
  enterNode(node, true);
  return true;
}
```

Remove S/D/F mode dispatch, peripheral reveal branches, hierarchy projection choices, immersive-as-mode guards, and mode cycling. Normalize restored legacy snapshots to `viewMode: 'nested'` without preserving a selectable legacy mode. Keep owner-route and domain-frame helpers needed by immersive entry, because they implement the retained A action rather than compatibility.

- [x] **Step 4: Run the focused tests and verify GREEN**

Run: `node --test tests/cluster-engine-contract.test.js tests/gesture-contract.test.js tests/spatial-view-mode-model.test.js`

Expected: PASS.

- [x] **Step 5: Commit the A navigation runtime**

```bash
git add spatial-engine.js spatial-view-mode-model.js tests/cluster-engine-contract.test.js tests/gesture-contract.test.js tests/spatial-view-mode-model.test.js
git commit -m "refactor(web): merge immersion into A navigation"
```

### Task 5: 收束帮助、设置与移动端表达

**Files:**
- Modify: `index.html`
- Modify: `input-config.js`
- Modify: `spatial-engine.js`
- Test: `tests/input-config.test.js`
- Test: `tests/mobile-interaction-contract.test.js`
- Test: `tests/browser/mobile-control-panel.spec.mjs`

**Interfaces:**
- Consumes: A-only intents and `secondaryNavigationDelayMs` control.
- Produces: 只展示 A 普通／沉浸向内剖开的桌面与移动端说明；不再展示 S、D、F 模式按钮或键位。

- [ ] **Step 1: Write failing copy and control-surface tests**

```js
assert.match(html, /右键单击向内剖开/);
assert.match(html, /右键双击沉浸/);
assert.doesNotMatch(html, /S外围|D层级|F沉浸|data-mobile-key="KeyS"|data-mobile-key="KeyD"|data-mobile-key="KeyF"/);
assert.doesNotMatch(input.describeGroups().flatMap((group) => group.items).map((item) => item.label).join('\n'), /外围|层级/);
```

- [ ] **Step 2: Run focused UI tests and verify RED**

Run: `node --test tests/input-config.test.js tests/mobile-interaction-contract.test.js`

Expected: FAIL because old ASDF copy and controls remain.

- [ ] **Step 3: Remove old mode surfaces and publish exact A wording**

Replace the canvas aria-label, footer hint, Help mapping rows, mobile buttons and settings mapping entries with:

```text
右键单击节点团：普通向内剖开
右键双击同一节点团：沉浸向内剖开
右键单击当前团空白：返回一层并恢复非沉浸
```

Do not label A as a separate exit action. Preserve Z/X history, PageUp/PageDown A-level operations, CapsLock details, Ctrl edit and Shift wand.

- [ ] **Step 4: Run focused Node and mobile Playwright tests**

Run: `node --test tests/input-config.test.js tests/mobile-interaction-contract.test.js`

Run: `npx playwright test tests/browser/mobile-control-panel.spec.mjs --config=playwright.config.mjs`

Expected: both commands PASS.

- [ ] **Step 5: Commit the A-only interface**

```bash
git add index.html input-config.js spatial-engine.js tests/input-config.test.js tests/mobile-interaction-contract.test.js tests/browser/mobile-control-panel.spec.mjs
git commit -m "refactor(web): retire ASDF mode surfaces"
```

### Task 6: 真实浏览器关键旅程与封存清单

**Files:**
- Modify: `tests/browser/atom-web-critical-journeys.spec.mjs`
- Create: `docs/superpowers/archive/2026-09-04-asdf-mode-retirement.md`
- Modify: `docs/superpowers/plans/2026-09-03-atom-current-requirement-ledger.md`
- Modify: `docs/superpowers/plans/2026-09-03-session-recovery-checkpoint.md`

**Interfaces:**
- Consumes: Tasks 1–5的完整 A 输入、导航、设置与UI。
- Produces: 可重放的 Chromium 验收证据；退役功能→最后旧提交→新替代路径的封存清单。

- [ ] **Step 1: Write the failing browser journeys**

```js
async function openAModeFixture(page) {
  const parentPath = `root/${hashText('a-parent-id').toString(36)}`;
  const innerPath = `${parentPath}/${hashText('a-inner-id').toString(36)}`;
  const knowledge = {
    revision: 1,
    nodes: [
      { id: 'a-parent-id', key: 'root::a-parent-id', path: 'root', atomPath: '父团', label: '父团', detail: '', hasChildren: true },
      { id: 'a-outside-id', key: 'root::a-outside-id', path: 'root', atomPath: '团外旁侧', label: '团外旁侧', detail: '', hasChildren: false },
      { id: 'a-inner-id', key: `${parentPath}::a-inner-id`, path: parentPath, atomPath: '父团/内层团', label: '内层团', detail: '', hasChildren: true },
      { id: 'a-inner-peer-id', key: `${parentPath}::a-inner-peer-id`, path: parentPath, atomPath: '父团/内层旁侧', label: '内层旁侧', detail: '', hasChildren: false },
      { id: 'a-leaf-id', key: `${innerPath}::a-leaf-id`, path: innerPath, atomPath: '父团/内层团/叶子', label: '叶子', detail: '', hasChildren: false }
    ],
    edges: []
  };
  await page.route('**/__spatial/api/state?*', (route) => {
    const path = new URL(route.request().url()).searchParams.get('path') || 'root';
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, scope: { path }, knowledge }) });
  });
  await page.goto('/');
  await page.waitForFunction(() => window.spatialLab?.state().interactionTargets.some(({ label }) => label === '父团'));
  return { parentPath, innerPath };
}

async function rightClickTarget(page, label, count) {
  const target = (await page.evaluate(() => window.spatialLab.state().interactionTargets))
    .find((candidate) => candidate.label === label);
  expect(target).toBeTruthy();
  for (let index = 0; index < count; index += 1) {
    await page.mouse.click(target.clientX, target.clientY, { button: 'right' });
    if (index + 1 < count) await page.waitForTimeout(80);
  }
}

test('A single right-click cuts inward without hiding outside context', async ({ page }) => {
  await openAModeFixture(page);
  await rightClickTarget(page, '父团', 1);
  await page.waitForTimeout(430);
  const labels = await page.evaluate(() => window.spatialLab.state().visibleNodeDescriptors.map(({ label }) => label));
  expect(labels).toEqual(expect.arrayContaining(['内层团', '团外旁侧']));
  expect(await page.evaluate(() => window.spatialLab.state().path)).toBe('root');
});

test('A double right-click immerses the exact group', async ({ page }) => {
  const { parentPath } = await openAModeFixture(page);
  await rightClickTarget(page, '父团', 2);
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().path)).toBe(parentPath);
  const labels = await page.evaluate(() => window.spatialLab.state().visibleNodeDescriptors.map(({ label }) => label));
  expect(labels).toContain('内层团');
  expect(labels).not.toContain('团外旁侧');
});

test('blank right double-click returns only one level non-immersively', async ({ page }) => {
  const { parentPath, innerPath } = await openAModeFixture(page);
  await rightClickTarget(page, '父团', 2);
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().path)).toBe(parentPath);
  await rightClickTarget(page, '内层团', 2);
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().path)).toBe(innerPath);
  await page.mouse.click(48, 360, { button: 'right' });
  await page.waitForTimeout(80);
  await page.mouse.click(48, 360, { button: 'right' });
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().path)).toBe(parentPath);
  const labels = await page.evaluate(() => window.spatialLab.state().visibleNodeDescriptors.map(({ label }) => label));
  expect(labels).toContain('内层旁侧');
});
```

- [ ] **Step 2: Run the three named journeys and verify RED**

Run: `npx playwright test tests/browser/atom-web-critical-journeys.spec.mjs --config=playwright.config.mjs --grep "A single right-click|A double right-click|blank right double-click"`

Expected: at least one FAIL against the pre-change navigation behavior.

- [ ] **Step 3: Complete only browser-evidence corrections**

If the journeys expose timing or final-screen defects, correct the owning function from Tasks 2–5; do not add test-only modes, sleeps longer than the configured interval plus Playwright auto-wait, or Graph writes.

- [ ] **Step 4: Run the A-mode affected chain**

Run: `node --test tests/input-config.test.js tests/spatial-view-mode-model.test.js tests/spatial-demo-model.test.js tests/spatial-gesture-arbiter.test.js tests/gesture-contract.test.js tests/cluster-engine-contract.test.js tests/mobile-interaction-contract.test.js`

Run: `npx playwright test tests/browser/atom-web-critical-journeys.spec.mjs tests/browser/mobile-control-panel.spec.mjs --config=playwright.config.mjs`

Expected: all PASS.

- [ ] **Step 5: Write the retirement manifest and checkpoint evidence**

Record these exact categories in `docs/superpowers/archive/2026-09-04-asdf-mode-retirement.md`:

```markdown
- **Peripheral / S**: last recoverable baseline `pre-a-mode-consolidation-20260904`; replaced by A ordinary inward cut.
- **Hierarchy / D**: last recoverable baseline `pre-a-mode-consolidation-20260904`; no active replacement because external hierarchy layout is outside the Slot ontology.
- **Immersive / F**: last recoverable baseline `pre-a-mode-consolidation-20260904`; retained capability is A double-right inward immersion.
- **Safe inspection**: `git show pre-a-mode-consolidation-20260904:<path>`.
- **Safe recovery**: create a new branch from the tag; never overwrite a dirty working tree with `reset --hard`.
```

Update the ledger/checkpoint with actual commit ids and test counts only after commands finish.

- [ ] **Step 6: Commit browser proof and archive manifest**

```bash
git add tests/browser/atom-web-critical-journeys.spec.mjs docs/superpowers/archive/2026-09-04-asdf-mode-retirement.md docs/superpowers/plans/2026-09-03-atom-current-requirement-ledger.md docs/superpowers/plans/2026-09-03-session-recovery-checkpoint.md
git commit -m "test(web): prove A-mode navigation journeys"
```

### Task 7: 候选版本验证、部署与回读

**Files:**
- Modify if mechanically required: `index.html` build id only through `npm run build:browser`
- Modify: `docs/superpowers/plans/2026-09-03-atom-current-requirement-ledger.md`
- Modify: `docs/superpowers/plans/2026-09-03-session-recovery-checkpoint.md`

**Interfaces:**
- Consumes: Task 6已稳定候选 revision。
- Produces: 唯一一次全量 Node 门禁、开发控制门禁、4784部署与公开入口回读证据。

- [ ] **Step 1: Run pre-commit complexity and source checks**

Run: `git diff --check`

Run: `npm run check:development-control`

Expected: both exit 0; no duplicate mode abstraction, dead configuration, second settings store or compatibility branch remains.

- [ ] **Step 2: Run the final full Node suite exactly once for this candidate**

Run: `npm test`

Expected: build succeeds and all Node tests PASS. A real failure returns to focused debugging; infrastructure-only failure is recorded and retried without calling the candidate green.

- [ ] **Step 3: Deploy through the existing Atom Graph Runtime entry**

Run: `schtasks /Run /TN "Atom Graph Runtime"`

Then poll `http://127.0.0.1:4784/__spatial/api/health` until it returns the new browser build and `projectionStatus: "published"`; do not start a duplicate ad-hoc 4784 process.

- [ ] **Step 4: Re-read the deployed public entry**

Verify through real Chromium that the three Task 6 journeys pass against 4784 and that Help/settings expose only A ordinary/immersive inward navigation plus the persisted interval. Confirm Ctrl+right, Shift+right and left programmable click remain operational with their focused journeys.

- [ ] **Step 5: Update evidence and commit the deployed candidate**

```bash
git add index.html docs/superpowers/plans/2026-09-03-atom-current-requirement-ledger.md docs/superpowers/plans/2026-09-03-session-recovery-checkpoint.md
git commit -m "chore(web): record A-mode deployment evidence"
```

Do not push this post-baseline work without a new user authorization. Keep `pre-a-mode-consolidation-20260904` unchanged as the remote rollback point.

## 2026-09-05 接手与当前执行证据

- **当前目标**：A模式收束，I3/U2/D2/E3；Task 1已完成，Task 2进行中，Task 3—7待执行。唯一状态仍由本计划、需求总账与恢复断点共同承担，不另建SDD状态账本；官方脚本工作区只放派发摘录、报告及差异包。
- **安全吸收**：接手前main与origin/main精确为2ae8735691aa00cdae8ad3c90d29763b1964a1af，A工作树干净且HEAD为b1bff98。非破坏merge main成功，当前合并提交4c9cf2f；未reset、未覆盖用户改动。
- **最小基线**：node --test --test-isolation=none tests/input-config.test.js tests/spatial-view-mode-model.test.js，31/31 PASS，0失败；槽体已交付链不重测。
- **恢复指针**：总账与断点中的eaa48bc为之前槽体交付点，当前main安全点由上项取代；不覆盖历史验收证据。
- **Ruling: 验收时序**：Task 6要求在Task 2—5已实现后取得旧行为RED，时间顺序矛盾；将三条A浏览器验收先在Task 4实现前取得RED，再复用于Task 6候选GREEN。依据TDD及Web规格，错误代价是需重新调整测试安排，不改变产品行为。
- **Ruling: 沉浸解除**：Task 4示例只toggle子域不足以证明普通剖开解除沉浸；按Web规格§4.1处理实际可见范围并用浏览器最终画面验收。若判断有误，代价为局部导航实现返工。
- **Ruling: 状态来源**：用户明确禁止第二账本，因此SDD进展和裁定写入本既有计划；不创建progress.md。报告为证据附件，任务状态以本页为准。若解释有误，代价是记录位置调整，不影响产品事实。

### 计划预检

| 任务或共享项 | 生产／消费关系 | 裁定 |
|---|---|---|
| Task 1自身 | 输入意图和单一nested模式 | 已交付31/31；其余运行时清退归Task 4 |
| Task 2自身 | 归一化→同一localStorage→设置控件 | 数值缺省、范围、重载与默认恢复需同源 |
| Task 3自身 | 动态间隔→同目标仲裁→单／双意图 | 修饰键绕过；空白双击只退一次 |
| Task 4自身 | A意图→普通／沉浸→父层 | 示例不替代沉浸解除合同，见裁定 |
| Task 5自身 | 帮助／桌面／手机共同表达 | 保留编辑、魔杖、历史与详情 |
| Task 6自身 | 真实浏览器RED→最终GREEN | RED前移至Task 4前，见裁定 |
| Task 7自身 | 稳定候选→最终全量一次→部署回读 | 必须先集成本地main才能由既有服务部署；不自动push |
| Task 1/4 | mode model与输入意图 | Task 4消费新意图并清除旧mode分支 |
| Task 1/5 | input-config与描述 | Task 5清退可见旧键位，避免重新引入 |
| Task 2/3 | engine读取secondaryNavigationDelayMs | 同一归一化字段供delayFor读取 |
| Task 2/4 | engine设置与导航 | 设置代码只控制仲裁，不改结构事实 |
| Task 2/5 | index、engine、mobile合同 | Task 5保留新增间隔设置及可访问控件 |
| Task 2/7 | index构建标识 | 由build:browser机械生成 |
| Task 3/4 | gesture、engine与意图 | 仲裁结果进入唯一A导航 |
| Task 3/5 | engine输入与帮助 | 描述必须与真实仲裁一致 |
| Task 4/5 | engine运行路径与移动端 | 移动端复用相同A动作 |
| Task 4/6 | 导航实现与浏览器验收 | 预先RED，实际画面覆盖三旅程及沉浸解除 |
| Task 5/6 | mobile测试与完整关键旅程 | 已通过证据同revision复用 |
| Task 5/7 | index与公开入口 | 部署回读控件和真实浏览器行为 |
| Task 6/7 | 总账、断点、稳定候选 | 阶段成果不冒充部署，最终才全量 |
- **官方版本核对**：已读取官方 obra/superpowers main 的 .claude-plugin/plugin.json，version为6.3.0，与本机安装一致；未修改官方技能。
- **现场收件**：只读核对“🔥🔥🔥ESG计划_按逻辑_atom”最近两轮；最新内容是用户定论整理，未发现槽体交付后新的正确合同复现。原封装body参数和旧延迟报告已有总账记录，不据旧现场消息重开P0。
- **辅助工具**：Git Bash默认沙箱signal pipe拒绝，批准后官方sdd-workspace/task-brief已运行；GitNexus刷新使用--index-only，首次默认沙箱spawn EPERM，已切换获准运行。此为基础设施问题，不是产品RED。
- **Ruling: 测试合同**：Task 3—5示例中的源码正则不能独自作为新功能RED/GREEN；依官方6.3.0 writing-good-tests，优先执行真实仲裁、模型及浏览器行为，既存结构合同只补充清退检查。若判断有误，代价为测试组织调整，不减验收范围。
- **Task 4回读线索**：当前returnClusterToDepth访问未声明options；普通A展开后返回可能触达此分支。尚未复现，不写为已证实根因；Task 4按真实返回旅程取证，若触发则纳入同一导航最小修复。
- **Task 2 RED**：node --test tests/spatial-demo-model.test.js tests/mobile-interaction-contract.test.js；首次沙箱worker spawn EPERM无有效结果，获准同命令重跑34项／29通过／5失败。失败对应secondaryNavigationDelayMs与updater缺失、accessible range缺失及完整设置快照缺新字段；尚未实现GREEN。现有engine secondary delay为620，动态消费归Task 3。
- **索引故障**：GitNexus增量刷新失败于file_fts节点offset 842 missing，当前以官方--repair-fts修复派生索引；辅助索引缺口不代替产品RED，也不阻塞源码可确认的最小开发链。
- **Task 2初次GREEN**：实现方回报同一focused链34/34、0失败。自审发现额外加入计时包装器，提前承担Task 3的动态仲裁职责；控制方要求按Task 2范围移回既有计时行为，再定向验证后提交。此34/34仅属于该中间状态，尚不裁定Task 2完成。
- **Task 2提交／复核**：2faf49b，34/34 PASS、两项node --check通过；5文件6符号LOW，提交包含范围归位后的设置链。实现方a_task2，独立评审a_task2_review进行中。
- **索引恢复**：官方FTS repair成功后，因前次未完成标记自动完整重建；43.5秒成功，6916节点、19072边、300flows，--index-only未改任何跟踪文件。Task 3影响：createSecondaryClickArbiter无索引调用者（源码有engine调用，需人工核对）；commitPointerCandidate上游4项、直接releasePointer，风险LOW，包含手机release入口。
- **Task 2评审**：a_task2_review给出Spec可见范围合规、quality Approved；三项跨差异待核对为恢复默认、持久化重载、Task 3动态消费。控制方回读确认updateDemoSettings归一化→saveDemoSettings→syncPresentationControls且单一key；动态消费明确属于Task 3。
- **Task 2 fix round 1/5**：控制方核实index/engine不存在通用设置恢复入口，故“恢复默认”是Web规格§5.2真实缺口，不接受Task 2完成。Ruling: 依规格补单字段恢复默认按钮及真实浏览器设置→重载→恢复→再次重载旅程；扩展tests/browser/mobile-control-panel.spec.mjs是最小验收链，错误代价为撤回局部UI和测试，不影响Graph。实现方沿用a_task2，FIX_BASE=2faf49b。
- **A缩小字段回读**：index.html的peripheralDepthShrink实际已标为“A 子层节点缩小”，spatial-cluster-field.js:748在nested路径消费其缩放；它属于Web规格§5.1保留能力，不是仅凭旧变量名即可删的S死配置。Task 4/5清退按可达行为判定，保留该有效A控件。
- **Task 2修复RED**：真实Chromium唯一具名设置旅程在调值515→output同步→reload仍515之后，点击“恢复右键沉浸连击间隔默认值”超时，1 failed；缺按钮得到直接行为证据。产物task-2-reset-red保留在本计划工作区；此前序同时补齐重载持久化证据。
- **部署前只读边界**：4784 health当前ok:true、revision7361、atomProjection.status=published；它是现行主干状态，不冒充A候选部署。Get-ScheduledTask默认沙箱拒绝访问，仅限制任务管理读取，实际部署阶段按已有受控入口请求必要系统执行权限。
- **Task 7接口校准**：当前公开health投影字段为atomProjection.status，浏览器build需从公开HTML资源标识回读；按实际字段核对，不以计划示意的projectionStatus顶层键构造假失败。
- **Task 2修复GREEN**：Chromium唯一旅程1 passed（11.3s），初始420、调515同步、reload保留、按钮恢复420、defaultDetailMode=surface不变、再次reload持久且其他设置守恒。两次中间运行暴露测试getByLabel歧义与重载面板关闭，定向修正角色定位／重开面板后通过，不作为产品失败或静默忽略。下一步原34项及提交后范围复审。
- **Task 2: complete**：4c9cf2f..4c27d4b；原设置链34/34，重载／单字段恢复Chromium1/1。a_task2_rereview已按精确差异包完成范围复审，全部问题解决且无新增破坏。首次相对路径漏读差异包已纠正，未重复测试。
- **生产急件切换**：收到改名判重→瞻重回执同时出现PROJECTION_RECOVERY_PENDING与WINDOW_ACCESS_DENIED的新现场证据；按总账优先规则核查权威提交与权限目标。A模式Task3尚未开始，现有代码保存于4c27d4b，未部署；急件处理后从Task3继续，不重新执行Task2。

- **2026-09-05续接**：改名修复1727/1727、复核和4784部署回告完成，main@abbc5ed。手机当前无握手且离线、无线ADB不可达，保持未解决；按用户局部阻塞不全局停工授权，安全吸收main并从Task 3继续。总账合并冲突只涉及旧优先级和A阶段描述，保留最新手机优先级及Task 2完整证据；不改产品定论。

- **Task 3进行中**：a_task3实现方，BASE=3231d71；impact为LOW，createSecondaryClickArbiter直接测试调用1、commitPointerCandidate直接releasePointer，源码核对索引缺口，不把辅助图当最终结论。
- **Task 6前置RED**：在Task 4实现前，真实Chromium三条命名旅程3/3 FAIL：普通单击仍只见父团/团外旁侧；双击path仍root；空白返回旅程在进入前提失败。后者尚未证明返回自身缺陷。产物保留在本计划工作区task-6-before-task4-red，后续复用测试验证导航实现，不重做旧行为RED。

- **Task 3 RED/GREEN**：默认沙箱spawn EPERM不计结果；获准执行仲裁/gesture链37项，RED为34通过/3失败（delayFor未用、engine固定620、尚未submit），实现后37/37 PASS。实现方自审及提交进行中，未替代独立任务复核。

- **Task 3: complete**：3231d71..07b55b5，37/37 PASS，a_task3_review规格合规且quality Approved，无分级问题。跨任务最终画面项归Task 4，由已建立的三条浏览器旅程及沉浸解除验收，不据仲裁单测冒称导航完成。

- **Task 4 RED与影响**：a_task4新增三项定向RED：旧immersive参数使batch仅clicked、recursive为空，dispatch缺A意图。returnClusterToDepth HIGH（1直接/15总）、returnToDepth HIGH（3/16）、dispatchIntent HIGH（9/11）、openClusterChildDomain HIGH（4/20），已向用户告知；风险覆盖共享Web导航，后续用真实进入/返回/普通解除沉浸旅程裁定。此前三条浏览器RED被重复一次，控制方已纠正为复用同revision证据，不再重跑旧失败。

- **Task 4定向结果**：单元77/77通过；首轮五条浏览器旅程3/5，双击沉浸、空白单层返回、A键不退出通过。普通剖开自动frameClusterDomain把团外旁侧移出画面，须先定向修复；沉浸后普通剖开旅程首次进入不稳定仍在查，不冒称完成。toggleClusterChildDomain上游CRITICAL（2直接/18总）已告知用户，修复只作用于当前导航链。

- **Task 4浏览器证据校准**：普通剖开保留团外已通过；两次独立CDP click在负载下跨过420ms导致单击提交，改原生mouse.dblclick保持产品间隔不变。后续page.goto／test 30s超时是未形成有效结果，须核查测试服务与加载等待；同一产品revision每条已有有效行为证据复用，不为整组全绿外观反复重跑。

- **Task 4: complete**：d9df3bb..b132962，最终单元77/77、真实Chromium五条导航旅程5/5（34.2s）；a_task4_review规格符合且quality Approved，零分级问题。Task 5帮助／控件、Task 6退役清单、Task 7最终候选与部署仍开放。按用户来源提交要求，A先保存安全续点，接续提交分离及旧print迁移，不部署未完成A。
