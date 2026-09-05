# Generated Slot Print Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 一次性迁移已验证的旧内核生成 print Program，恢复当前自声明打印合同，完整保全业务与历史。

**Architecture:** 只读匹配当前 sealed layout与其生成源码，形成只改main调用退役body参数的候选；通过既有中央persistence、私密备份和CAS维护提交。日常slot_body ABI与Program执行器不增加旧参数兼容。

**Tech Stack:** Node.js标准库、现有slot Graph helpers、中央事务及普通Agent公开CLI。

**Spec:** `docs/superpowers/specs/2026-08-31-atom-world-program-design.md` §3.1/4.2；`docs/superpowers/specs/2026-08-31-atom-runtime-projection-recovery-design.md` §5.1。

## Global Constraints

- 当前版本只维护一个公开 ABI；旧 ABI 只能经授权维护迁移转换，不能作为永久兼容运行分支。
- 执行前生成可核验的私密数据备份、对象映射和候选 revision；敏感正文不进入公开仓库。
- 能原子完成的转换一次提交；无法无损转换时停止并报告精确对象，不留下新旧规则混用。
- 不改PRINT_PLAN快照、角色记录、修订、历史回执、普通Situation正文或用户业务拓扑。
- 不按“旧版本”等普通名称跳过；只有现行显式默认备份域停用语义才跳过。
- 本计划在来源提交分离后执行；状态仍只由唯一总账裁定，不插队实施。

## 依据与范围

- **已复现**：生产冷副本原print调用报INVALID_SLOT_BODY_EFFECT；仅去main的body参数成功，保留PRINT_PLAN内旧路径也成功。只读盘点5个生成print，实际业务路径不入Git。
- **实际定位**：`readVisibleSlotPlans`给出当前layout与修订plan；`printExample`按实际layout和相对roles打印，嵌套PRINT_PLAN中的body不是当前定位入口。
- **维护产出**：新增纯迁移planner与一个明确维护脚本；复用中央persistence，不重构现有部署工具，不复制整套旧部署脚本或增加通用迁移框架。

### Task 1: 严格识别并无损改写旧生成源码

**Files:**
- Create: `work-engine/atom-language/generated-slot-print-migration.mjs`
- Test: `tests/atom-generated-slot-print-migration.test.mjs`

**Interfaces:**
- Consumes: `readVisibleSlotPlans(atoms)`、`fieldValue/replaceStoredField`及原immutable世界。
- Produces: `planGeneratedSlotPrintMigration(facts)`返回 `{facts, expectedRevision, nextRevision, changedPaths, migrated, summary}`；不写磁盘、不执行Program。

- [ ] **Step 1: 来源守恒 RED**

合成sealed槽体使用真实当前seal生成结构，再把唯一生成main转换为旧`body`调用；header与修订保留。测试覆盖祖先已改名但header保留旧body、已是当前ABI、手写print、畸形生成源和显式默认备份域。

```js
const before = structuredClone(facts);
const plan = planGeneratedSlotPrintMigration(facts);
assert.deepEqual(facts, before);
assert.equal(plan.summary.migratedPrograms, 1);
assert.equal(currentPrintSource(plan.facts).split('\n')[0], currentPrintSource(before).split('\n')[0]);
assert.equal(currentPrintSource(plan.facts).split('\n').at(-1).includes('"body"'), false);
assert.deepEqual(withoutSelectedProgramSituation(plan.facts), withoutSelectedProgramSituation(before));
```

- [ ] **Step 2: Run RED**

Run: `node --test --test-isolation=none tests/atom-generated-slot-print-migration.test.mjs`。

- [ ] **Step 3: 实现精确生成物白名单**

先由当前sealed layout取print与last revision；只接受header为单个字面量`PRINT_PLAN = json_parse({"text": JSON_STRING})`，解析出的plan与当前修订plan结构相等，main恰为 `def main(arguments)` 返回一个slot_body字典。旧字典仅允许action=print、body为当前layout的精确字符串、name=arguments["name"]；有额外语句/计算/成员时拒绝该疑似生成物，绝不求值或猜写。

```text
PRINT_PLAN = json_parse(原字面量保持原字节)
def main(arguments):
    return slot_body({"action":"print","name":arguments["name"]})
```

可用严格三行生成模板与JSON字符串解析，无需通用Python解析器；手写非生成物不动，疑似生成但不满足模板时整个候选失败。只修改匹配节点Situation；layout/roles/revisions及其余Graph深比较必须相同。再调用现有Graph投影/校验，计算当前revision与候选revision。

- [ ] **Step 4: Run GREEN并提交**

同一focused命令通过；GitNexus impact/detect与diff检查后只提交planner和对应测试。

### Task 2: 私密备份、维护提交与冷入口验收

**Files:**
- Create: `scripts/deploy-generated-slot-print-world.mjs`
- Test: `tests/atom-generated-slot-print-migration.test.mjs`
- Modify: 本计划、唯一需求总账与既有恢复断点。

**Interfaces:**
- Consumes: Task1 planner，现有`resolveAtomRuntime`和`createTransactionalWorldPersistence`。
- Produces: `--dry-run --attempt ID`、`--apply --attempt ID`、`--rollback RECEIPT`；私密receipt绑定source/target revision、实际changedPaths、hash及中央command。

- [ ] **Step 1: 取得维护失败路径 RED**

使用测试私有runtime配置；预检不写世界，apply前源变化则CAS拒绝，重复attempt不再提交。备份不完整／校验失败时不提交；提交后必要后验失败以中央inverse patch恢复原来源，保留错误与所有产物。

```js
assert.deepEqual(sourceAfterFailedPreflight, sourceBefore);
assert.equal(secondApply.transaction.commandId, firstApply.transaction.commandId);
assert.deepEqual(worldAfterRollback, sourceBefore);
```

- [ ] **Step 2: 实现维护入口**

只使用配置的canonical runtime路径，拒绝linked ancestor；备份位于该私密世界的migration-backups/generated-slot-print/迁移ID/attempt。所有新文件wx，源atom逐字节hash复验；复制恢复所需原事实及journal资料，写清单。不以硬编码生产路径或私密正文入源码。复用中央commit/CAS/rollback；attempt回收先查中央receipt和私密清单，未知状态不盲重放。`--rollback`只接受绑定当前世界、精确source/target和中央command的可信receipt；拒绝覆盖后续业务修订。

- [ ] **Step 3: 真实副本与公开调用 GREEN**

当前生产世界只读副本预检应报告已核实生成物；若不再是5个，依据当前事实报告变化，不能强制数量。迁移后在同一副本，以普通Agent调用实际print并回读槽例，随后冷重启再调用；迁移／打印／回滚的源文件hash不变。当前ABI对手写显式body仍拒绝。

- [ ] **Step 4: 部署维护与回告**

focused测试及独立复核通过后集成维护工具；使用受控现有服务入口执行维护切换，私密dry-run结果具体可核对后apply。生产不新建验收槽例；重启公开读取所有被迁移print及其角色/修订一致性，真实打印行为由同世界副本公开链证明。回告提出方无需重做业务改名，继续既有A Task5—7。手机连接恢复优先验收；不push、不删除备份。

## 自审与执行状态

- **覆盖**：Task1精确识别／守恒／拒绝；Task2备份／幂等／CAS／rollback／冷公开调用／生产回读。
- **接口一致**：planner产出的facts/revisions/changedPaths被唯一中央维护提交消费。
- **状态**：仅计划，未派发、未实现、未改变生产；不得把计划或5个盘点数当作迁移成功。
