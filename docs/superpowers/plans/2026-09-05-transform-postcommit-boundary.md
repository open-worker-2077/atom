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
- Modify if required: `src/atom-system/adapters/transactional-world-persistence.mjs` (Task1仅给已提交后的收尾异常附中央receipt；持久事件/索引仍Task2)
- Test: `tests/atom-slot-strut-lock-acceptance.test.mjs`
- Test: `tests/atom-agent-candidate-runtime.test.mjs` (only three post-source escalation cases; see execution ruling)
- Test if persistence touched: `tests/atom-world-service-contract.test.mjs` (中央成功后辅助回调失败仍附原receipt)
- Test: `tests/atom-transform-postcommit-boundary.test.mjs` (new)

**Interfaces:**
- Consumes: 现有 `applyTransform`、`validatePrograms`、`validateRequestCandidate`、`commitChangedGraph`、`reconcileProgramsForWorld` 和中央 commit receipt。
- Produces: `result.subsequentExecution`，结构 `{ status: 'pending' | 'completed' | 'failed', sourceRevision, revisionAfter, errors: [] }`；提前onCommitted回执为pending，最终回执为completed/failed。顶层 `ok/changed/revisionAfter`如实描述来源与最终已提交世界。后续失败必须有原错误 code/details，顶层来源成功不可改为失败；同时通过既有warnings准确提示来源已提交／后续失败，不能把失败藏在CLI不展示的新字段。

- [x] **Step 1: 取得真实来源守恒 RED**

沿既有 failing subscriber fixture，将旧三项验收改为来源=after；effects拒绝时Result仍before。测试不stub中央持久化；保留私有临时目录。

```js
assert.equal(result.ok, true, JSON.stringify(result));
assert.equal(find(stored, 'Source').situation, 'after');
assert.equal(result.subsequentExecution.status, 'failed');
assert.ok(result.subsequentExecution.errors.some(error => error.code === 'ATOM_PROGRAM_FAILED'));
```

新增多effects Program：先改合法Result、再改Missing；断言来源提交、Result仍before。新增来源本身无权限／四轴非法反例：来源不变、订阅未执行。新增直接`.run.`失败仍失败的区别证据。

- [x] **Step 2: 运行最小 RED**

Run: `node --test --test-isolation=none tests/atom-transform-postcommit-boundary.test.mjs tests/atom-slot-strut-lock-acceptance.test.mjs`

Expected: 新来源守恒断言失败；基础设施无法spawn不计RED。

- [x] **Step 3: 在原入口分开提交**

单笔、batch、create、restore逐一核对来源apply/validate和后续reconcile的次序；合法来源先调用中央提交，随后运行现有局部事件。给 `commitChangedGraph` 增加可选 `expectedRevision` 与 `correlationId`，默认行为保持现有调用者；后续提交显式使用来源提交后的revision，禁止继续以request-start revision提交。Adapter不得用父interaction id覆盖明确的子运行关联。累计所有真实已提交affectedPaths。

```js
const sourceReceipt = await commitChangedGraph(sourceAtoms, sourceCommitOptions);
// sourceReceipt.authorizationFailure 仍直接拒绝来源。
// 已提交之后，后续候选单独验证、单独CAS；失败只形成 subsequentExecution。
const subsequentExecution = { status: 'failed', sourceRevision, revisionAfter: sourceRevision, errors: [failure] };
```

该示意定义次序和回执，不授权加入第二调度器。来源变更回执应在后续worker阻塞前可通知 `onCommitted`；返回给已有调用者的最终结果仍包含后续成功的事实、锁、messages与最新revision。已有派生投影收尾继续独立，不回滚来源。

- [x] **Step 4: 验证最小 GREEN 与成功链**

Run same focused command；还须验证新建Program合法创建而回调失败、batch来源全成全败、单次源码错误显式run、正常订阅仍改Result、失败后重试不重做来源且不留半effects。同一来源成功回执只通知一次；不要靠清空errors或禁用触发取绿。

- [x] **Step 5: 检测并提交**

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
- Modify: `cli/lib/server.mjs` (existing atomCommandRequest cache only)
- Modify if required: `src/atom-system/public/interaction-runtime.mjs` (既有onCommitted通知的异步错误传播/一次性通知，不改调度)
- Test: `tests/atom-transform-postcommit-boundary.test.mjs`
- Test: `tests/spatial-server.test.mjs` (existing HTTP receipt lifecycle)

