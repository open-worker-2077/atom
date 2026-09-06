# A Mode Consolidation Implementation Plan

**当前续点（2026-09-06）**：Task1—6已独立复核；产品d2c0234、浏览器合同及退役清单a2c838e。Task7最终Node已执行一次，1857/1845pass/11旧合同失败/1skip；19519a1仅修两份Node合同且75/75，范围复核通过，随后整支评审和部署。A尚未部署，不重派已完成任务或重复全量。

**最新用户修订（2026-09-05）**：右键双击沉浸改为右键长按；已于Task5实施并复核，下方Task1—4旧双击步骤仅保留历史证据，当前合同以Web规格及Task5为准。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Atom Web 的结构游走收束为唯一 A 模式，以右键单击普通向内剖开、右键长按沉浸向内剖开，并以空白右键单击返回一层。下方双击任务细节为已保存旧实现，不能直接作为最新手势的验收。

**Architecture:** A nested Slot为唯一结构投影；旧F真实owner路线能力由A右键长按调用。既有secondary仲裁统一begin/release，默认420ms、范围240–800ms，同一共同展示设置字段；Graph事实、Transform、左键$click与权限链保持。

**Tech Stack:** Browser JavaScript (IIFE modules), Canvas spatial engine, Node.js 24 test runner, Playwright, localStorage presentation settings.

**Spec:** `docs/superpowers/specs/2026-08-31-atom-web-spatial-design.md` §4.1, §5.2, §6.2.

## Global Constraints

- 术语只使用“向内剖开”，不得写成“向外展开”。
- 右键沉浸长按时长默认`420ms`，可调范围`240–800ms`，只影响无修饰键的右键导航。
- `Ctrl+右键`关系编辑、`Shift+右键`魔杖与左键可编程点击计数不进入右键导航仲裁。
- 团上右键单击保留团外上下文；同一团右键长按隐藏团外节点、边和上级背景；双击不得沉浸。
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

### Task 5: 右键长按、共同设置与帮助同步收束

**Files:**
- Modify: `input-config.js`, `spatial-gesture-arbiter.js`, `spatial-engine.js`, `index.html`。
- Modify as needed: `spatial-demo-model.js`, `src/atom-system/spatial-experience/presentation-settings-service.mjs`。
- Test: `tests/input-config.test.js`, `tests/spatial-gesture-arbiter.test.js`, `tests/gesture-contract.test.js`, `tests/mobile-interaction-contract.test.js`, `tests/atom-presentation-settings.test.mjs`。
- Test: `tests/browser/mobile-control-panel.spec.mjs`, `tests/browser/atom-web-critical-journeys.spec.mjs`及既有共同配置浏览器旅程。

**Interfaces:**
- Consumes: 已完成A普通/沉浸导航、稳定Thing命中、现有pointer生命周期及同一服务共同展示配置。
- Produces: 普通右键短按向内剖开、右键持续长按沉浸；同一字段`secondaryNavigationDelayMs`改为长按阈值；帮助/控件与行为一致。

**Binding constraints（覆盖旧Task1—4示例中的双击要求，不重做已完成导航）:**
- 以Web规格§4.1、§5.2、§5.5为准；不改Graph、权限、Transform、Program或生产数据。
- 长按默认420ms，可调240–800ms，沿已有字段和DOM控件；文案为“右键沉浸长按时长”，单字段恢复默认和跨端共同配置均保留。
- 同一次无修饰右键按下锚定稳定Thing及阈值；阈值前松开为普通剖开，持续到阈值仅沉浸一次，之后松开无第二导航。右键双击不得沉浸。
- 拖拽、pointercancel、lost capture、失焦或修饰键改变取消待识别长按；不得留下迟到定时器导航。Ctrl关系编辑、Shift魔杖、左键可编程点击和中键拖拽保持。
- 空白单击仅返回直接父层并解除沉浸，空白双击仍仅返回一次；按原仲裁方式保留这一有效需求，无空白长按沉浸。
- 共同设置服务读取旧已保存完整字段集时，只允许缺此次新增的secondaryNavigationDelayMs并补默认；保留所有其他有效字段/合法0/原revision，不在GET写盘。未知字段、其他必需字段缺失、损坏值仍拒绝；下次显式更新按原CAS保存完整现行字段集。
- S/D/独立F退出活跃帮助、设置、键位和手机控件；保留A子层缩小（旧peripheralDepthShrink变量实际被A消费）、历史Z/X、详情、编辑、魔杖等有效需求。
- 实现复用现有手势模块和pointer生命周期，不新增通用手势框架或第二配置来源。代码行为退役由Git和Task6清单保全，不删除文件/产物。

