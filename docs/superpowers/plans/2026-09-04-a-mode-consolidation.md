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

- [ ] **Step 1: Write failing A-only input tests**

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

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `node --test tests/input-config.test.js tests/spatial-view-mode-model.test.js`

Expected: FAIL because the old contract still exposes peripheral/hierarchy/immersive modes and right double-click has no intent.

- [ ] **Step 3: Implement the minimal A-only contract**

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

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run: `node --test tests/input-config.test.js tests/spatial-view-mode-model.test.js`

Expected: PASS.

- [ ] **Step 5: Commit the A-only input contract**

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

- [ ] **Step 1: Write failing settings normalization tests**

```js
assert.equal(model.normalizeSettings({}).secondaryNavigationDelayMs, 420);
assert.equal(model.normalizeSettings({ secondaryNavigationDelayMs: 120 }).secondaryNavigationDelayMs, 240);
assert.equal(model.normalizeSettings({ secondaryNavigationDelayMs: 1200 }).secondaryNavigationDelayMs, 800);
assert.equal(model.withSecondaryNavigationDelayInput({}, '515').secondaryNavigationDelayMs, 515);
```

Also assert that `index.html` contains an accessible range input with `min="240"`, `max="800"`, `value="420"` in the mapping section.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `node --test tests/spatial-demo-model.test.js tests/mobile-interaction-contract.test.js`

Expected: FAIL because the setting and controls do not exist.

- [ ] **Step 3: Implement settings normalization and UI wiring**

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

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run: `node --test tests/spatial-demo-model.test.js tests/mobile-interaction-contract.test.js`

Expected: PASS.

- [ ] **Step 5: Commit the persisted interval setting**

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

- [ ] **Step 1: Write failing dynamic-delay and exact-signature tests**

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

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `node --test tests/spatial-gesture-arbiter.test.js tests/gesture-contract.test.js`

Expected: FAIL because the engine bypasses `secondaryClickArbiter.submit` and delay is fixed at construction.

- [ ] **Step 3: Implement dynamic secondary arbitration**

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

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run: `node --test tests/spatial-gesture-arbiter.test.js tests/gesture-contract.test.js`

Expected: PASS.

- [ ] **Step 5: Commit right-click arbitration**

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

- [ ] **Step 1: Write failing engine contract tests**

```js
assert.match(engineSource, /case "applyInwardView"/);
assert.match(engineSource, /case "applyImmersiveInwardView"/);
assert.match(engineSource, /applyImmersiveInwardView\(node\)[\s\S]*enterNode\(node, true\)/);
assert.doesNotMatch(engineSource, /case "setPeripheralView"|case "setHierarchyView"|case "setImmersiveView"/);
assert.doesNotMatch(engineSource, /mode === "peripheral"|state\.viewMode === "immersive"/);
```

Add model tests proving batch/recursive A actions always use nested projection and cannot select a second structural mode.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `node --test tests/cluster-engine-contract.test.js tests/gesture-contract.test.js tests/spatial-view-mode-model.test.js`

Expected: FAIL on old mode branches and missing A action functions.

- [ ] **Step 3: Implement the single A runtime path**

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

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run: `node --test tests/cluster-engine-contract.test.js tests/gesture-contract.test.js tests/spatial-view-mode-model.test.js`

Expected: PASS.

- [ ] **Step 5: Commit the A navigation runtime**

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
