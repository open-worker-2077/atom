# Strut Receiver-Owned Trigger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 退役Strut Trigger的`nodes`，使Graph clause唯一决定后项，只有实际后项本身的Program决定是否响应typed true delivery。

**Architecture:** 普通Graph中，`trigger("strut", {}, receive)`只索引声明Program自己的exact path；delivery的`consequentPath`与Program path相同才运行。槽体中，推支后项必须是采用修订中的Program角色，运行时由实例后项角色映射到同一槽模共享Program。一次性迁移把旧`nodes`绑定改写为显式Graph后项并改写Program源码；新运行时稳定拒绝旧合同，不保留双轨。

**Tech Stack:** Node.js 24、Python AST、Atom Program worker、Node test runner、中央世界迁移脚本。

**Spec:** `docs/superpowers/specs/2026-09-03-atom-slot-signal-design.md` §5

## Global Constraints

- Graph clause决定后项；Program不得声明、筛选或推测接收节点。
- Strut判定仍只在`if.program`内返回strict bool；接收Program只消费typed true delivery。
- 新语法固定为`trigger("strut", {}, receive)`；`nodes`稳定拒绝，不兼容双轨。
- 普通Graph只有当`delivery.consequentPath === program.path`时运行该Program。
- 槽体只有当实例后项角色本身是Program角色时，才映射到同一槽模共享Program。
- 迁移零删除、零直接编辑backing JSON；迁移计划绑定源revision，预检、备份、中央原子提交、重启回读缺一不可。
- 不改变Transform Trigger、Slot Trigger、delivery结构、claim、失败回滚或权限合同。
- 按[`../minimality-checkpoints.md`](../minimality-checkpoints.md)执行从属最小化检查：复用现有迁移与事务组件，不引入常驻 Hook、第二套框架或兼容双轨；安全迁移链不得因压缩代码而删减。

---

### Task 1: Program合同与普通Graph索引

**Files:**
- Modify: `tests/atom-program-runtime-scheduling.test.mjs`
- Modify: `work-engine/atom-language/program-worker.py`
- Modify: `work-engine/atom-language/program-runtime.mjs`

**Interfaces:**
- Consumes: `trigger("strut", {}, receive)`和`delivery.consequentPath`。
- Produces: `contract={mode:"strut",parameters:{},entrypoint}`；`triggerIndex["strut\0" + program.path]`。

- [ ] **Step 1: Write failing contract tests**：把一个Program自身作为Strut后项，断言`{}`会接收一次delivery；加入另一个未作为后项的Program，断言不运行；断言旧`{"nodes":[...]}`返回合同校验失败。
- [ ] **Step 2: Run RED**：运行`node --test --test-name-pattern="receiver-owned|rejects strut nodes" tests/atom-program-runtime-scheduling.test.mjs`，确认失败来自当前worker仍要求`nodes`和索引仍绑定参数节点。
- [ ] **Step 3: Implement minimal worker contract**：在`extract_trigger_contract()`中仅允许Strut空对象参数，保留单delivery形参校验，并返回空`parameters`。
- [ ] **Step 4: Implement receiver-owned index**：`setTriggerContract/removeTriggerContract/backfillTriggerIndexForEvent`对Strut统一使用Program自身path；普通delivery只查询`strut\0${consequentPath}`，不读取参数节点。
- [ ] **Step 5: Run GREEN**：重复Step 2并运行完整`tests/atom-program-runtime-scheduling.test.mjs`。
- [ ] **Step 6: Commit**：提交`feat(program): make strut triggers receiver-owned`。

### Task 2: 槽体共享Program后项

**Files:**
- Modify: `tests/atom-slot-body-plan-integration.test.mjs`
- Modify: `tests/atom-slot-strut-lock-acceptance.test.mjs`
- Modify: `work-engine/atom-language/slot-body-plan-runtime.mjs`

**Interfaces:**
- Consumes: 实例Strut delivery的`consequentPath`、采用修订角色和槽模共享Program角色。
- Produces: 仅后项Program角色对应的`{programPath,scopeRoot,revision,eventPath}`调用。

