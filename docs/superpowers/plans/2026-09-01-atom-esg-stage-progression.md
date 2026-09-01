# Atom ESG Stage Progression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 ESG 阶段按 Strut 前置条件安全解锁，并在当前槽例完成后把执行 Agent 迁入唯一的下一槽例。

**Architecture:** `ESG计划总控Agent`作为阶段节点的上级窗口，持有`总控`业务标签并通过 Transform trigger 对账阶段状态。业务锁由独立 literal-path Program 声明；后续迁窗复用官方`jump_authorize()`和`jump()`，不把路径字符串或 Shortcut 当作迁移权限。

**Tech Stack:** Node.js 24、ES modules、Python Program worker、Node test runner、Atom CLI、Graph-JSON。

**Spec:** `docs/superpowers/specs/2026-09-01-atom-esg-stage-progression-design.md`

## Global Constraints

- 真实业务完成只能由用户事实触发；测试不得把真实节点伪装为`✅`。
- Agent 窗口锁、槽体结构锁和业务 Program 锁保持三类独立合同。
- 上级向下授权，禁止下级向上或跨兄弟窗口直接 Transform。
- Program 路径、Strut 端点和触发索引在改名时统一维护。
- 不直接编辑 Atom backing JSON；真实世界只通过官方 CLI 与运行时事务操作。
- 每个未完成代码任务先取得 RED，再实现 GREEN，并绑定当前 revision 的验证证据。

---

## 恢复断点

- **Task 1 实现版本**：`d580d8cf4d9724740d500725df5e6071b53b1ebe`；恢复时用`git merge-base --is-ancestor d580d8c HEAD`确认当前代码仍包含该实现，不假定文档提交后的 HEAD 等于该 revision。
- **已完成**：Task 1 的触发 Agent 身份、业务锁解锁、引用维护、阶段改名和全链隔离演练。
- **真实状态**：4784 中`🏃‍♀️原表守恒`未加业务锁；抽查`⌛️🔒活动建模`、`⌛️🔒完成映射`和`⌛️🔒总装成件`均由`总控`锁定；普通写入返回`GRAPH_LOCK_DENIED`。
- **恢复备份**：部署前世界文件位于桌面`AtomGraph-backups/esg-chain-before-deploy-20260901-1725`；备份位置只用于本机恢复，不进入产品运行逻辑。
- **Task 2 隔离工作区**：`D:\Project\〇\subprojects\atom\.worktrees\esg-auto-jump`，分支`feature/esg-auto-jump`，起点`5e09d9e`；不得在正在运行 4784 的主工作区直接试改。
- **改动前基线**：全量`1585/1586`；唯一既有失败为`spatial-cluster-field`的“tenfold adaptive compactness”性能门槛，单独重跑仍失败（约 1400ms），与迁窗链无关并已归入 Web 布局问题。
- **Task 2 RED/GREEN**：初始 RED 证明触发归并漏掉`jump_authorize`与`jump`；实现后仅在完整复验签发方、窗口、source、destination 及 Graph 世代后，以同轮新签授权唤醒内嵌执行 Agent，并在迁窗后消费授权。歧义后继保留业务事实、窗口原位且不留授权；首次`when=False`保留的同一授权在条件修复后可重新唤醒注册并被消费。
- **连续链修正**：五阶段隔离验收先后暴露“单 Program 多 trigger 非法”“监听🏃‍♀️会自级联”“固定历史路径会被官方路径重写带走”“全邻接不等于有向后继”四个问题；最终总控只监听✅结果，从唯一执行 Agent 上钻当前槽例，读取该槽例自身`strut.then`的唯一后继，一次只推进一步。
- **性能根因**：两项 4784 大世界门槛在未改动`main`也波动失败；CPU profile 定位到`parseAtomKey`每次解析都重建默认 matcher/action registry。模块级复用默认只读注册表后，Program effect apply 从约 1.8—2.8s 降到约 0.49—0.65s；完整测试中的两项总耗时约 2.81s/3.43s，低于 4s/5s 门槛。
- **当前验证**：邻接权限/事务/批量回归`67/67`；最终完整`npm test`为`1590/1590`、0 failure，包含五阶段线性 Strut 链连续四次完成与迁窗、授权重试及多后继歧义拒绝；最终无授权和业务锁残留。语法检查与`git diff --check`通过。
- **Task 2 实现提交**：`fe8ad8f`（`feat: hand off completed slot agents`）；真实 4784 ESG 世界事实未被测试或实现过程改写。
- **下一动作**：提交功能分支，集成到`main`后复验并推送`origin/main`；不得改动真实 ESG 完成事实。
- **范围外记录**：Web 的双击目标错位、支线未贴边、CLI 交互后布局紊乱和 Shortcut 原地返回由 Web 空间规格记录，不属于 Task 2 的顺手修复范围。

### Task 1: 总控业务锁与阶段推进

**Files:**
- Modify: `work-engine/atom-language/program-runtime.mjs`
- Modify: `work-engine/atom-language/engine.mjs`
- Modify: `work-engine/atom-language/transform-executor.mjs`
- Test: `tests/atom-agent-candidate-runtime.test.mjs`
- Test: `tests/atom-language-transform-batch.test.mjs`
- Test: `tests/atom-language-transform-p2.test.mjs`
- Test: `tests/atom-program-shortcut.test.mjs`

**Interfaces:**
- Produces: triggered Agent Program 自有窗口/标签授权、普通 Program 非继承边界、锁定后项的授权引用维护，以及改名后的 Program literal path 与 trigger 索引更新。