- [x] **Step 1: 获得新长按与旧共同设置读取RED**

真实定时器模型覆盖短按/长按/松开一次/取消及旧双击不沉浸；真实Chromium在旧双击实现上验证持续按住未沉浸得到RED。旧完整设置文档缺新字段的读取目前严格数量校验拒绝，补实际服务用例RED，验证其余字段守恒及坏文档拒绝。新行为RED不能用源码正则替代。

- [x] **Step 2: 实现最小长按和配置接线**

输入意图、现有右键仲裁、pointer生命周期、共同配置服务读取按上述合同一次收束。帮助、设置可访问标签、桌面及移动控件同步为长按；移动端已有虚拟右键复用同一意图/识别链，不造另一套业务语义。

- [x] **Step 3: 最小受影响链GREEN及真实浏览器证明**

先跑受改函数相关Node测试，再跑三个关键行为：短按保留团外、长按沉浸且松开不二次导航、空白快速双击单层返回。补拖拽/取消及修饰键隔离的定向行为证明；设置调值→重载→恢复默认→重载、服务共同基准继承与缺字段保全。证据保存到本计划SDD，浏览器输出使用唯一目录防覆盖删除。只跑必要具名旅程，不在此任务运行全量npm test。

- [x] **Step 4: 自审、提交和任务复核**

修改符号前GitNexus impact，提交前detect_changes与diff检查；只提交本任务文件，报告RED/GREEN实际命令、输出、源码范围与疑点。最终独立任务复核由控制方派发；Task6复用同revision有效浏览器证据并完成退役清单，Task7才执行最终全量、部署与正式入口回读。

### Task 6: 真实浏览器关键旅程与封存清单

**Files:**
- Modify: `tests/browser/atom-web-critical-journeys.spec.mjs`，必要时相关已有浏览器合同。
- Create: `docs/superpowers/archive/2026-09-04-asdf-mode-retirement.md`。
- Modify: 本计划、唯一需求总账和既有恢复断点。

**Interfaces:**
- Consumes: Task5已独立复核的长按输入、导航、共同设置及帮助；同revision原始RED/GREEN。
- Produces: 保全原功能验收含义的A唯一模式浏览器链；退役功能→原提交→当前替代路径清单。

- [x] **Step 1: 核对并复用新手势证据，校准旧测试准备动作**

Task5已经负责长按RED/GREEN，Task1—4原双击RED保留为历史，不重新制造旧行为RED。先读Task5报告与原始输出。现有浏览器关键旅程中“F entry keeps every intended child node inside the rendered viewport”及批量移动目标准备仍按旧独立F模式操作；只将进入动作改为真实右键长按，保持“每个子节点在可见视口”“批量移动保存回执/节点完整”等原业务断言。不得删除有效旅程、放宽其结果或通过测试专用模式绕过真实输入。

- [x] **Step 2: 完成必要浏览器修正并运行受影响旅程**

在独立、零生产写入的现有测试世界运行修订旅程。首次改测试后如失败，区分旧准备动作未迁移、夹具问题与产品实际回归，后者交原Task5实施方定向修正和复核。不新增导航框架或改变已批准行为。包含Task5具名A短按/长按/松开/单层返回、共同配置及mobile-control-panel在内的现有关键旅程全体须具备当前候选有效证据；同revision已通过的具名测试可复用，只运行尚无证据的互补集合。唯一浏览器输出目录保全所有产物，不删除目录或测试清理世界。

- [x] **Step 3: 写入可恢复退役清单**

清单按实际行为和源码引用，列出S外围、D层级、独立F的原入口、旧提交及A当前替代；沉浸能力仍由A右键长按提供。保留仍被A使用的owner-route、domain-frame、A子层缩小及其他有效需求，不仅按旧变量名删除代码。引用既有标签`pre-a-mode-consolidation-20260904`，核验可解析；安全查看用git show，恢复从标签建新分支，不reset覆盖工作树。历史旧双击代码与长按替代也注明，不把封存当成删除文件。

