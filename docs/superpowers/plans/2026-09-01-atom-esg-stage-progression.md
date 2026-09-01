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
- **下一动作**：从 Task 2 Step 1 开始，为“当前槽例完成后自动迁窗”建立失败测试；不得重做 Task 1 或重新研讨已批准的阶段链。
- **明确未完成**：自动迁窗尚未实现；Web 的双击、支线贴边、CLI 后布局紊乱和 Shortcut 原地返回由 Web 空间规格记录，不属于本计划 Task 2 的顺手修复范围。

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

- [ ] **Step 1: Write the failing single-successor test**：在`tests/atom-agent-candidate-runtime.test.mjs`建立父级总控、当前槽例执行 Agent、完成触发和唯一下一槽例；断言完成提交后下一槽例可编辑且执行 Agent 的实际 Slot 路径迁入下一槽例。运行`node --test tests/atom-agent-candidate-runtime.test.mjs`，预期因尚未签发/消费受控迁窗授权而失败。
- [ ] **Step 2: Write the failing safety tests**：在`tests/atom-window-controlled-jump-authorization.test.mjs`覆盖授权缺失、目标仍锁定、签发方失权、Graph revision 变化及多个后项无唯一分派；断言执行 Agent 原位不动且一次性授权不能重放。运行该测试文件，预期新增场景失败且既有授权场景保持通过。
- [ ] **Step 3: Implement the minimal controller handoff**：给总控 Agent 的字面量函数授权增加`jump_authorize`，保持其他函数不变：

  ```python
  agent({"labels":["总控"],"functions":{"groups":[],"names":["agent","explore","jump_authorize","lock","transform","trigger"]}})
  ```

  完成 trigger 只在下一节点已经改成`🏃‍♀️`且候选目标唯一时，用`explore()`返回的三个 ThingCoordinate 签发授权：

  ```python
  EXECUTION_AGENT = "🧊manage/办包/究谋/个务/外务/职务·FDE/设计/研策/ESG计划/ESG计划总控Agent/✅原表守恒/执行Agent"
  NEXT_STAGE = "🧊manage/办包/究谋/个务/外务/职务·FDE/设计/研策/ESG计划/ESG计划总控Agent/🏃‍♀️活动建模"
  window = explore({"thing": EXECUTION_AGENT})[0]
  source = explore({"thing": EXECUTION_AGENT + "/迁窗注册"})[0]
  destination = explore({"thing": NEXT_STAGE})[0]
  jump_authorize({"window": window, "source": source, "destination": destination})
  ```

  `执行Agent`声明最小`explore`与`jump`能力；其`迁窗注册`只通过`when`检查唯一授权、通过`where`返回该授权坐标，并由既有 jump 事务消费。Program 不接收目标路径参数，不读取兄弟槽例正文，也不自行 Transform 目的地。
- [ ] **Step 4: Preserve partial-failure truth**：在`work-engine/atom-language/engine.mjs`和`program-runtime.mjs`保持完成事实与迁窗错误边界；迁窗失败不回滚已经独立提交的业务完成，不把目标误报为未解锁，也不移动执行 Agent。运行`node --test tests/atom-window-jump-transaction.test.mjs tests/atom-window-controlled-jump-authorization.test.mjs`，预期 0 failure。
- [ ] **Step 5: Run the isolated ESG journey**：在隔离世界创建单后项、分支多后项和汇合后项三种阶段；逐项完成并回读节点状态、锁、授权消耗和执行 Agent 实际路径，预期只有唯一已声明目标发生迁窗。
- [ ] **Step 6: Run adjacent and full regression**：运行`node --test tests/atom-agent-candidate-runtime.test.mjs tests/atom-window-controlled-jump-authorization.test.mjs tests/atom-window-jump-transaction.test.mjs tests/atom-language-transform-batch.test.mjs`，随后因该变化跨越 Program、权限和事务层运行`npm test`；两次均预期 0 failure。
- [ ] **Step 7: Update this recovery point and commit**：把实际 commit、测试数量、隔离旅程结果和下一未完成项写回“恢复断点”，提交`feat: hand off completed slot agents`；未经用户另行授权不把真实 ESG 阶段标成完成。