**Interfaces:**
- Consumes: Task 1的来源receipt及`subsequentExecution`；原中央journal的不可混淆commandId、before/afterRevision与重试查询。
- Produces: 来源receipt.result关联实际触发事件和后续commandId/结果；冷重启可判别未运行、失败和已提交，而不是依赖内存claim猜测。

**已完成影响预检：** createJsonTransactionJournal HIGH（15直接调用），createTransactionalWorldPersistence CRITICAL（15直接），createLegacyWorldService HIGH（10直接），atomCommandRequest LOW（1直接），已告知用户。d=1关系覆盖维护迁移/rollback、投影清单、服务组合与Graph server；相关证据在本计划SDD工作区task-2-impact.json。现行源码已核对journal追加/加载、persistence commit/rollback/manifest、adapter恢复与HTTP settle链；实施方复用此预检，新增实际修改符号仍作对应impact。新增端口须保持旧调用者原接口与逆向patch。

**持久接口与兼容方案：**

```js
// createTransactionalWorldPersistence返回值上的内部端口；不新增CLI语法。
commit({ /* existing fields */, postCommitEvent, subsequentOf });
programExecution(sourceCommandId); // null或{sourceReceipt,event,outcome,childReceipt}
programExecutionForInteraction(correlationId); // 原interaction id定位source receipt；同日志内索引
pendingProgramExecutions(); // 冷恢复使用；热路径以source id索引，不每请求扫描历史
recordProgramExecution({ sourceCommandId, outcome });
// outcome沿用Task1结构，另绑定attemptId及成功的childCommandId。
```

来源`postCommitEvent`包含现有局部trigger envelope、原interaction身份与关联；后续事实receipt.result的`subsequentOf`绑定来源commandId。成功child receipt已存在而outcome未写时，由child receipt恢复完成结果，禁止再次跑effects。相同关联重试必须核对原source/Agent身份；不同请求复用关联应稳定冲突，不能泄露他人回执。

当前中央commandId由correlationId与前后revision共同哈希，重试方只有原interaction id，不能从最新世界反推旧commandId。因此在同一journal加载时维护correlation→source receipt索引，并在提交入口校验已有绑定；不得每次请求全量扫描，也不能只依赖HTTP内存cache防并发同id重放。绑定只适用于本次带postCommitEvent的来源合同，不改写历史普通receipt。

失败结果为该来源后续运行的已确定结果，同id重读只返回该结果；修复Program后由新的合法Transform事件触发，不将同id结果查询偷偷变成业务重试。只有无最终结果且无已提交child的中断尝试才可按当前世界与当前授权恢复。事件只保留原Agent路径/身份依据，不把历史labels或scope当现行授权。

复用原journal `committed`事件的可扩展字段：`recordProgramExecution`可追加**原commandId、原compact record、原receipt逐字段不变**的committed事件，另附`programOutcome`；新loader构造同一日志的结果索引，旧loader仍还原同一原receipt及顺序。禁止把原世界receipt改成运行receipt、移动receipt顺序、覆盖source revision或省略原record使rollback信息丢失。须用旧loader行为对照实测后采用，若对照失败先修此兼容点，不部署。该方案不写第二日志、不增加世界revision；一次失败结果不是新世界提交。

```js
await appendEvent({ type: 'committed', commandId: sourceCommandId,
  record: originalCompactRecord, receipt: originalReceipt, programOutcome: outcome });
assert.deepEqual(await oldReader.findReceipt(sourceCommandId), originalReceipt);
```

此为需由测试确认的实现裁定。错误代价为局部journal附加结果编码返工，不改变来源事实合同；不得借该裁定略过旧日志、幂等、逆向patch和回退验收。

**公开重读边界：** `cli/lib/server.mjs:atomCommandRequest`现有cache固定保存首个settle Promise；提前来源ack后，重复同一请求会永远读pending。Task2在原cache条目中记录最终结果，保留既有fingerprint冲突规则；同一POST/interaction id在运行中读pending、完成后读最终结果，禁止重跑operation。冷重启由中央持久关联恢复同一结果，不另建读取状态仓或新CLI语法。初始CLI回执通过既有warning明确后续pending及关联id；最终失败warning与原errors保持一致。取消/超时发生在来源提交后，也不得把来源记录变为未提交。