- [x] **Step 4: 受影响链验收、证据入账与提交**

复用Task5同revision的输入、模型、手势、UI及共同配置有效证据；如实际修改产品则定向重验最小受影响链再升级真实旅程。更新原总账/恢复断点，精确标明仅候选完成、尚未部署，记录commit和实际测试统计。GitNexus detect_changes及diff检查后提交；独立Task6复核由控制方派发。最终全量只在Task7执行。

### Task 7: 候选版本验证、部署与回读

**Files:**
- Modify if mechanically required: `index.html` build id only through `npm run build:browser`
- Modify: `docs/superpowers/plans/2026-09-03-atom-current-requirement-ledger.md`
- Modify: `docs/superpowers/plans/2026-09-03-session-recovery-checkpoint.md`

**Interfaces:**
- Consumes: Task 6已稳定候选 revision。
- Produces: 唯一一次全量 Node 门禁、开发控制门禁、4784部署与公开入口回读证据。

- [x] **Step 1: Run pre-commit complexity and source checks**

Run: `git diff --check`

Run: `npm run check:development-control`

Expected: both exit 0; no duplicate mode abstraction, dead configuration, second settings store or compatibility branch remains.

- [x] **Step 2: Run the final full Node suite exactly once for this candidate**

Run: `npm test`

Expected: build succeeds and all Node tests PASS. A real failure returns to focused debugging; infrastructure-only failure is recorded and retried without calling the candidate green.

- [ ] **Step 3: Deploy through the existing Atom Graph Runtime entry**

先集成并正常构建，按既有受控入口停止旧Atom Graph Runtime后重新启动，临时抑制watchdog并在finally恢复；核验listener对应的新进程创建时间晚于部署，不重复启动临时4784进程。

从现行health读取`atomProjection.status: published`；浏览器build从正式HTTPS HTML标识及实际资产hash回读，health不提供浏览器build。部署前保全当前世界和展示配置，不能恢复旧业务快照。

- [ ] **Step 4: Re-read the deployed public entry**

Verify through real Chromium that the three Task 6 journeys pass against 4784 and that Help/settings expose only A ordinary/immersive inward navigation plus the persisted interval. Confirm Ctrl+right, Shift+right and left programmable click remain operational with their focused journeys.

- [ ] **Step 5: Update evidence and commit the deployed candidate**

```bash
git add index.html docs/superpowers/plans/2026-09-03-atom-current-requirement-ledger.md docs/superpowers/plans/2026-09-03-session-recovery-checkpoint.md
git commit -m "chore(web): record A-mode deployment evidence"
```

Do not push this post-baseline work without a new user authorization. Keep `pre-a-mode-consolidation-20260904` unchanged as the remote rollback point.

## 2026-09-05 历史接手与执行证据（当前续点见页首）

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

- **Ruling: 长按续接与共享字段**：用户已明确右键双击改长按，沿现有420ms/240–800ms参数改含义，阈值在按下时固定；空白双击单层返回保留。Task5包含手势与帮助同步，Task6复用新旅程。服务当前严格完整字段数会拒绝旧保存文档，允许仅缺新字段的窄迁移为必要依赖，不改Atom内核。错误代价为可逆Web阈值/识别调整或配置读取返工，旧数据及Git历史保全。

