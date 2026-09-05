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
- 单项验证后按已授权范围集成部署并回写证据。当前本地交付文档包含不适合公开的运行记录，公开推送已被自动审批拒绝；不得无审查推送其后续 ancestry，代码备份与私有运行证据分开处理。

## 当前断点（2026-09-06）

Task7保存可见反馈优先实施，I0/U0/D1/E3；移动已交付，手机共同配置Task2暂停于RED，待本项交付后续接。旧Task1—4/6已交付，不重做。Task5仍须区分历史连通证据、用户后来已连上与当前真机验收缺口。

## 历史恢复断点（不覆盖当前总账）

- **当前分支**：`main`；以仓库当前 checkout 和远端提交为准，不再沿用历史隔离分支名称判断状态。
- **已完成代码**：ASDF 双击与 Strut 边界修复均已推送；CLI 新 revision 现先拉齐当前路径和全部展开路径，再把同一 revision 原子导入场景。Shortcut 历史路线补载代码仍在，但现场完整激活已重新判为未完成。
- **当前证据**：Task 4 桥接合同`29/29`、CLI 相关真实浏览器旅程`3/3`、完整回归`1592/1592`均通过并已推送。2026-09-02 再次现场确认 4784/4785/4786 均监听，Tailscale Serve 仍把 HTTPS 域名代理到 4785；使用域名与指定 Tailnet IP 请求根路径返回 200，`pixel-10a`可被 Tailscale peer ping 通。电脑访问 4786 返回 403，符合仅允许手机 IP 的白名单合同。用户手机仍报告域名无法打开，剩余首个未证实边界仍是手机 DNS/浏览器入口。
- **Task 1 实现提交**：`89a879a`（`fix(web): load remote shortcut routes`）。
- **Task 2 实现提交**：`9a61ff2`（`fix(web): keep ASDF double-click on deepest target`）。
- **Task 3 安全回退提交**：`83f63f1`（`fix(web): attach strut endpoints to visible boundaries`）。
- **Task 4 实现提交**：`67a2fd0`（`fix(web): refresh expanded scopes atomically`）。
- **下一动作**：Shortcut 深层真实激活已收口；手机正式入口继续保持未完成，电脑不能代替手机观察其 DNS 选择与浏览器结果。
- **仍未完成**：手机端最终读取验收。

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
- [x] **Step 5: Reproduce the reopened real activation failure**：真实投影确认`ESG计划快捷入口/ESG计划总控Agent`具有有效`shortcutTargetPath`；A 模式 RED 证明`enterNode()`在解析 Shortcut 前先走本地`toggleClusterChildDomain()`，结果停留在入口域而非目标路径。
- [x] **Step 6: Fix and reverify the complete user journey**：Shortcut 在球域分支前识别并退出球域，再复用既有 linked route；普通 Shortcut、未访问深层、A 模式、坏链保持和渐进远端路线 Playwright 5/5，全量回归 1596/1596。实现提交`2048887`。真实 4784 revision 7222 中，`ESG计划总控Agent`从入口路径跳至 linked target 的实际深层路径，前后 revision 不变。

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

- [x] **Step 1: Reproduce RED**：桥接合同令当前视图包含一个展开子域，SSE 升级 revision 后断言当前路径和展开路径一次性导入；旧实现只请求当前路径，RED 精确落在缺失的展开 scope。
- [x] **Step 2: Locate replacement boundary**：`pullKnowledge()`遇到新 revision 会清空`loadedPaths/lastKnowledge`并立即导入单个当前 scope，旧展开描述与不完整新投影因此混帧；首个断点位于 scoped refresh，而非相机代码。
- [x] **Step 3: Preserve the complete active route**：以`exportField()`中的当前路径和`expandedPaths`构造活动路线；所有 scope 必须属于同一 revision 才合并并只导入一次，revision 竞态则拒绝半批次。
- [x] **Step 4: Verify and commit**：桥接合同`29/29`、CLI 相关真实浏览器旅程`3/3`、完整回归`1592/1592`；实现提交为`67a2fd0`，待快进推送`main`。

### Task 5: 手机私网域名现场连通

**现场证据：** 2026-09-01 用户从手机访问`worker.tail33a2eb.ts.net`仍然无法打开。现有私有网关、身份白名单、POST/SSE、等待页和 4784 隔离单测通过，只证明代码合同，不证明真实手机、Tailscale DNS、证书、监听和任务进程组成的现场链路已通。

- [x] **Step 1: Reproduce from the real boundary**：4784 health、4785 身份网关任务、Serve HTTPS 根路径/health、手机 peer 与对等 ping 均通过；公网/系统 DNS 对私有名称返回 NXDOMAIN，Tailscale 内部 DNS query 返回`100.116.206.105`。
- [x] **Step 2: Locate the first broken hop**：服务端 TLS、Serve、4785、4784及手机对等链路均通；剩余首个未证实边界是手机是否把`*.ts.net`交给 Tailscale 内部 DNS，而非 Android Private DNS/浏览器安全 DNS。
- [x] **Step 3: Keep the diagnostic probe isolated**：诊断网关任务 Running，监听`100.116.206.105:4786`且只批准手机`100.102.183.62`；电脑来源访问返回 403，证明未放宽白名单。该探针不是用户入口，正式合同始终是 HTTPS 域名。
- [x] **Step 3.1: Repair host MagicDNS adoption**：2026-09-03确认tailnet MagicDNS开启、内部查询正确，但本机Tailscale DNS偏好关闭；启用`accept-dns`后系统解析正式域名成功，统一HTTPS health返回200、revision 7270。服务端统一入口已闭环。
- [ ] **Step 4: Verify on phone**：以用户手机成功打开并完成一次只读 Graph 请求为最终验收；自动化回归仅作辅助证据。