**通知失败边界：** onCommitted同步抛错或返回rejected Promise属于回执通知失败；保留一次性通知计数，记录可行动warning，已提交来源仍返回成功，合法后续业务继续。现行interaction-runtime的notifyCommitted不返回外层callback Promise，必要时在该现有函数与调用处贯通处理，避免未处理拒绝；须分别覆盖直接service与公开runtime，不以assert.rejects＋来源落盘当作完整通过。

```js
assert.equal(first.result.subsequentExecution.status, 'pending');
assert.equal(repeatedAfterCompletion.result.subsequentExecution.status, 'failed');
assert.equal(sourceCommitCount, 1);
assert.equal(workerCalls, 1);
```

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
- **当前状态**：Task1 b4a74cc..76387cd完成，两轮回修后独立复核Approved。当前核心18/18、持久契约17/17，未触及的Agent16/16证据复用。Task2持久关联/恢复与Task3公开交付未完成，不宣称生产提交分离已关闭。

## SDD预检与当前执行

| 对象 | 相邻生产／消费关系 | 裁定 |
|---|---|---|
| Task1自身 | 来源守恒RED／来源与后续分开commit | 顶层成功不吞错误，subsequentExecution承载后续错误；显式run仍以自己的effects决定成败 |
| Task2自身 | 来源事件关联／重试与冷恢复 | 必须中央证据，单靠内存claim不算通过；旧journal仍可读 |
| Task3自身 | 最小受影响链／公开验收／部署 | 先当前层通过再升级，最终全量一次，不部署A半成品 |
| Task1/2 | engine及adapter、subsequentExecution | Task1只分离提交；Task2补持久关联，不提前宣称冷恢复 |
| Task1/3 | 返回值与真正来源／后续事实 | 公开入口同时验证success及failed后续，不能只检查顶层ok |
| Task2/3 | 来源command/revision与恢复证明 | 成功回执、重复关联和重启必须绑定同一候选代码 |

- **状态位置裁定**：依用户明确要求，进展和裁定只写本计划／唯一总账，不创建SDD progress.md。官方工作区仅保存brief/report/diff证据。
- **Task1准备**：BASE=b4a74cc；原四个文件加下文明确授权的Agent回归文件，共五个代码/测试文件。控制方持有本计划与总账，实施方不得暂存文档；不派生其他agent，不全量、不部署、不push、不删除产物。

- **Task1 RED**：node --test --test-isolation=none tests/atom-slot-strut-lock-acceptance.test.mjs，2通过/3失败；失败为原实现来源ok:false／未提交，分别ATOM_PROGRAM_FAILED(KeyError)、TRANSIENT_FAILURE、ATOM_NOT_FOUND。默认沙箱spawn EPERM未形成有效业务结果，获准运行后才计RED。pre-edit impact：executeAtomLanguage MEDIUM（11直接测试消费者），commitChangedGraph LOW（1直接/13影响/4flows），reconcileProgramsForWorld LOW，无HIGH/CRITICAL；仍以实际中央提交与授权链验收，不只信辅助索引。

- **Task2编码预证**：控制方在私有合成世界以现行中央persistence提交Source，追加原record/receipt不变且带programOutcome的committed事件。未修改journal实现；冷旧reader的原receipt深比较、记录数量、inversePatch以及真实rollback均PASS，副本atom-outcome-journal-compat-dfwaSG保留。此只证明编码兼容/逆向回滚可行，不代替Task2新索引、身份绑定、冷恢复与非重放实现验收。

- **回执时序裁定**：Task1初稿只列completed/failed，却要求worker阻塞前通知，二者不完整；补pending作为提前来源回执状态。现行CLI仅渲染messages/warnings/errors，故后续失败也投影为明确warning，原错误仍存subsequentExecution。错误代价为返回字段与提示返工，不改变来源成败，不新增CLI语法。

- **Task1授权回归校准**：atom-agent-candidate-runtime定向13/16；控制方回读464/481/538确认三项是合法来源触发后续越权Agent声明，旧测试期望整笔来源回滚。允许Task1增加该测试文件，只把create新来源、single Target=after、batch Target=after且Leak=still-stable保留；child Agent原声明、后续AGENT_JURISDICTION_ESCALATION、unauthorizedRuns=0和原Agent security守恒仍须断言。直接非法来源声明、显式run、atom/explore的零提交测试不改。既有失败结果复用，不重复RED。