| 续接核查 | 实际生产/消费关系 | 裁定 |
|---|---|---|
| Task1—4 / Task5 | 已有A导航消费旧double意图；新入口为hold | 只替换识别和映射，不重做导航结构；保留旧验收历史 |
| Task5自身 | 识别、设置、帮助共同定义长按 | 同任务完成；Node+真实按住验收，无仅文案假实现 |
| 共同配置 / Task5 | 服务严格字段数消费新增设置 | 窄补新字段并保持原revision、其余值与CAS |
| Task5 / Task6 | 同文件浏览器旅程与退役清单 | 长按RED/GREEN前移至Task5，Task6复用而不重跑 |
| Task6 / Task7 | 稳定候选→最终全量/正式入口 | 不以隔离测试冒称部署；旧Task7 health示意按真实atomProjection和HTML build读取 |
- **Task5执行断点**：BASE=d9f98776667af82d16d8828aa42f10104d11ec11，实施方a_task5_longpress（Sol high），既有SDD task-5-longpress-brief.md/report.md。GitNexus已刷新，右键仲裁/输入/释放及服务read影响LOW；尚未取得新长按GREEN，未部署。
- **Ruling: Task6证据复用**：原Task6再次索取Task4前RED与当前长按方案矛盾，改为复用Task5有效证据并迁移现存F准备动作，保全原业务与屏幕断言。只运行尚无当前证据的互补旅程，失败才定向调试；错误代价为测试组织返工，不削减功能。Task7旧health键与仅Run示意按真实服务字段/新进程核验修正。
- **Task5首轮RED（实施方已回传，待root最终核验原始报告）**：Node focused63项/50pass/13fail，覆盖arbiter缺begin/release、旧完整共同配置缺新字段被拒绝及输入/UI旧双击文案。Chromium具名3项/0pass/3fail：持续按住440ms仍root、双击反而进入团、空白旅程的长按进入前提失败。后者尚不证明返回本身故障。产物本计划SDD task-5-browser-red-20260906-01，保留截图/上下文/trace；当前实施最小修正，未部署。

- **Task5中间GREEN与局部取消失败**：实施方回传Node63/63；Chromium短按、长按松开不二次、双击不沉浸、空白双击单退4/4（task-5-browser-green-20260906-01）。新取消旅程右键100ms后移动12px仍沉浸，已见buttons=2 pointermove；只阻塞取消链，不重复4项有效证据。root按用户许可派a_hold_cancel_consult（Astra high）只读咨询timer取消边界，Sol保留实施所有权，建议须回到源码独立裁定；尚未完成Task5或部署。

- **Astra取消咨询／root裁定**：07:05—07:06只读04 trace，down调用3817.722→4113.510ms，标称wait100实际4114.521→4415.184ms，move从4416.435ms开始，已距down调用开始598.713ms。静态pointermove≥6px→取消→清candidate与arbiter clearTimeout/token失效链一致，不能由12px/buttons2推定阈值前取消；先用浏览器统一performance.now证据区分夹具迟到与产品缺陷，不据咨询盲改。Astra附带right-drag疑点由root核对input-config drag分支裁定：无修饰右拖原本无动作，取消标记只作用此类secondaryNavigation，不构成已确认需求损失。若时序判断错误，代价为继续定向修复取消链，既有规则和生产保持。

- **Task5取消GREEN**：实施方用Playwright page.clock控制浏览器时间、默认420ms及真实鼠标/键盘事件，12px拖移/pointercancel/修饰键变化后各推进421ms保持root，1/1通过（task-5-browser-green-20260906-09）。结合04 trace跨进程延迟，原失败不能作为阈值前取消失效证据；无额外产品取消补丁，临时engine探针与timer/pointer wrapper已移除。最终原始报告及独立任务复核待完成，生产A未部署。

- **Task5候选审查**：a38d739为产品提交，2da5ab6仅解除新报告Git跟踪且磁盘保留。root已读完整报告、核对浏览器.last-run通过及无临时探针；Node63/63、核心4/4、受控取消1/1、设置重载恢复1/1、独立390px上下文共同字段继承更新1/1。旧presentation-settings综合旅程仍在F/applyViewMode准备断言失败，归Task6迁移准备动作并保全全部设置断言。a_task5_longpress_review（Sol high）正审d9f9877..2da5ab6，未裁定任务完成；只读Astra咨询结束，不重复派发。私有报告task-5-longpress-report.md与净差异review-d9f9877..2da5ab6.diff保留。

- **Task5独立复核／fix round1/5**：a_task5_longpress_review判规格/质量待修，唯一Important为begin未锚定实际按下时间，release仅依holdCommitted，在持续到阈值而timer回调尚未执行时误判single。Root回到当前arbiter确认此顺序可达且违反持续时间合同；原实施方a_task5_longpress补单调时间锚定和release阈值判定。FIX_BASE=2da5ab6，当前fd2bf43仅追加计划记录；新增确定性now前进但不执行timer的RED，GREEN覆盖短按/长按/晚timer一次性/取消/空白及阈值固定。仅仲裁/gesture定向与必要具名长按浏览器，不重复设置链或全量。Task6/7缺口保留，不抢跑下一任务。

