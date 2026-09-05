# Transform Post-commit Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 合法来源 Transform 先原子提交，后续 Program 运行失败不撤销或否定该来源；既有触发、权限、局部性与恢复需求继续成立。

**Architecture:** 复用现有中央事务、reconcileProgramsForWorld 和提交后收尾入口；将来源事实与随后产生的 effects 拆开提交。来源回执保存可追踪事件，后续运行采用自己的读取修订与结果；不新增业务队列、第二世界权威或永久双轨开关。

**Tech Stack:** Node.js、现行 Python Program worker、中央 JSON 增量事务日志、Node test runner、公开 CLI/HTTP。

**Spec:** `docs/superpowers/specs/2026-08-31-atom-runtime-projection-recovery-design.md` §2、§4、§5；`docs/superpowers/specs/2026-08-31-atom-world-program-design.md` §3。

## Global Constraints

- 普通事实改造的后续业务触发不成为合法来源提交的前置条件。
- 来源Transform与后续Program effects都复用中央事务入口；各自事务的事实、锁变更和可逆记录原子裁定。
- Program异常不发布该次运行尚未提交的effects；此前已提交的来源事实保持成立。
- 同一操作重试复用中央回执；不得产生第二次业务提交或重复触发 Program。
- 只调度精确命中的 Program/订阅，不扫描和执行无关世界 Program。
- 不关闭Trigger、Strut、阶段接棒；不恢复旧ABI，不改业务世界正文来规避代码缺陷。
- 不推送；生产验收使用私有副本，部署复用既有 Atom Graph Runtime，来源业务任务自行完成业务改造。

## 已核对的边界与裁定

| 对象 | 权威与现有入口 | 本次作用 |
|---|---|---|
| 来源事实 | engine apply/validate → commitChangedGraph → 中央 CAS | 首先验证并提交；拒绝仍为零来源提交 |
| 后续局部作用 | reconcileProgramsForWorld → Scheduler/worker → effects | 消费已提交来源事件；后续失败只影响尚未提交的 effects |
| 提交证明 | transactional-world-persistence / 原增量 journal | 保持来源 command/revision，补充关联运行结果，不以诊断日志替代提交证明 |
| 展示 | interaction-runtime → Graph/Spatial publish | 只投影已提交修订；初始来源回执和最终后续结果不混淆 |

- **当前证据**：普通单笔 engine:3776 在 commit:3826 前 reconcile；旧 `atom-slot-strut-lock-acceptance.test.mjs` 的订阅失败和 effect拒绝测试明确期望 Source=before。这是待替换旧合同，并非当前需求已通过。
- **复用裁定**：既有后续调度批次内部的 effects 原子性继续保留；本次不因拆开来源而额外引入逐订阅独立提交的产品规则。每个 Program 不得留下半份 effects，批次失败也不撤销来源。
- **显式调用**：`.run.` / `use_program` 本身以运行并提交其 effects 为用户意图，该次 effects 的合法性仍决定该调用成败；不能把显式调用错误一律改成来源成功。由该次效果产生的后续触发沿相同提交边界处理。
- **无变化动作**：现行可编程 Transform 动作仍可触发；不引入旧值/新值判断、once_per_revision 或“没有事实变化就不触发”。没有来源世界变更时不伪造一次世界提交。
- **恢复裁定**：现有 claims 是内存Map，单纯移动调用位置不能证明冷重启恢复。持久触发依据、结果关联及冲突后不写旧快照必须实测；若代码需要 journal 扩展，保持旧 prepared/committed 记录可读并提供回退证据。
- **优先级**：I3/U3/D3/E3；手机连接恢复即优先真实验收。A Task 4 已保存，Task 5—7续点保留；本项后处理5个旧生成print迁移。

---

### Task 1: 来源与后续 effects 的实际提交分离

**Files:**
- Modify: `work-engine/atom-language/engine.mjs`
- Modify: `src/atom-system/adapters/legacy-engine-adapter.mjs`
- Test: `tests/atom-slot-strut-lock-acceptance.test.mjs`
- Test: `tests/atom-transform-postcommit-boundary.test.mjs` (new)