- [x] **Step 1: Write the failing tests**：增加 context-free Agent 正向用例、普通 Program 非继承标签反向用例、阶段完成后解锁用例、锁定后项 Strut 引用维护用例及单项/批量改名路径重写用例。
- [x] **Step 2: Run tests to verify they fail**：运行相关 Node 测试，确认失败来自触发执行身份、业务锁反向阻断和 Program 路径未重写，而不是标签比较或`^`算法。
- [x] **Step 3: Write minimal implementation**：让触发 Agent 使用自身安全上下文；普通 Program 保持发起上下文；把授权引用维护视为内核完整性操作；改名统一更新 Program 字面量与触发路径。
- [x] **Step 4: Run focused and full verification**：相关回归`125/125`通过；`npm test`在提交`d580d8c`上`1586/1586`通过；隔离世界完成从原表守恒到总装成件的完整链。
- [x] **Step 5: Deploy and verify the real initial state**：部署到真实 4784，创建`ESG计划总控Agent`与七个业务锁声明，回读初态并以拒绝写验证等待节点，未改变真实完成事实。
- [x] **Step 6: Commit and push**：提交`d580d8c fix: advance locked strut stages safely`并确认`origin/main`一致。

### Task 2: 完成槽例后的受控自动迁窗

**Files:**
- Modify: `work-engine/atom-language/engine.mjs`
- Modify: `work-engine/atom-language/program-runtime.mjs`
- Modify through Atom CLI: `🧊manage/办包/究谋/个务/外务/职务·FDE/设计/研策/ESG计划/ESG计划总控Agent`
- Create through Atom CLI: `🧊manage/办包/究谋/个务/外务/职务·FDE/设计/研策/ESG计划/ESG计划总控Agent/🏃‍♀️原表守恒/执行Agent`
- Test: `tests/atom-agent-candidate-runtime.test.mjs`
- Test: `tests/atom-window-controlled-jump-authorization.test.mjs`
- Test: `tests/atom-window-jump-transaction.test.mjs`

**Interfaces:**
- Consumes: Task 1 已提交的阶段完成 trigger、`总控`标签和下一阶段解锁结果；现有`jump_authorize({window,source,destination})`一次性授权合同。
- Produces: `完成当前槽例 → 解锁下一槽例 → 签发授权 → 执行 Agent 消费授权并迁窗`的可恢复事务序列。

- [x] **Step 1: Write the failing single-successor test**：在`tests/atom-agent-candidate-runtime.test.mjs`建立父级总控、当前槽例执行 Agent、完成触发和唯一下一槽例；断言完成提交后下一槽例可编辑且执行 Agent 的实际 Slot 路径迁入下一槽例。定向测试按预期失败：下一槽例已激活且解锁，但执行 Agent 未迁移。
- [x] **Step 2: Write the failing safety tests**：新增多后继歧义触发测试，既有授权套件继续覆盖授权缺失、目标锁定、签发方失权、Graph revision 变化、提交拒绝和重放；歧义场景保留业务事实、窗口原位、不留授权并返回`WINDOW_JUMP_AUTHORIZATION_CONFLICT`。
- [x] **Step 3: Implement the minimal controller handoff**：给总控 Agent 的字面量函数授权增加`jump_authorize`，保持其他函数不变：

  ```python
  agent({"labels":["总控"],"functions":{"groups":[],"names":["agent","explore","jump_authorize","lock","transform","trigger"]}})
  ```

  完成 trigger 只监听`✅`结果；回调从唯一执行 Agent 上钻当前槽例，并从当前槽例自身的`strut.then`读取唯一后继。它先解除后继业务锁、把后继改为`🏃‍♀️`，再用`explore()`返回的三个 ThingCoordinate 签发授权。不得按次数建立历史路径分支：

  ```python
  window = explore({"thing": "执行"})[0]
  source = explore({"thing": "迁窗注册"})[0]
  current = [item for item in explore({"thing": window.path, "slot$latitude+1": True)
             if item.path != window.path][0]
  owner = [item for item in explore({"thing": current.path, "strut": True)
           if item.path == current.path][0]
  destination = explore({"thing": owner.strut[0]["then"][0]["thing"]})[0]
  jump_authorize({"window": window, "source": source, "destination": destination})
  ```

  `执行Agent`声明最小`explore`与`jump`能力；其`迁窗注册`只通过`when`检查唯一授权、通过`where`返回该授权坐标，并由既有 jump 事务消费。Program 不接收目标路径参数，不读取兄弟槽例正文，也不自行 Transform 目的地。
- [x] **Step 4: Preserve partial-failure truth**：触发签发或迁窗失败作为明确 warning 保留业务变更；歧义签发不产生半项授权，迁窗失败保留执行 Agent 原位和可复验授权。相邻权限、事务和批量改名回归`56/56`通过。
- [x] **Step 5: Run the isolated ESG journey**：五阶段线性 Strut 链连续完成四个当前阶段；每次仅唯一后继变为🏃‍♀️，执行 Agent 迁入该槽例，旧槽例不再包含执行 Agent，授权即时消费；另有多后继歧义测试确认不猜测、不迁窗、不留授权。
- [x] **Step 6: Run adjacent and full regression**：邻接套件`67/67`；最终完整`npm test`为`1590/1590`、0 failure，性能门槛恢复稳定余量，并覆盖五阶段连续迁窗和保留授权重试。
- [x] **Step 7: Update this recovery point and commit**：实现提交`fe8ad8f`；最终完整回归`1590/1590`，隔离五阶段旅程连续四次迁窗通过；真实 ESG 阶段未被标成完成。
