# Atom Web Bug Patrol Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 依次关闭用户在真实 4784 使用中报告的 Shortcut 原地返回、ASDF 双击命中上级、Strut 端点不贴边、CLI 更新后场景紊乱四项 Web 故障。

**Architecture:** 事实仍由 Atom/4784 权威投影提供；Web 只维护加载、命中、几何和视图连续性。每项先用真实故障边界写 RED，再作单一根因修复，并以浏览器最终路径或屏幕几何验收，不用内部变量假代用户结果。

**Tech Stack:** Node.js 24、原生 test runner、Playwright Chromium、Atom 4784 Spatial API。

**Spec:** `docs/superpowers/specs/2026-08-31-atom-web-spatial-design.md`

## Global Constraints

- 不直接编辑 Atom backing JSON，不把测试完成事实写进真实 4784 世界。
- 保留用户当前相机、焦点、展开与布局覆盖；视图修复不得成为事实写入。
- 每项生产改动必须先有对应 RED，并在隔离工作区完成。
- 单项通过后提交并推送 `main`；远端提交与测试证据写回本计划。

## 恢复断点

- **当前分支**：`fix/web-shortcut-lazy-route`，隔离目录仍为`.worktrees/esg-auto-jump`。
- **已完成代码**：Shortcut scoped state 补入远端目标的最小载体路线；未扩大全世界加载。
- **当前证据**：目标服务测试按预期 RED 后 GREEN；相邻服务/投影`13/13`；浏览器 Shortcut 旅程`4/4`；完整`npm test`为`1591/1591`、0 failure。
- **下一动作**：提交、合入并推送`main`；随后从 Task 2 Step 1 继续。
- **仍未完成**：ASDF 双击最深命中、Strut 可见边界贴合、CLI 更新后的视图连续性。

---

### Task 1: Shortcut 渐进跨域路线

**Files:**
- Modify: `cli/lib/server.mjs`
- Modify: `tests/spatial-server.test.mjs`
- Modify: `tests/browser/shortcut-navigation.spec.mjs`
- Modify: `docs/superpowers/specs/2026-08-31-atom-web-spatial-design.md`

**Interfaces:**
- Consumes: `knowledgeAtPath(knowledge, requestedPath)`、节点`shortcutTargetPath`与`childDomainPath(node)`。
- Produces: scoped state 中仅追加 linked target 及其到`root`的载体节点；浏览器原有`buildShortcutTargetRoute()`无需第二套解析。

- [x] **Step 1: Write and verify RED**：创建 root 可见 Shortcut 与正常两层 lookahead 之外的远端目标，断言 state 返回目标及缺失载体；旧实现以`undefined`失败。
- [x] **Step 2: Implement minimal route closure**：用`atomPath→target`与`childDomainPath→carrier`索引回溯到 root；路线不完整则不泄露半条路径。
- [x] **Step 3: Verify service and browser GREEN**：`tests/spatial-server.test.mjs`与图投影`13/13`；Playwright Shortcut`4/4`。
- [x] **Step 4: Full regression, commit and push**：完整`npm test`为`1591/1591`，Playwright Shortcut 为`4/4`；提交、快进与远端提交号在本任务提交后回写。

### Task 2: ASDF 双击采用最深稳定命中

**Files:**
- Modify: `spatial-engine.js`
- Modify: `spatial-gesture-arbiter.js`（仅当证据证明仲裁器丢失稳定目标）
- Test: `tests/gesture-contract.test.js`
- Test: `tests/spatial-gesture-arbiter.test.js`
- Test: `tests/browser/atom-web-critical-journeys.spec.mjs`

**Interfaces:**
- Consumes: 当前帧`state.hitRegions`、命中节点的稳定 visual key、secondary double-click intent。
- Produces: 两击必须绑定同一稳定目标；重叠命中选择屏幕上最深可见节点，外层 carrier 不得替换第二击目标。

- [ ] **Step 1: Reproduce RED**：在 A 模式展开父子重叠场景，对子节点坐标双击，断言最终路径属于子节点而非外部父节点。
- [ ] **Step 2: Trace hit selection**：记录两次 pointer hit 的候选深度、ownerPath 与 stable key，证明错误发生在命中排序或双击目标复用边界。
- [ ] **Step 3: Implement one stable-target rule**：只修正已证实的命中/仲裁层；单击选择、右键投影和空白双击合同保持不变。
- [ ] **Step 4: Verify and commit**：运行目标单测、关键浏览器旅程及全量回归，提交`fix(web): keep ASDF double-click on deepest target`。

### Task 3: Strut 端点贴合可见节点边界

**Files:**
- Modify: `spatial-visual-model.js`或`spatial-engine.js`中经根因确认的单一几何层
- Test: `tests/spatial-visual-model.test.js`
- Test: `tests/browser/compound-push-projection.spec.mjs`

**Interfaces:**
- Consumes: 关系端节点最终屏幕中心、最终可见半径、junction/trunk 几何。
- Produces: 每条可见 Strut 的首末点与对应圆边界距离误差在`1px`内；fan-in/fan-out 的 50% junction 身份不变。

- [ ] **Step 1: Reproduce RED**：构造 ASDF 下缩放不同的两端节点，直接断言首末点到中心距离等于最终屏幕半径，旧实现显示悬空或入球。
- [ ] **Step 2: Identify coordinate mismatch**：比较 world radius、cluster scale 与 screen radius，锁定哪一层把未缩放半径用于端点裁剪。
- [ ] **Step 3: Clip using final screen geometry**：只在最终屏幕几何层裁剪端点，不改 Graph clause、布局力或节点事实。
- [ ] **Step 4: Verify and commit**：运行 unit、compound Playwright 与全量回归，提交`fix(web): attach strut endpoints to visible boundaries`。

### Task 4: CLI 更新保持当前场景连续

**Files:**
- Modify: `spatial-browser-bridge.js`
- Modify: `spatial-workspace-model.js`或`spatial-engine.js`中经证据确认的身份重绑层
- Test: `tests/browser-bridge-contract.test.js`
- Test: `tests/browser/atom-web-critical-journeys.spec.mjs`

**Interfaces:**
- Consumes: SSE revision、scoped authoritative patch、稳定 Thing identity、当前 view snapshot。
- Produces: CLI 增删改移只重绑受影响实体；未失效的相机、焦点、展开路径、节点尺度和显式布局覆盖保持。

- [ ] **Step 1: Reproduce RED**：在非 root 路径保存相机/焦点/展开与布局，调用隔离 CLI 改名或移动，等待 SSE 后比较最终浏览器状态和屏幕坐标。
- [ ] **Step 2: Locate replacement boundary**：区分 scoped merge、`importKnowledge()`和布局 identity 重建，找出首次丢失稳定视图事实的位置。
- [ ] **Step 3: Preserve surviving identities**：只对删除或不可见目标清理视图状态；改名/移动按稳定 identity 重绑，迟到 revision 不得覆盖。
- [ ] **Step 4: Verify and commit**：运行 bridge contract、真实浏览器 CLI 旅程与全量回归，提交`fix(web): preserve scene across CLI projections`并推送`main`。