- **Task5 fix round1/5完成**：d2c02345096a7bb5a6ac2d744d304d00978cc686，默认performance.now锚定按下时长，release补判到期且迟到timer不重复；RED38/40→GREEN40/40、必要真实长按1/1。a_task5_longpress_review限定复审原Important已ADDRESSED、无新增破坏。Root核对修复源码及.last-run，Task5: complete（BASE d9f9877..d2c0234）；原核心/设置/跨端有效证据复用。Task6接续旧F准备动作/互补旅程与退役清单；仍未部署A。

- **Task6执行断点**：BASE=e379b98e0fa77732a9d22295331f52a8fbe0d0c5，实施方a_task6_browser_retirement（Sol high），requirements/report为原SDD目录task-6-longpress-*。仅迁移旧浏览器准备动作、补齐互补旅程并保全退役清单；产品回归交原Task5定向修复，最终全量及部署归Task7。

- **Task6首轮互补验收**：task-6-browser-complementary-20260906-01已保全；实施方回传5项通过（首入、连续进入、8节点视口、Help、创建持久），4项失败后停止依赖组。root核对当前engine已无applyViewMode分派，三项失败发生于旧准备而非新hold；修为真实短右击并保留clusterFieldOpen/完整展开/owner-route原断言。搜索仍有index.html355入口，核对设置面板可见性；尚未裁定产品回归。已过5项同产品证据复用。

- **Task6定向准备修订GREEN**：task-6-browser-targeted-20260906-02，4/4通过（1.5m）；三项applyViewMode准备改真实右键，搜索用现行Ctrl+K入口，原业务断言保全。连同首轮5项已有9项互补有效证据；尚余批量/移动/回滚及共同配置综合旅程。main文档f124245已同步Task5完成/Task6当前断点，未改变生产产品。

- **Task6首帧证据校准**：root回读发现两项首帧测试在hold helper完整等待/松开后才取rAF，可能已越过切换首帧；既有PASS只证明最终可见，暂不满足原时间语义。要求原实施方在真实输入前安装只读观察，保存path首次变化视觉帧再断言，定向重验2项；其余7项有效证据不重跑。不是产品回归，不弱化或移除原首帧需求。

- **部署准备／局部外部状态**：当前产品development-control已exit0；原SDD保留deploy-reviewed-a-candidate.ps1（复用既有受控停启/完整世界及配置备份）、verify-deployed-a.mjs与verify-deployed-assets.mjs，静态语法通过，尚未执行部署。07:50巡守Pixel 10a仍离线，CUA仅无标签IAB；不写入猜测配置、不冒称真机。最终npm test仍未运行，待Task6产品候选稳定。

- **Task6批量回执诊断**：batch05已到Enter并显示projection pending，但workspace-persisted为空；root回读bridge reportPendingProjection及pushKnowledge提前return，否决未经证实的监听跨导航丢失推断。要求先提取workspace-edit原始response/投影失败原因和只读事实，不能由提示直接推定批量完整成功，也不能重复提交掩盖未知结果。尚未改产品。
- **Ruling: Task6异步回执验收**：batch05 workspace-edit HTTP200、changed=true、8项成功；PROJECTION_PUBLICATION_SCHEDULED为来源提交后的正常异步发布窗口。原测试只等即时persisted，把来源提交与投影发布强绑定，按已部署提交分离合同校准：同时捕获真实HTTP与pending/persisted，保持operation kind/landings原断言；pending时等待公开只读state的目标8/来源0与关系守恒，并验证同一浏览器实际knowledge/目标恢复。不得伪造事件、手动恢复或重提移动；公开state不替代浏览器结果。临时世界facts、graph、knowledge只读证据一致；仍须同页GREEN，不能仅由最终文件推定UI通过。无内核改动。错误代价为测试时序返工，不删业务验收。
- **Task6首入加载待裁定**：真实被动首帧07中首次进入只有测试入口，连续第二次进入通过。root复读Web§2.1—2.2允许新路径loading并等待权威state，§4.1要求复用此合同；不能把未加载节点瞬时全齐当新增要求。已派a_first_frame_consult（Astra high）只读核对observer/权威scope/绘制顺序，root同时核对enterNode→commitDomainRoute→pushView/pullKnowledge；咨询不授权改产品。首帧有效性待裁定，Task6独立批量验收继续。
- **Task6共同配置准备定界**：原综合设置旅程的边界stroke属于nested团普通剖开；直接长按沉浸后已隐藏该团外边界，不能要求其仍绘制。恢复真实短右击→边界stroke断言，再长按→路径断言及原合法0持久/跨端全部断言；不改边框产品或猜测生产参数。