- **Task1候选复核**：b4a74cc..f0aa356，仅五个授权代码/测试文件。追加真实RED证明普通transform trigger先写Result再写Missing会错误返回completed；改为拒绝整次后续effects后，核心来源/后续及Trigger/Strut为12/12、Agent授权为16/16，语法与diff检查通过。GitNexus最终CRITICAL（18符号/17流程）已告知用户，独立复核由transform_boundary_task1_review按精确diff进行；未部署、未重复全量。

- **Task1 fix round 1/5**：f0aa356复核Needs fixes：后续CAS/持久拒绝仍越过来源成功边界；来源改变而后续仅消息时claims不确认；普通Trigger worker异常误报completed；shortcut/slot-body事实effects缺失changedPaths会漏提交。已一次转回原实施方，补对应定向RED/GREEN；另撤掉新测试擅加的临时目录删除，落实用户保留产物要求。此轮四项均未关闭，Task2不提前派发。

- **Task1回修RED**：实施方已分别复现effects CAS裸抛、来源变化后message-only领取悬挂、普通Trigger throw误报completed、shortcut-only未落盘，四项均为现有engine内缺陷。消息回归改为有界验证，无无限等待。追加后续事实提交后辅助镜像抛错检查，按中央receipt与真实revision识别已提交状态；定向GREEN待最终报告，不以中间行为观察替代通过。

- **Task1回修GREEN**：9b0fa5e只提交engine及新边界测试；边界/slot/strut17/17、Agent16/16，静态/diff检查通过。覆盖上述四项及后续已提交后镜像失败，原receipt信息保留；新测试临时删除均撤除。最终本轮impact HIGH（2文件/5符号/10流程）；同一评审方正在按f0aa356..9b0fa5e精确复审，不重跑已覆盖测试。

- **Task1 fix round 1/5裁定**：原四项中三项关闭、batch message-only确认仍缺失；新增两项Important为已提交镜像异常回执丢失changed/affectedPaths/锁/改名结果，以及错误要求已提交receipt revision等于最新世界。进入round2/5，FIX_BASE=9b0fa5e。
- **Ruling: 已提交证明归属**：本次effects完成只能由匹配该次中央commit的receipt证明；最新世界revision可继续前进，世界内容恰与候选相等也不能证明本次提交。若现行persistence在中央成功后adopt/备份钩子抛错丢失receipt，授权Task1最小补回原receipt信息，禁止据候选hash猜测或提前实现Task2索引。理由为现有镜像失败边界的必要依赖；错误代价为局部异常封装返工，不改变world/journal合同。
- **跨任务观察**：初版onCommitted抛错测试以assert.rejects证明来源落盘；通知错误仍可向调用方抛出。Task2在统一结果/HTTP缓存收口时补通知失败独立warning、不中断已提交来源及后续处理的验收；不把此观察当作本轮未触及代码的复审扩张。

- **Task1 round2 RED**：并发别人先提交同内容导致本次CAS拒绝却被候选hash误报completed；本次已有中央receipt但随后另一次提交改变latest revision被误报failed，定向0/2。batch真实变化＋message-only仍悬挂，已停止该次无结果测试后修复确认分支。实施方使用已授权persistence最小异常封装保留中央receipt，未扩到Task2事件索引。

- **Task1 round2局部GREEN**：并发同内容CAS归属、receipt之后新并发提交、batch message-only三项已通过；复合回执用例的changed/result/paths/revision已正确，但新增锁仍未进入最终lockState，实施方正在定界锁声明生效时序与catch索引来源。未把部分GREEN记为全轮完成。

- **Task1 round2候选**：76387cd，核心18/18、committed-receipt及world-service契约17/17，静态/diff检查通过。复合fixture已使用正常/catch同一最终锁索引，覆盖来源no-op、后续改名、实际scheduler锁、完整路径、原receipt与之后并发revision。四文件（含已授权persistence异常封装及其契约测试），impact HIGH（5符号/8流程）；精确9b0fa5e..76387cd复审进行中。

- **Task 1: complete**：b4a74cc..76387cd；round2复核逐项ADDRESSED、无新增Critical/Important、Approved。两轮修复均有具名RED/GREEN与精确差异复审。持久事件/冷恢复/重复HTTP最终回执/通知异常收口明确由Task2承接，Task3再作最终公开验收；未部署本候选。
