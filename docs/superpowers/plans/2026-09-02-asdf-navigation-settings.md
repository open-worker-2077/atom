# ASDF Navigation and Unified Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复深层 F 游走与重叠节点命中身份，并把右上角重构为可配置 CapsLock 默认模式的居中统一设置入口。

**Architecture:** 可见节点使用`ownerPath::id`作为唯一交互坐标，域径规划器从节点真实 owner 路线生成完整过渡，空间引擎只通过一个提交边界同步更新游走状态。展示设置继续使用本地设置模型，统一窗口只消费该模型，不写 Graph 事实。

**Tech Stack:** Vanilla JavaScript、Canvas、Node test runner、Playwright、LocalStorage。

**Spec:** `docs/superpowers/specs/2026-09-02-asdf-navigation-settings-design.md`

**2026-09-03完成状态：** Task 2真实owner域径、Task 3默认详情模式、统一星轨设置和模态键盘隔离均已集成`main`并部署；提交链`22aca26`、`282a17f`、`efd1439`、`3abba9b`、`942284c`、`53cc5dc`、`244eb66`、`910e108`。后续A／S／D／F收束属于新架构方向，不是本计划未完成项。

## Global Constraints

- 不修改 Atom backing JSON、Program、锁或 Graph 语义。
- 不硬编码截图中的节点名称；测试使用结构等价的隔离数据。
- 每个生产改动前必须取得对应 RED，并在提交前完成焦点与完整验证。
- 点击次数仲裁只消费稳定节点坐标，不参与节点命中选择。

---

### Task 1: 最具体可见节点命中

**Files:**
- Modify: `spatial-middle-frame-target.js`
- Modify: `spatial-engine.js`
- Test: `tests/spatial-middle-frame-target.test.js`
- Test: `tests/gesture-contract.test.js`

**Interfaces:**
- Consumes: `{item,x,y,radius}`可见命中区域。
- Produces: `chooseMostSpecificTarget(regions,x,y,{excludeShellProxy})`和稳定`ownerPath::id`指针候选。

- [x] **Step 1: Write failing tests**：加入外层普通大节点、团壳、相邻小节点重叠场景，逐点断言命中最小真实节点，球外返回`null`；断言普通右键也使用同一解析器。
- [x] **Step 2: Run RED**：`node --test tests/spatial-middle-frame-target.test.js tests/gesture-contract.test.js`，真实 RED 为`choosePointerTarget is not a function`，既有 24 项通过、新增 2 项失败。
- [x] **Step 3: Implement minimal resolver use**：让 cluster 视野中的普通点击始终用最具体真实节点重排候选，保留命令和关系的既有分支。
- [x] **Step 4: Run GREEN**：焦点测试 26/26 通过、0 失败。
- [x] **Step 5: Commit**：`fix(web): preserve nested pointer identity`。

### Task 2: 真实 owner 域径与原子游走提交

**Files:**
- Modify: `spatial-view-mode-model.js`
- Modify: `spatial-engine.js`
- Test: `tests/spatial-view-mode-model.test.js`
- Test: `tests/view-mode-engine-contract.test.js`
- Test: `tests/browser/atom-web-critical-journeys.spec.mjs`

**Interfaces:**
- Consumes: 节点、`ownerPath`、owner route、owner labels、节点 lineage。
- Produces: `planImmersiveRoute(...) -> {entries,path,depth,crumbs}`；`commitDomainRoute(route,node)`同步替换活动域状态。

- [x] **Step 1: Write failing route tests**：以当前活动域`root/manage`和点击 owner`root/manage/work/personal`证明路线必须恢复 owner route 后再追加节点；错误 owner route 返回`null`。
- [x] **Step 2: Run model RED**：定向测试 17/19 通过，两个新用例因缺少 `resolveImmersiveOwnerContext` 按预期失败。
- [x] **Step 3: Implement pure route planner**：验证 owner route并复制不可变的 crumbs、camera 与 entryDirection；未知外域拒绝伪造路线。
- [x] **Step 4: Write failing browser journey**：在 manage→办包 的多层 cluster 中切到 F、右键个务，断言活动路径、内部节点加载和上层返回均为真实路线。
- [x] **Step 5: Run browser RED**：运行该 Playwright 用例，当前代码得到顶层伪路径或空数据。
- [x] **Step 6: Integrate one commit boundary**：`enterNode()`以节点真实 ownerPath规划路线并用同一函数提交所有状态；Shortcut保留相同完整路线合同。
- [x] **Step 7: Run GREEN**：聚焦Node `52/52`及浏览器旅程通过。
- [x] **Step 8: Commit**：`477db34`、`8b672e4`、`245efe0`完成实现与边界验证。