**Interfaces:**
- Consumes: 现有 `applyTransform`、`validatePrograms`、`validateRequestCandidate`、`commitChangedGraph`、`reconcileProgramsForWorld` 和中央 commit receipt。
- Produces: `result.subsequentExecution`，结构 `{ status: 'completed' | 'failed', sourceRevision, revisionAfter, errors: [] }`；顶层 `ok/changed/revisionAfter`如实描述来源与最终已提交世界。后续失败必须有原错误 code/details，顶层来源成功不可改为失败。

- [ ] **Step 1: 取得真实来源守恒 RED**

沿既有 failing subscriber fixture，将旧三项验收改为来源=after；effects拒绝时Result仍before。测试不stub中央持久化；保留私有临时目录。

```js
assert.equal(result.ok, true, JSON.stringify(result));
assert.equal(find(stored, 'Source').situation, 'after');
assert.equal(result.subsequentExecution.status, 'failed');
assert.ok(result.subsequentExecution.errors.some(error => error.code === 'ATOM_PROGRAM_FAILED'));
```

新增多effects Program：先改合法Result、再改Missing；断言来源提交、Result仍before。新增来源本身无权限／四轴非法反例：来源不变、订阅未执行。新增直接`.run.`失败仍失败的区别证据。

- [ ] **Step 2: 运行最小 RED**

Run: `node --test --test-isolation=none tests/atom-transform-postcommit-boundary.test.mjs tests/atom-slot-strut-lock-acceptance.test.mjs`

Expected: 新来源守恒断言失败；基础设施无法spawn不计RED。

- [ ] **Step 3: 在原入口分开提交**

单笔、batch、create、restore逐一核对来源apply/validate和后续reconcile的次序；合法来源先调用中央提交，随后运行现有局部事件。给 `commitChangedGraph` 增加可选 `expectedRevision` 与 `correlationId`，默认行为保持现有调用者；后续提交显式使用来源提交后的revision，禁止继续以request-start revision提交。Adapter不得用父interaction id覆盖明确的子运行关联。累计所有真实已提交affectedPaths。

```js
const sourceReceipt = await commitChangedGraph(sourceAtoms, sourceCommitOptions);
// sourceReceipt.authorizationFailure 仍直接拒绝来源。
// 已提交之后，后续候选单独验证、单独CAS；失败只形成 subsequentExecution。
const subsequentExecution = { status: 'failed', sourceRevision, revisionAfter: sourceRevision, errors: [failure] };
```

该示意定义次序和回执，不授权加入第二调度器。来源变更回执应在后续worker阻塞前可通知 `onCommitted`；返回给已有调用者的最终结果仍包含后续成功的事实、锁、messages与最新revision。已有派生投影收尾继续独立，不回滚来源。

- [ ] **Step 4: 验证最小 GREEN 与成功链**

Run same focused command；还须验证新建Program合法创建而回调失败、batch来源全成全败、单次源码错误显式run、正常订阅仍改Result、失败后重试不重做来源且不留半effects。同一来源成功回执只通知一次；不要靠清空errors或禁用触发取绿。

- [ ] **Step 5: 检测并提交**

Run `git diff --check` and GitNexus detect_changes；核对只影响来源/后续提交链。

```text
git add work-engine/atom-language/engine.mjs src/atom-system/adapters/legacy-engine-adapter.mjs tests/atom-transform-postcommit-boundary.test.mjs tests/atom-slot-strut-lock-acceptance.test.mjs
git commit -m "fix(runtime): commit source transforms before triggered effects"
```

### Task 2: 中央回执关联与中断恢复

**Files:**
- Modify: `src/atom-system/adapters/transactional-world-persistence.mjs`
- Modify if required: `src/atom-system/adapters/json-world-repository.mjs`
- Modify: `src/atom-system/adapters/legacy-engine-adapter.mjs`
- Modify: `work-engine/atom-language/engine.mjs`
- Test: `tests/atom-transform-postcommit-boundary.test.mjs`

**Interfaces:**
- Consumes: Task 1的来源receipt及`subsequentExecution`；原中央journal的不可混淆commandId、before/afterRevision与重试查询。
- Produces: 来源receipt.result关联实际触发事件和后续commandId/结果；冷重启可判别未运行、失败和已提交，而不是依赖内存claim猜测。