### Task 6: Shortcut 语义改向

- [x] **Step 1: Core RED**：`thing.lnk`原实现返回`UNKNOWN_GRAPH_FIELD`；Web 草稿暴露合同 JSON，translator仍生成`situation.rep`。
- [x] **Step 2: One semantic Transform**：新增`thing.lnk.EXACT_TARGET`，只改 Shortcut自身；新目标复用Graph精确消歧和读取鉴权，内部reference identity保持，普通Thing稳定拒绝。
- [x] **Step 3: Structured Web editor**：Shortcut编辑草稿只带`shortcutTargetPath`；编辑器显示名称和目标路径，隐藏Markdown、附件和内核合同JSON；Web提交同一Transform，支持原子改名+改向。
- [x] **Step 4: Minimal affected verification and deploy**：内核、Help、投影、translator、workspace、editor、bridge与静态合同`215/215 PASS`；Shortcut真实Chromium导航`5/5 PASS`；browser build与development-control通过。实现`a48f33f`已推送`origin/main`；真实4784为revision`7270`、投影`published`、build`sha256-7ba5295f501e0740`。

### Task 7: 保存可见反馈

**Spec:** Web §3.1；用户纠正此项是既有缺陷，不是新需求。点击保存后显示非阻塞提示框，目标5秒内至少有反应；不要求提交5秒内完成。

**Files:** spatial-engine.js、index.html、spatial.css；聚焦 tests/browser/save-feedback.spec.mjs；必要时 spatial-browser-bridge.js 与既有 editor/bridge 合同测试。

**Interfaces:** 复用 spatial-workspace-committed、persisted、projection-pending、persist-failed 与 persistenceId。现有 announce 仅写入 sr-only ariaLive，普通画面不可见。保存开始立即显示“正在保存”，随后真实回执驱动成功/失败/事实已保存但投影待恢复；旧回执不得覆盖更新的保存状态。维持读屏反馈，不把全部导航公告都变成屏幕弹窗。

- [x] **Step 1: RED**：真实浏览器点保存，受控延迟持久化响应，断言可见进行中提示（5秒目标），再验证成功/失败/投影待恢复状态；旧版本应因不可见失败。真实 Chromium RED `3/3 failed`，均为`#saveStatus`在4.5秒内不存在；截图、error-context与trace保存于Task7专属artifacts。
- [x] **Step 2: Minimal GREEN**：增加可见非阻塞状态框，复用原持久化事件和编号；不改服务器、Graph、权限、提交或后续运行语义。移动成功、桌面失败、投影待恢复/旧回执隔离已分别`1/1 PASS`；首轮GREEN暴露的成功响应和过期回执测试夹具错位已限于测试修正，未扩改产品语义。
- [ ] **Step 3: Verify**：聚焦浏览器及编辑/桥接受影响链；build与既有开发控制门禁；最终候选全量一次，原revision证据不重复运行。独立任务与整分支审查。
- [ ] **Step 4: Deliver**：仅已审查候选受控部署，公共入口回读实际静态资源，浏览器确认可见提示；保全生产快照、私有证据、既有功能与测试产物。随后原手机Task2从RED继续。

- **已恢复断点（2026-09-05）**：用户完成软件更新后明确“继续”；已核对保留的Task7报告、RED/GREEN产物和未提交产品diff，不重跑RED或三条已有效定向测试。当前从同一次聚焦Playwright合并运行继续；通过后依次执行编辑/桥接、build、development-control、`detect_changes`与最终全量一次。
- **恢复后聚焦进度**：首次合并运行`2 passed / 1 timed out`；投影用例已看到正确可见正文，之后在同元素`data-state="pending"`断言前撞到30秒用例总时限。该用例单跑26.0秒已通过；只将受控慢回执用例预算提高至60秒，产品diff不变。
- **聚焦候选证据**：同revision合并运行中移动成功与桌面失败`2/2 PASS`，60秒预算修订后投影待恢复/旧回执隔离定向`1/1 PASS`（31.9秒）；5秒内可见反馈断言未放宽。根据验证复用规则不再重跑已通过的前两条，现进入编辑/桥接受影响链。
- **受影响链证据**：`editor-ui`、`editor-engine`、`spatial-workspace-model`与`browser-bridge`合同`120/120 PASS`；`npm run build:browser`与`npm run check:development-control`均退出0。当前准备`detect_changes`与阶段提交固定候选，随后仅运行一次最终全量。
- **变更影响回读**：GitNexus `detect_changes(scope: staged)`在显式worktree上返回medium：5个文件、6个已索引符号、1条`ExecuteDemoEditing → ExportKnowledge`流程。索引仍存在63 commits陈旧限制；结合缓存diff与120条受影响合同审核，未把空流程当作无风险证据。
- **审查回修**：任务级审查发现`human-status`成功分支缺少`spatial-workspace-persisted`回执，会使可见状态停留在“正在保存”。旧候选全量在连续通过输出中主动终止，不计产品失败；bridge VM合同先以事件数`0 !== 1`取得RED，再补同一`persistenceId`、`operation`和最新`knowledge`回执，定向`1/1 PASS`，失败与投影待恢复仍只发各自原回执。
