# Atom Web Bug Patrol Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 依次关闭用户在真实 4784 使用中报告的 Shortcut 原地返回、ASDF 双击命中上级、Strut 端点不贴边、CLI 更新后场景紊乱，以及手机私网域名不可访问等现场故障。

**Architecture:** 事实仍由 Atom/4784 权威投影提供；Web 只维护加载、命中、几何和视图连续性。每项先用真实故障边界写 RED，再作单一根因修复，并以浏览器最终路径或屏幕几何验收，不用内部变量假代用户结果。

**Tech Stack:** Node.js 24、原生 test runner、Playwright Chromium、Atom 4784 Spatial API。

**Spec:** `docs/superpowers/specs/2026-08-31-atom-web-spatial-design.md`

## Global Constraints

- 不直接编辑 Atom backing JSON，不把测试完成事实写进真实 4784 世界。
- 保留用户当前相机、焦点、展开与布局覆盖；视图修复不得成为事实写入。
- 每项生产改动必须先有对应 RED，并在隔离工作区完成。
- 单项通过后提交并推送 `main`；远端提交与测试证据写回本计划。

## 恢复断点

- **当前分支**：`fix/web-strut-visible-boundaries`，隔离目录仍为`.worktrees/esg-auto-jump`。
- **已完成代码**：Shortcut 远端路线与 ASDF 双击最深命中已推送；普通视图与 ASDF 现共用一条 Strut 语义绘制层，记录的几何即实际边界裁剪几何。
- **当前证据**：ASDF Strut 用例先以几何缺失 RED，修复后目标用例`1/1`、完整复合 Strut 浏览器旅程`2/2`、结构几何与渲染合同`109/109`。第一次完整回归仅既有重型布局性能门槛受全套负载影响为`1316.8ms > 1300ms`，隔离复跑为`1187.6ms`；第二次完整回归为`1591/1591`、退出码 0。
- **Task 1 实现提交**：`89a879a`（`fix(web): load remote shortcut routes`）。
- **Task 2 实现提交**：`9a61ff2`（`fix(web): keep ASDF double-click on deepest target`）。
- **Task 3 安全回退提交**：`83f63f1`（`fix(web): attach strut endpoints to visible boundaries`）。
- **下一动作**：将 Task 3 快进合入并推送`main`；随后从 Task 4 Step 1 继续。
- **仍未完成**：CLI 更新后的视图连续性；手机访问`worker.tail33a2eb.ts.net`的现场链路不可用。

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

- [x] **Step 1: Reproduce RED**：在 A 模式展开父子重叠场景，对子节点坐标双击，断言`activate`目标为子节点；旧实现实际交付外部父节点。
- [x] **Step 2: Trace hit selection**：两击稳定落在同一错误目标；根因是已选中的外层 cluster shell hit priority 压过其内部实际可见节点，不是点击次数仲裁器换靶。
- [x] **Step 3: Implement one stable-target rule**：仅当 ASDF 最高候选为 cluster shell 且指针确实位于非 shell 可见节点圆内时，将最具体内层节点提升为目标；其余排序合同不变。
- [x] **Step 4: Verify and commit**：目标 Playwright`1/1`、命中/手势/输入邻接单测`46/46`、完整`npm test`为`1591/1591`；提交号在代码提交后回写。

### Task 3: Strut 端点贴合可见节点边界

**Files:**
- Modify: `spatial-visual-model.js`或`spatial-engine.js`中经根因确认的单一几何层
- Test: `tests/spatial-visual-model.test.js`
- Test: `tests/browser/compound-push-projection.spec.mjs`

**Interfaces:**
- Consumes: 关系端节点最终屏幕中心、最终可见半径、junction/trunk 几何。
- Produces: 每条可见 Strut 的首末点与对应圆边界距离误差在`1px`内；fan-in/fan-out 的 50% junction 身份不变。

- [x] **Step 1: Reproduce RED**：构造 ASDF 内包域的二元 Strut，断言首末点到中心距离等于最终屏幕半径；旧实现首先暴露 ASDF 未进入 Strut 语义绘制层，几何为零条。
- [x] **Step 2: Identify coordinate mismatch**：ASDF 仅画普通 workspace edge，普通视图则把 Strut 中心几何与`0.94R/0.28D`裁剪分开维护；两条路径既丢语义又无法用最终可见半径验收。
- [x] **Step 3: Clip using final screen geometry**：两种视图共用`prepareStrutLayer`；每条线以最终`screen.radius`裁剪并把实际首末点写回可验证几何，Graph clause、50% junction 与事实不变。
- [x] **Step 4: Verify and commit**：unit/合同`109/109`、compound Playwright`2/2`；第二次完整回归`1591/1591`、退出码 0；实现提交为`83f63f1`。

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

### Task 5: 手机私网域名现场连通

**现场证据：** 2026-09-01 用户从手机访问`worker.tail33a2eb.ts.net`仍然无法打开。现有私有网关、身份白名单、POST/SSE、等待页和 4784 隔离单测通过，只证明代码合同，不证明真实手机、Tailscale DNS、证书、监听和任务进程组成的现场链路已通。

- [ ] **Step 1: Reproduce from the real boundary**：核对域名解析、Tailscale 身份、HTTPS/端口入口、网关与 4784 健康状态，保留每一跳证据。
- [ ] **Step 2: Locate the first broken hop**：区分客户端网络/DNS、TLS、网关授权、服务任务和 4784 上游，不以单测替代现场判断。
- [ ] **Step 3: Fix the single root cause**：只修首个实际断点，不开放公网入口，不削弱身份白名单。
- [ ] **Step 4: Verify on phone**：以用户手机成功打开并完成一次只读 Graph 请求为最终验收；自动化回归仅作辅助证据。