### Task 3: 星轨统一设置窗口与 CapsLock 默认模式

**Files:**
- Modify: `index.html`
- Modify: `spatial.css`
- Modify: `spatial-demo-model.js`
- Modify: `spatial-engine.js`
- Test: `tests/spatial-demo-model.test.js`
- Test: `tests/demo-engine-contract.test.js`
- Test: `tests/browser/mapping-layout-controls.spec.mjs`

**Interfaces:**
- Consumes: 现有展示设置和工具入口。
- Produces: `defaultDetailMode: 'name'|'surface'|'floating'`、居中`settingsPanel`及唯一星轨入口。

- [x] **Step 1: Write failing settings tests**：断言三种模式规范化与持久化、非法值回退`floating`、HTML只有一个星轨设置入口且窗口具备五个明确分区；追加真实浏览器后台快捷键隔离与启动默认详情用例。
- [x] **Step 2: Run RED**：设置模态打开后按`S`把后台从`nested`改成`peripheral`；默认详情真实启动用例直接通过，证明该项已有运行实现而非缺口。
- [x] **Step 3: Implement settings model**：加入`defaultDetailMode`及更新函数，保持旧设置自动补默认值。
- [x] **Step 4: Implement centered settings UI**：收束右上角、居中模态窗口、迁入工具入口和映射/显示控制；捕获模态键盘事件，Escape关闭，其余按键不进入后台场景。
- [x] **Step 5: Apply default detail mode**：启动和新进入域采用默认模式；历史快照恢复继续优先使用快照。
- [x] **Step 6: Run GREEN and browser journey**：聚焦Node `123/123`、默认详情/设置模态 Chromium `2/2`通过。
- [x] **Step 7: Commit**：`aa23734 feat(web): add unified orbital settings`；`4153cc7 fix(web): isolate orbital settings keyboard input`。

### Task 4: 架构约束、账本与完整验收

**Files:**
- Modify: `docs/superpowers/README.md`
- Modify: `docs/superpowers/plans/2026-09-02-asdf-navigation-settings.md`
- Test: `tests/view-mode-engine-contract.test.js`

**追加即时收件：** 完成既定深层游走与统一设置后，以 TDD 排查并修复普通名称层泄漏 `@slot-role-<内部ID>`；必须先区分权威数据标签、Web 投影拼接和详情模式渲染，内部稳定身份不得删除。
- Test: `tests/browser/atom-web-critical-journeys.spec.mjs`

**Interfaces:**
- Consumes: Tasks 1—3 完成结果。
- Produces: 可跨 Session 恢复的真实状态与完成证据。

- [x] **Step 1: Add boundary assertions**：防止 F 重新从全局`currentPath`直接拼路，防止普通点击绕过最具体节点解析器；断言域径状态只由`commitDomainRoute`一次提交。
- [x] **Step 2: Run focused verification**：命中、视图、设置模型与合同共`123/123`；设置与默认详情 Chromium `2/2`；F真实owner域径 Chromium `1/1`。
- [x] **Step 3: Run full verification**：完整`npm test`执行1700项，1696项直接通过；仅四条静态合同仍指向已部署`.lnk.`前的命令表及域径/详情旧函数位置。只更新对应断言后，三个受影响文件`68/68 PASS`；修正后未改生产代码，按最小受影响链不重复全量运行。
- [x] **Step 4: Update recovery ledger**：启动热态、Shortcut和本轮状态已写入恢复入口；后续由当前需求总账统一裁定。
- [x] **Step 5: Inspect and commit**：产品提交与账本提交均未包含backing JSON或私密世界数据。
- [x] **Step 6: Merge and push**：已集成并推送`main`，在线bundle为`910e108`对应构建。