- [ ] **Step 1: 用故障注入取得恢复 RED**

真实中央持久化在来源提交后、后续执行前中断；新建service/scheduler读取相同私有目录。来源必须保持after，触发依据可恢复。再在后续effects已提交但响应前中断，重试不能再提交或再执行已确认effect。

```js
assert.equal(sourceAfterRestart.situation, 'after');
assert.equal(recovered.subsequentExecution.status, 'completed');
assert.equal(effectCommitCount, 1);
assert.equal(sourceCommitCount, 1);
```

- [ ] **Step 2: 持久化来源事件与关联结果**

只在原中央提交result中携带序列化的局部事件（mode、nodes、affectedPaths、action、source revision/command）；禁止全世界复制为调度消息。后续事实receipt绑定来源command，失败保留错误而不重写来源事实/修订。若需新增journal方法，仅用于同一来源的附加运行结果，不建立新文件状态仓，也不改变原来源command和提交证明；对旧日志/旧reader兼容必须给出实测。

- [ ] **Step 3: 覆盖并发与非重放**

来源后插入另一真实提交，使旧后续候选CAS失败；重新读取实际修订后重新判定，不能补写旧快照。重复关联必须先读已提交receipt；失败重试只执行未确认后续。旧来源路径已不存在时返回准确后续定位失败，不猜新路径、不扩大Agent权限。

- [ ] **Step 4: 验证聚焦 GREEN 并提交**

Run: `node --test --test-isolation=none tests/atom-transform-postcommit-boundary.test.mjs`，包含来源/效果分别守恒、冷重启、重试、冲突与旧日志读取。GitNexus/diff检查后只提交此Task实际文件。

### Task 3: 公共入口与最终候选交付

**Files:**
- Test: `tests/atom-transform-postcommit-boundary.test.mjs`
- Modify: 本计划、唯一需求总账及既有恢复断点。

**Interfaces:**
- Consumes: Task 1/2完成且经评审的候选。
- Produces: 公开入口来源提交／后续独立失败与成功证据，最终部署回读。

- [ ] **Step 1: 真实公共旅程**

以生产同款service/公开CLI和普通Agent，在隔离世界验证合法来源→立即exact读为after→后续失败独立回执；修复该测试Program后再触发，Result成功。真实生产世界只读副本验证一次上级改名，保全后代结构/正文、外部引用、既有Trigger与阶段接棒，生产源hash不变。

- [ ] **Step 2: 扩展受影响门禁**

根据最终detect_changes选择Trigger/Strut/slot signal、lock、Program显式调用、投影与事务恢复的最小受影响链。当前层失败先定向修复；A等无关界面不插入本候选测试。

- [ ] **Step 3: 最终候选全量一次及独立评审**

Run: `npm run check:development-control`；`npm test`。真实失败先定向修复；重复相同revision有效全量无意义。独立whole-branch review后才集成。

- [ ] **Step 4: 受控部署与公共回读**

基线、Git SHA、私有备份和构建id可追溯；集成本地main后受控重启 Atom Graph Runtime，公开health为ready且atomProjection.status=published，再公开CLI读取普通Agent及所需源节点。代码回退不回滚用户后来写入的业务世界；不push。

- [ ] **Step 5: 回告与继续**

向已授权提出方任务回告具体结果，更新总账/断点；随后旧生成print维护迁移，再恢复A Task 5—7，手机实际连接恢复时优先手机入口。阶段汇报不结束整个Atom持续任务。

## 计划自审

- **覆盖**：Task1来源/运行分离与原子性；Task2幂等、并发和恢复；Task3普通公共入口、性能、四轴守恒、最终门禁及部署。
- **共享接口**：Task1定义subsequentExecution；Task2只增加中央关联证明，不改变顶层来源成败；Task3验收两种结果，禁止用单元替代公共入口。
- **范围**：零Agent/白板需求保留在唯一总账后续队列；本计划不重写Graph本体、Agent钥匙或槽体ABI。
- **当前状态**：仅完成根因与计划；未修改运行代码、未取得新RED/GREEN，不宣称提交分离已完成。