- **Task6批量投影证据**：batch09真实HTTP成功/changed、目标与来源数量、公开state恢复已通过；剩余比较因路径移动后的投影ID不同误报。按各自knowledge的id→精确atomPath及本次来源/目的前缀映射对齐11条关系的端点和关系字段，不能仅比ID、边数或不唯一label；同页知识/显示及关系证据必须全部成立。产品仍未修改。
- **Astra首帧咨询／root复核**：咨询未改文件/运行测试；原root/目标scope响应均含目标域5节点，四项预期已在。root已读enterNode/commitDomainRoute及bridge加载链；rendered descriptors由投影裁剪后列表生成，首路径帧不等同权威就绪或镜头稳定帧。07 trace在6969.685ms明确loading，但observer未同帧记录scope，现阶段不裁定产品回归。已要求Task6被动采集首次路径/首次目标scope loaded的节点集合、ownerPath、camera/phase并核对实际响应；按规格分清加载/完整数据/最终入镜，不增加预取、不取消过渡或改内核。错误判断将导致测试时点返工，原失败完整保留。
- **Ruling: Task6批量可见性边界校准**：batch13真实HTTP8/8、pending operation、公开state目标8/来源0及11条精确atomPath/关系、同页exportKnowledge目标8/来源0及11关系均通过；30秒内rendered为2/8。原batch测试仅要求回执与完整知识/目标路径，Web§3.2要求保留相机及显式布局，并无批量后自动八节点同屏合同。root此前追加全体visible过度扩展，撤回仅该新断言，原断言及本轮同页权威对账全保留；不据此改相机/产品，不混同独立域进入viewport合同。2/8作为尚未裁定的展示观察保留，不能写成已证回归。复用13该末尾断言之前有效证据，不重复提交或整段重跑；代价由root承担为本轮额外验证耗时，无需求删减。
- **Ruling: 首帧数据与相机验收分离**：诊断15同一path-change帧scope=loaded、knowledge=authoritative，exportField含目标域全部5节点，rendered为目标域测试入口且phase=aim、camera.distance=1.84。因此不是加载缺失；旧四标签瞬时rendered断言混同完整数据与既有420ms相机过渡。保留首路径帧完整目标域/非空正确ownerPath，再在同次导航相机稳定后验证原四标签全部visible，标题按真实时点改写；不取消过渡、预载或修改产品。连续第二域首帧PASS复用，仅修订首入1项重验。若裁定错误，代价为重新定义过渡视觉验收；节点/关系/原四标签要求完整保留，不把诊断失败掩盖成原测试全绿。
- **Ruling: 背景缓存验收对象**：steady测试全局Canvas ellipse/blit=72超过70，但该计数混入主画布所有节点；root读drawStaticBackdrop1722—1748，背景独立layer仅cache key变时绘制。改为被动识别主spaceCanvas全幅blit的已预热背景源，验证稳定窗口复用同一layer并无背景ellipse重绘，不提高70阈值或修改产品。以直接缓存行为替换不准确混合代理，保留性能目的；若识别源错误会导致该项验收返工，须静态核对并保留诊断。

- **Task7 Node门禁已启动**：产品自d2c0234未变，最小Node与核心浏览器行为已验证；剩余Task6只修旧浏览器准备/观察合同及文档，因此最终Node全量与其收尾并行，不等待文档串行完成。日志final-full-d2c0234-20260906-01.log、root session3166；npm build机械stamp由root收口，未部署。若出现产品变更先界定证据失效，不据本次启动声称已通过。
- **Task6完整覆盖回传待独立复核**：critical24/24、mobile3/3、presentation2/2以原有效证据和本轮互补组合覆盖；首入18、single21、subtree19、rollback20、背景直接缓存20、mobile22/23等已通过，无已裁定产品失败。实现方正提交4个测试/退役文件和完整报告；root须核对报告并独立任务复核，不以自报提前标complete。