- [ ] **Step 1: Write failing slot tests**：把测试槽模的Strut后项改为`计算`或`接棒`Program角色、Trigger改为空参数；证明当前实例运行、兄弟实例不运行、普通事实后项不唤醒任意共享Program。
- [ ] **Step 2: Run RED**：运行两个槽体测试文件的receiver-owned用例，确认失败来自运行时仍用`contract.parameters.nodes`筛选来源角色。
- [ ] **Step 3: Implement minimal role mapping**：Strut事件先解析实例`consequentPath`为采用修订角色；仅当该角色`kind === "program"`时映射其role path到槽模Program，忽略其他Program角色；Transform事件继续保留既有`nodes`合同。
- [ ] **Step 4: Run GREEN**：运行槽体两个测试文件，确认锁、claim、回滚、重试和re-seal行为保持。
- [ ] **Step 5: Commit**：提交`feat(slot): dispatch strut to consequent program roles`。

### Task 3: 一次性世界迁移

**Files:**
- Create: `work-engine/atom-language/strut-receiver-migration.mjs`
- Create: `work-engine/atom-language/program-strut-trigger-migration.py`
- Create: `scripts/deploy-strut-receiver-world.mjs`
- Create: `tests/atom-strut-receiver-migration.test.mjs`

**Interfaces:**
- Consumes: 当前世界facts、旧Program literal `trigger("strut", {"nodes":[...]}, fn)`及引用这些node的Strut clauses。
- Produces: revision-bound migration plan、改写为`trigger("strut", {}, fn)`的Program源码、显式指向Program path的Graph后项、备份与原子部署回执。

- [ ] **Step 1: Write failing planner tests**：覆盖唯一旧node到唯一Program、同一node多个Program扩为多个显式后项、相对槽角色、归档Program跳过、无对应clause与动态参数稳定阻断、源facts不被修改。
- [ ] **Step 2: Run RED**：运行`node --test tests/atom-strut-receiver-migration.test.mjs`，确认模块缺失。
- [ ] **Step 3: Implement AST source rewrite**：Python只接受顶层literal Strut Trigger，输出旧nodes、entrypoint和`{}`改写源码；不以正则改Python。
- [ ] **Step 4: Implement pure migration plan**：索引活跃Program与Strut后项，把每个旧node对应的delivery后项替换/扩展为订阅Program exact path；保持ordinal、if、普通未订阅后项和归档子树；重新投影并计算expected/next revision。
- [ ] **Step 5: Implement guarded deploy script**：复用现有inline-strut部署模式，执行预检、revision复验、世界目录备份、中央原子替换、投影恢复与回读；任何阻断不写事实。
- [ ] **Step 6: Run GREEN**：运行迁移测试及现有migration/Graph投影相关测试。
- [ ] **Step 7: Commit**：提交`feat(migration): convert strut subscriptions to graph endpoints`。

### Task 4: 全仓合同迁移与验收

**Files:**
- Modify: `tests/atom-inline-strut-transform-e2e.test.mjs`
- Modify: all remaining active test fixtures containing `trigger("strut", {"nodes":...})`
- Modify: `work-engine/atom-language/cli.mjs`
- Modify: `docs/superpowers/README.md`
- Modify: `docs/superpowers/plans/2026-09-03-session-recovery-checkpoint.md`

**Interfaces:**
- Consumes: Tasks 1—3单轨合同。
- Produces: 零旧Strut Trigger合同、Help与运行时一致、可部署提交。

- [ ] **Step 1: Migrate fixtures by behavior**：每个测试Graph把实际接收Program设为then后项；不做机械字符串替换，不把无关普通事实继续当隐式接收端。
- [ ] **Step 2: Update Help**：公开`trigger("strut", {}, main)`，明确Graph后项必须是接收Program；delivery结构保持不变。
- [ ] **Step 3: Verify affected chain**：运行Program scheduling、inline Strut、Slot body、Strut lock、Slot signal与迁移测试。
- [ ] **Step 4: Verify system**：运行`npm run test:system`；随后运行`npm test`、Python AST、Node syntax和`git diff --check`。
- [ ] **Step 5: Preflight real world**：只读运行部署脚本preflight，记录活跃旧订阅数量、将改写的Program和Graph clauses；不提交生产世界。
- [ ] **Step 6: Update Superpowers**：记录提交、测试、preflight与精确部署顺序；未实际部署前不得标记生产完成。
- [ ] **Step 7: Commit**：提交`docs(superpowers): record strut receiver migration proof`。