- **Task7最终Node结果**：final-full-d2c0234-20260906-01.log，exit1，1857total/1845pass/11fail/1 Windows symlink skip，497112.6794ms。失败位于editor-engine-contract.test.js549及view-mode-engine-contract.test.js43/53/59/69/88/102/127/159/251/262，均指向退役ASDF/applyViewMode/旧mode guard等合同。先按真实源码/规格定向核查校准两文件，不以旧入口测试强迫恢复已撤回功能；产品未改变，已通过1845证据保留，不重跑全量求外观。门禁尚未关闭，部署未执行。
- **Task6候选复核中**：a2c838e711a2f8efbfbd1520736e10b910762c1b，三份浏览器测试+退役清单4文件；root已完整读task-6-longpress-report.md，coverage29项按Task4复用2、Task5复用7、本轮20组合。a_task6_review（Sol high）只读评审e379b98..a2c838e，差异包review-e379b98..a2c838e.diff。Task7两Node合同校准由原a_task5_longpress续接，BASE a2c838e，新报告task-7-node-contract-report.md；只两文件定向，不改产品/重跑浏览器或全量。正式入口只读预检HTML与当前main原样相同HTTP200，仍是旧生产而非A部署。
- **Task6: complete**：e379b98..a2c838e，a_task6_review规格合规、quality Approved，无Critical/Important/Minor。Root复核跨差异项：Task5 d2c0234已限定复审的稳定锚定/阈值/松开一次/双击隔离证据继续有效；本轮git rev-parse标签对象实际解析f2d2fd083329e0c145248988f16fb722a1b4c085，与退役清单一致。关键浏览器29项采用组合证据，未重跑求整组外观；不是单次29项全量结果。
- **Task7合同定向GREEN待复核**：19519a1仅改editor-engine-contract与view-mode-engine-contract两测试；保留11项对应验收与A历史/批量/递归/PageUpDown/End/边编辑，定向75/75 PASS，产品未变。原a_task5_longpress_review只读评审a2c838e..19519a1；最终Node使用全量1845项通过加定向75项的组合证据，保留原11失败记录，不写成单次1857全绿。部署尚未执行。
- **Task7 Node门禁关闭（组合证据）**：a_task5_longpress_review已复核a2c838e..19519a1，规格符合、质量Approved、零分级问题；root读完整报告并对照11处差异，接受全量1845通过+两文件75/75定向修正。产品未变，development-control既有exit0复用，当前diff-check通过；只关闭候选测试门禁，部署/正式入口仍开放。

- **最终整支评审进行中**：a_final_review（Astra high）按8643a3e..473bc0e包只读核查；root负责独立裁定。b6dca76仅吸收main重复文档历史并保留已核对当前A记录，git diff 473bc0e HEAD为空，正式合并预检无冲突，产品未变。08:50只读核对原运行任务/Watchdog符合既有部署入口，Pixel 10a仍离线，共同设置revision0/initialized=false；不填猜值。
- **最终复核待验证边界**：评审初步发现普通nested空白首次收缩后domainContext.path变化可能绕过双击合并，以及candidate.direct未在beginSecondaryNavigation入口排除导致直接工具长按误入导航。root已回读classifyTap、begin/commit、candidateArbiterKey及applyParentView，确认须定向验证既有合同；暂不部署，等待完整最终清单后合并派一次最小修复，不逐项开支线，不改内核。
- **最终评审裁定／单次修复**：a_final_review完整报告With fixes，I1普通nested空白跨路径双击、I2 direct工具串入hold两Important，无Critical/Minor。Root根据Web§4.1/原direct隔离合同及实际控制流采纳为待行为RED验证的缺口；原a_task5_longpress统一处理，BASE b6dca76，brief/report为a-final-fix-*。仅受影响Node与具名真实输入复验，不重跑全量或改内核；之后一次范围复审，部署仍未执行。
