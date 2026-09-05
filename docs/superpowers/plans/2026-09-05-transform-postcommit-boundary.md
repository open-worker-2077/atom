# Transform Post-commit Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 合法来源 Transform 先原子提交，后续 Program 运行失败不撤销或否定该来源；既有触发、权限、局部性与恢复需求继续成立。

**Architecture:** 复用现有中央事务、reconcileProgramsForWorld 和提交后收尾入口；将来源事实与随后产生的 effects 拆开提交。来源回执保存可追踪事件，后续运行采用自己的读取修订与结果；不新增业务队列、第二世界权威或永久双轨开关。

**最终12项失败只读分类（归档修复期间，尚未回修）:** root已回读实际断言：receipt时序1项仍要求后续reconcile先于来源commit；interaction-e2e的5项显式.run失败仍要求ok=true/warnings，均与本计划已确认合同不符，后续应保全原facts/原子性断言并按真实错误收口。service-e2e两项性能fixture主动混入无效effects，原断言仍期待同批其它effects部分成功，与已确认后续批次原子性不符，须分别保留合法大批性能和拒绝批次零effects验收，不能只改等待时间。其余公共CLI先创建Program再立即读取效果、两步镜像链、保留授权重试及视觉性能仍须定向取证；当前仅识别疑点，不先把失败一律归为旧断言，不改实现/重跑全量，归档第一优先保持。

**Tech Stack:** Node.js、现行 Python Program worker、中央 JSON 增量事务日志、Node test runner、公开 CLI/HTTP。

**最终回归最小裁定（2026-09-05）:** 原Task2只读确认jump授权候选真实append后未加入programChangedPaths；When=false无relocation，effects空路径判断漏掉中央child提交却completed。允许原Task3仅把真正新增授权的节点/Registration路径汇入现有变更集合，复用授权不伪造变更，保持When=false留授权不移动和重试仅一次。公共CLI pending成功回执漏打印真实interactionId，致原night-watch无法取得同id终态；允许cli.mjs按既有关联格式输出此id，helper沿现有HTTP同source/id回读后验效果，不新增CLI语法或重放请求。二者均是本次拆分的必要回归修复，非新增权限/调度模型。

**Spec:** `docs/superpowers/specs/2026-08-31-atom-runtime-projection-recovery-design.md` §2、§4、§5；`docs/superpowers/specs/2026-08-31-atom-world-program-design.md` §3。

## Global Constraints

- 普通事实改造的后续业务触发不成为合法来源提交的前置条件。
- 来源Transform与后续Program effects都复用中央事务入口；各自事务的事实、锁变更和可逆记录原子裁定。
- Program异常不发布该次运行尚未提交的effects；此前已提交的来源事实保持成立。
- 同一操作重试复用中央回执；不得产生第二次业务提交或重复触发 Program。
- 只调度精确命中的 Program/订阅，不扫描和执行无关世界 Program。
- 不关闭Trigger、Strut、阶段接棒；不恢复旧ABI，不改业务世界正文来规避代码缺陷。
- 用户2026-09-05明确授权代码安全备份，控制方已核对三分支推送；实施方不自行push。生产验收使用私有副本，部署复用既有 Atom Graph Runtime，来源业务任务自行完成业务改造。

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
- **优先级**：I3/U3/D3/E3；本项部署回告后先处理已恢复连接的手机共同配置及真实入口，再处理5个旧生成print迁移，随后A Task 5—7。A Task 4 安全点及全部有效规格继续保留。

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
- Test: `tests/atom-language-graph-server.test.mjs` (existing Atom HTTP early receipt/id conflict/deadline lifecycle)
- Test if needed: `tests/spatial-server.test.mjs` (lower-level cache boundary; no duplicate fixture required)

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

当前中央commandId由correlationId与前后revision共同哈希，重试方只有原interaction id，不能从最新世界反推旧commandId。因此在同一journal加载时维护correlation→source receipt索引，并在提交入口校验已有绑定；不得每次请求全量扫描，也不能只依赖HTTP内存cache防并发同id重放。绑定只适用于本次带postCommitEvent的来源合同，不改写历史普通receipt。请求身份使用包含语义输入的固定SHA-256指纹，history可纳入散列但不把正文复制为调度事件；恢复不回灌历史labels/scope/history/bypass，仅原局部事件和Agent路径在当前世界重判。

**Ruling: 写入所有权范围**：本Task覆盖同进程多个service/HTTP并发及旧进程终止后的冷进程恢复；生产继续由单Atom Runtime中央入口写入，不扩为跨进程同时写入或新增OS/file锁。允许按规范化context/journal/world身份共享原中央提交所有权；各调用者备份钩子/投影选项仍各自保持，相关cache/索引必须观察同一日志进展。复用现有共享机制或弱引用句柄，禁止永久强Map留住每个测试世界、也不得驱逐活跃提交所有者。原因是现有coordinator/journal只在实例内串行，需要补足同进程真实入口并发；若范围判断错误，代价为后续单独设计跨进程互斥，不以本Task声称已支持。

失败结果为该来源后续运行的已确定结果，同id重读只返回该结果；修复Program后由新的合法Transform事件触发，不将同id结果查询偷偷变成业务重试。只有无最终结果且无已提交child的中断尝试才可按当前世界与当前授权恢复。事件只保留原Agent路径/身份依据，不把历史labels或scope当现行授权。

复用原journal `committed`事件的可扩展字段：`recordProgramExecution`可追加**原commandId、原compact record、原receipt逐字段不变**的committed事件，另附`programOutcome`；新loader构造同一日志的结果索引，旧loader仍还原同一原receipt及顺序。禁止把原世界receipt改成运行receipt、移动receipt顺序、覆盖source revision或省略原record使rollback信息丢失。须用旧loader行为对照实测后采用，若对照失败先修此兼容点，不部署。该方案不写第二日志、不增加世界revision；一次失败结果不是新世界提交。

```js
await appendEvent({ type: 'committed', commandId: sourceCommandId,
  record: originalCompactRecord, receipt: originalReceipt, programOutcome: outcome });
assert.deepEqual(await oldReader.findReceipt(sourceCommandId), originalReceipt);
```

此为需由测试确认的实现裁定。错误代价为局部journal附加结果编码返工，不改变来源事实合同；不得借该裁定略过旧日志、幂等、逆向patch和回退验收。

**公开重读边界：** `cli/lib/server.mjs:atomCommandRequest`现有cache固定保存首个settle Promise；提前来源ack后，重复同一请求会永远读pending。Task2在原cache条目中记录最终结果，保留既有fingerprint冲突规则；同一POST/interaction id在运行中读pending、完成后读最终结果，禁止重跑operation。冷重启由中央持久关联恢复同一结果，不另建读取状态仓或新CLI语法。初始CLI回执通过既有warning明确后续pending及关联id；最终失败warning与原errors保持一致。取消/超时发生在来源提交后，也不得把来源记录变为未提交。实际operation完成必须独立于deadline竞速结果更新同一cache条目，以受控deferred/deadline用例证明截止先结束后仍可同id取得最终结果；保留原取消/截止，不新增无界等待。

**通知失败边界：** onCommitted同步抛错或返回rejected Promise属于回执通知失败；保留一次性通知计数，记录可行动warning，已提交来源仍返回成功，合法后续业务继续。现行interaction-runtime的notifyCommitted不返回外层callback Promise，必要时在该现有函数与调用处贯通处理，避免未处理拒绝；须分别覆盖直接service与公开runtime，不以assert.rejects＋来源落盘当作完整通过。来源中央提交后onAuthoritativeWrite/adopt/镜像辅助收尾异常同样不得越过来源成功边界；仅据本次真实中央receipt确认，保留持久后续恢复依据。

**Ruling: 自动恢复接线**：复用service首次启动请求持有context/scheduler的边界一次消费pending；现行graph-server:478调用interactionRuntime.initialize（source=atom、programMode=project），在538 listen之前，故无须新增公开API。恢复后当前世界/投影须取新事实，不能发布旧snapshot；原Agent当前授权、独立错误、原worker超时/取消继续成立。不借用首个请求的callback，也不递归等待自身guard；同进程共享恢复所有权。以子进程中断后只启动新server/普通读、不重提来源或同id验收自动续行。理由是来源ack后调用方无须重放来源；若接线判断错误，代价为启动阶段局部接线返工，不取消自动恢复。

```js
assert.equal(first.result.subsequentExecution.status, 'pending');
assert.equal(repeatedAfterCompletion.result.subsequentExecution.status, 'failed');
assert.equal(sourceCommitCount, 1);
assert.equal(workerCalls, 1);
```

**既有service合同：** 无context/projection的adapter保持原参数转发形状；manifest readiness继续复用原single-flight缓存。跨facade以共享持久层实际提交/恢复的内部generation使派生cache失效，普通mock仍在本facade提交后失效；该token不作世界revision/第二状态权威、不按请求扫描历史，rollback/recover/adopt等实际改变清单的路径须一致失效。
- [x] **Step 1: 用故障注入取得恢复 RED**

真实中央持久化在来源提交后、后续执行前中断；新建service/scheduler读取相同私有目录。来源必须保持after，触发依据可恢复。再在后续effects已提交但响应前中断，重试不能再提交或再执行已确认effect。

```js
assert.equal(sourceAfterRestart.situation, 'after');
assert.equal(recovered.subsequentExecution.status, 'completed');
assert.equal(effectCommitCount, 1);
assert.equal(sourceCommitCount, 1);
```

- [x] **Step 2: 持久化来源事件与关联结果**

只在原中央提交result中携带序列化的局部事件（mode、nodes、affectedPaths、action、source revision/command）；禁止全世界复制为调度消息。后续事实receipt绑定来源command，失败保留错误而不重写来源事实/修订。若需新增journal方法，仅用于同一来源的附加运行结果，不建立新文件状态仓，也不改变原来源command和提交证明；对旧日志/旧reader兼容必须给出实测。

- [x] **Step 3: 覆盖并发与非重放**

来源后插入另一真实提交，使旧后续候选CAS失败；重新读取实际修订后重新判定，不能补写旧快照。重复关联必须先读已提交receipt；失败重试只执行未确认后续。旧来源路径已不存在时返回准确后续定位失败，不猜新路径、不扩大Agent权限。

- [x] **Step 4: 验证聚焦 GREEN 并提交**

Run: `node --test --test-isolation=none tests/atom-transform-postcommit-boundary.test.mjs`，包含来源/效果分别守恒、冷重启、重试、冲突与旧日志读取。GitNexus/diff检查后只提交此Task实际文件。

### Task 3: 公共入口与最终候选交付

**Files:**
- Test: `tests/atom-transform-postcommit-boundary.test.mjs`
- Modify if required: `scripts/accept-rename-world-copy.mjs` (真实副本公开请求的最终回执及四轴守恒验收)
- Modify: `scripts/accept-real-world-write-copy.mjs` (仅修最终ok被展开的preRollback.ok覆盖，禁止削减任一验收条件)
- Modify: 本计划、唯一需求总账及既有恢复断点。

**Interfaces:**
- Consumes: Task 1/2完成且经评审的候选。
- Produces: 公开入口来源提交／后续独立失败与成功证据，最终部署回读。

- [ ] **Step 1: 真实公共旅程**

以生产同款service/公开CLI和普通Agent，在隔离世界验证合法来源→立即exact读为after→后续失败独立回执；修复该测试Program后再触发，Result成功。真实生产世界只读副本验证一次上级改名，保全后代结构/正文、外部引用、既有Trigger与阶段接棒，生产源hash不变。

既有accept-rename-world-copy已提供随机端口、普通Agent、全节点身份/类型/正文/拓扑、立即/冷回读和源hash比较；按当前后续结果合同补同id最终回执及必要Strut引用守恒。不能仅因首个source ack为ok就跳过后续失败核对。副本在最终候选时生成，保留产物；若生产同期有合法写入使源hash变化，先区分外部变化，不能用旧备份覆盖生产。

控制方代码回读发现accept-real-world-write-copy末尾先赋综合ok再展开含ok的preRollback，会把rollback/restart/sourceUnchanged的失败覆盖成true。Task3仅调整结果组装次序使综合ok最后裁定，并回看实际各布尔证据；历史证据已有逐项true的不据此无端撤销或重测，不为该修复新增一套验收框架。

- [ ] **Step 2: 扩展受影响门禁**

根据最终detect_changes选择Trigger/Strut/slot signal、lock、Program显式调用、投影与事务恢复的最小受影响链。当前层失败先定向修复；A等无关界面不插入本候选测试。

- [ ] **Step 3: 最终候选全量一次及独立评审**

Run: `npm run check:development-control`；`npm test`。真实失败先定向修复；重复相同revision有效全量无意义。独立whole-branch review后才集成。

- [ ] **Step 4: 受控部署与公共回读**

基线、Git SHA、私有备份和构建id可追溯；集成本地main后受控重启 Atom Graph Runtime，公开health为ready且atomProjection.status=published，再公开CLI读取普通Agent及所需源节点。代码回退不回滚用户后来写入的业务世界；代码安全备份按用户最新授权由控制方处理。部署前私有快照须包含权威atom.json及atom.transactions.json和其.d增量日志目录；生产停写窗口内核对一致性后留存，代码回退与事实恢复分开裁定。既有backup-atom-runtime.ps1只复制atom.json/submissions且会push，不适用于本项完整无推送部署快照。

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

- **Task2开始**：BASE=802d902，实施方transform_boundary_task2（gpt-6-astra，跨文件持久兼容/身份/中断并发判断所需）。按更新brief执行；仅代码/测试、root持有文档，无全量/生产/push/删除。Task1与后续print计划文档已单独保存main@0af6655，生产代码仍8b2df30，主干未提前纳入Task1运行代码。

- **Task2测试位置校准**：既有Atom HTTP提前回执/同id冲突/独立截止场景实际在atom-language-graph-server:900—979，原brief把此生命周期写为spatial-server不准确；允许实施方复用该既有测试文件。spatial-server仅在需要直接cache验收时保留，不为位置统一机械搬迁已有效测试。

- **Task2初始RED/GREEN**：获准命令node --test --test-isolation=none --test-name-pattern='cold retry|notification|creating a valid' tests/atom-transform-postcommit-boundary.test.mjs得到5/5失败：来源冷读端口undefined、child crash预期72实际0（无subsequentOf绑定）、同步/异步callback异常逃逸。实现后5/5真实worker/子进程恢复用例通过；HTTP同id最终重读由pending不能变failed取得RED后GREEN。当前仅同id恢复已证明，启动自动消费接线仍在实施。
- **Task2 CAS验收校准**：旧Task1用例预期CAS为最终错误；Task2要求重新读取当前世界，原Result before→after替换前提已被另一提交改变，所以原CAS保留warning，当前重新判定错误进入最终errors。控制方回读fixture确认语义变化，要求具体错误code/关键细节和source/Result守恒，不接受仅errors.length>0取得GREEN。

- **Task2截止后回执裁定**：atomCommandRequest把operationResult与deadline竞速；来源提前ack后若deadline先结束，真正operation完成也必须更新同一cache最终结果。保留现有取消/截止，不靠无界后台等待；增加受控deferred/deadline验收，同id重读反映已记录最终后续状态，不重做来源。此已送实施方，未取得最终GREEN。
- **Task3公开锚点预读**：2026-09-05 18:02，北京时间；main公开CLI以🧊manage exact explore 🧊manage/包办/瞻重成功，直接子节点ESG计划、Python学习、当前结论；down boundary给出166节点，原if@current→🧊manage/包办/执成的Strut仍在。该预读只确定最新验收目标及关系，不代替候选真实副本改名验收。

- **Task2新增定向证据**：startup来源子进程退出后自动消费先RED（Result仍before）后GREEN；HTTP真正operation完成独立更新cache，两种deadline场景2/2；当前source/Agent不存在或labels撤销3/3；同进程中央facade身份冲突、独立hook及no-change守恒通过；取消后未确认尝试保留pending并由fresh scheduler恢复通过。以上为实施方即时证据，等待最终候选报告和独立复核；当前另有source中央提交后辅助onAuthoritativeWrite异常裸抛的真实RED，尚在修复。

- **Task2汇总门禁**：边界30＋HTTP6为36/36；加原事务/runtime最小链共106项，104通过、2失败。实际server initialize→listen→GET state已验证恢复Result=after且初始化修订一致。两项失败为无context/projection时参数应原样转发，以及manifest readiness需保留single-flight缓存；未升级全量。
- **Ruling: 共享manifest失效**：无持久化保持原接口形状；原manifest Promise缓存继续复用，以共享持久层实际提交/恢复进展的内部generation失效，普通mock保留本facade提交失效。该token仅使派生cache失效，不成为新世界revision或第二权威；覆盖实际改变manifest的rollback/recover/adopt路径，不按请求扫描历史。原因是多facade既要观察新事实，也不能破坏既有缓存合同；错误代价为局部缓存失效接线返工。先定向重测两失败及跨facade缓存用例。

- **Task2服务回归GREEN**：无持久化转发与manifest single-flight两项修复后，原service合同整文件16/16通过。事件binding改为固定请求散列，保留输入冲突比较而不将history正文放大为持久调度消息；startup/身份定向验证后进入报告与提交。

- **Task2候选**：bbf4e32（BASE=802d902），8个代码/测试文件；最终代码后聚焦107/107、Graph重复HTTP/备份2/2、独立交互/截止3/3，共112项通过。包含实际server启动恢复、旧loader逆向rollback、当前授权、HTTP最终cache、源/child辅助异常及原service合同。GitNexus staged CRITICAL，45符号/25执行流；已告知用户，精确802d902..bbf4e32审查包交transform_boundary_task2_review（gpt-6-astra high）独立复核。无全量/生产变更，未标Task2完成。

- **Task2独立复核RED**：评审方真实persistence两facade探针确认：暂停第一笔committed事件append（世界已写、索引尚未发布），第二入口以相同correlationId、不同binding、expectedRevision=第一笔after提交；两笔均fulfilled且sourceCommits=2、commandId不同。证据私有目录atom-task2-review-race-jH0cub保留。入口binding预检在共享coordinator串行裁定外，不能保证中央幂等/身份。候选bbf4e32尚不通过，待完整报告统一进入Task2回修；未部署。

- **Task2 fix round1/5**：bbf4e32独立复核Needs fixes，三项Important：中央关联在串行裁定外（真实双提交RED）；最终outcome append EIO裸抛否定已提交来源（真实RED）；no-change来源产生真实effects却无持久原interaction绑定（代码确认）。复用原实施方统一修复，不进入Task3。
- **Ruling: 中央裁定最小接线**：授权必要时修改现有world-runtime/commit-coordinator.mjs及atom-world-transaction.test.mjs，仅把绑定/最终状态校验放入已有中央串行裁定；不加第二提交队列/coordinator或跨进程锁。来源无变化但effects实际提交，原身份绑定到真实effects receipt，不造空来源revision、不关闭触发。outcome持久失败必须保全已提交来源、明确pending/恢复warning。原因是三项均直接违反已批准合同；错误代价为局部中央接线或回执关联返工。若需新非世界journal语义，先回控制方裁定。

- **Task2 round1 RED**：具名consecutive-revision/outcome append EIO/unchanged source binds命令实际4/4失败，复现双提交、结果记录异常逃逸，以及single/batch来源无变化的effects冷重读重跑。实施方已核对原coordinator五个直接调用，impact MEDIUM；拟沿现有serialize内validateCommit和结果附加串行入口修复。late-dedup返回旧receipt时，禁止adopt未提交候选facts及重复触发备份hook，必须按真实已提交事实交付。

- **Task2 round1定向GREEN**：boundary38＋transaction21＋service16=75/75，HTTP pending/final/deadline2/2。七个新增用例覆盖连续revision不同身份拒绝、同身份复用且仅首次hook、final outcome/effects串行竞态、failed/completed两种outcome EIO、single/batch来源无变化而真实effects冷进程重读零worker。实施方尚在自查/报告/提交，候选未复审。

- **Task2 round1提交复审**：0df824e，六代码/测试文件、77/77，staged CRITICAL（14符号/20流程）；完整fix report已追加，原评审按bbf4e32..0df824e精确包逐项复审。中间cab1e87仅控制方文档，评审范围可回溯。当前不勾Task2完成，不进入Task3、不部署。

- **Task 2: complete**：802d902..0df824e；fix round1三项全部ADDRESSED、无新增Critical/Important、Approved。最终回修覆盖75＋2=77项，初稿未触及的112链证据按revision复用。Task1与未改调度代码的Trigger/Strut/接棒原子性以Task1既有独立复核及18/18支持；Task3仍需最小受影响链与最终全分支审查，不将跨任务验收提前报关闭。当前继续Task3，未部署。
- **Task3开始**：BASE=adb0a0b，实施方transform_boundary_task3（gpt-5.6-sol high，已明确接口的公开验收/脚本修复集成工作）。Task1/2完成不重做；实施方负责公开私有旅程、脚本最小修复、受影响门禁及最终npm一次，控制方负责独立评审/最终全分支复核/生产部署回告。主干已仅同步文档至16f47f8，生产代码仍8b2df30；所有生产业务改造由来源任务自持。

- **Ruling: Task3受影响链收口** — BASE=7edd97e；授权原Task3实施方最小扩展 tests/atom-language-transform-batch.test.mjs、tests/atom-slot-signal-e2e.test.mjs；三条旧单提交断言与普通来源回滚断言按已批准新合同更新，保留 effects 原子性、具体错误和事实守恒。另保留 tests/atom-program-projection-lifecycle.test.mjs 的禁止FULL_REBUILD断言，先定位原因。必要修复仅现有 work-engine/atom-language/engine.mjs 与 program-runtime.mjs 调用上下文/调度接线，禁止关闭触发、无变化抑制、新队列或放宽显式run成功条件；若超出此范围再回控制方。理由是公开交付前不可损害既有显式复制/Slot局部运行；错误代价为局部调度接线返工。先六项定向GREEN再重跑受影响链，未通过不升级。
- **最新执行顺序与备份**：用户已确认手机连接，要求本机配置作为手机基准；已取得当前各浏览器localStorage隔离导致边界0的RED，实际本机值尚未取得。Transform部署/回告后手机配置优先于旧print/A；三分支代码远端安全点详见唯一总账。既有生产数据快照仍只在私有目录保存，不随代码公开推送。
- **Ruling: 显式复制测试语义校准** — 原 fixture 的 initial Parent/Sender 实际产生cpy及slot，在候选应用cpy后（尚未中央提交），reconcile直接命中新增Destination/Sender；其顶层再次cpy到已占用目标，导致DUPLICATE_DESTINATION_CHILD。旧用例的第二个signal来自该重复运行，旧路径曾忽略非法effect；不是copy本身获得发送权。回读Slot规格§1/3/4的显式发送、单点归属、失败守恒，撤回“无条件保留两signal”裁定：拒绝把执行缓存/Slot信号复制到新节点的候选修法，保存诊断diff后撤掉该部分。原非法fixture保留为明确拒绝且零提交回归；另用合法Program fixture验证复制不重定向原信号，任何第二投递须有真实slot调用。理由是测试的偶然旧副作用不能替代规格；错误代价为若后来发现真实业务依赖此旧错误容忍，需要按规格修复其Program并明确迁移，不能隐藏错误或删掉用户的信号需求。仅调整测试fixture和断言，不改生产正文，不扩大显式运行事务架构。
- **投影根因确认**：f0aa356分离来源/effects时漏传普通来源提交原有projectionRebase，导致普通无Program-surface改造走全量settlement。fixture的FULL_REBUILD拒绝是有效RED；Task3恢复single/create/batch非Program-surface来源局部rebase，保留原禁止全量断言。
- **用户原子化定论（20时前）**：提交、后续运行可以关联，但各自是各自，不能强绑定成败和生命周期；不仅修当前症状，还要纠正实现中的同类边界。控制方承担设计和交付责任，不以模型能力归咎用户需求。
- **Task3最终副本新RED**：fe6fd83受影响链127/127。私有atom-rename-acceptance-yI2sEw：来源写入/立即exact/四轴/引用守恒通过，生产源hash前后8785999b00b6e200400c9611bb3cdaa858a1b4effe73701f512f643cac3740ff相同；最终pending。真实阶段reconcile结束elapsed12137.243ms，之后projection11031.247ms至总23588.762ms；HTTP15000ms截止落在投影阶段，adapter仅凭signal.aborted且无childReceipt把已经完成的无facts后续结果改为pending，journal确有两条pending而无terminal。仅加长helper等待或60秒专用配置不能解决生产因果错误，已拒绝并撤回该方向。
- **Ruling: 运行终态与投影生命周期** — Task3暂停验收升级；复用ASTRA Task2实施方修复已有engine/adapter/HTTP生命周期接线。来源提交、后续运行终态、投影恢复各自有完成证据与错误归属；投影延迟/失败/其后取消不得覆盖已确定completed或failed，真实中断的未确认运行仍pending并可恢复。先提出最小现行接线设计并取得对应受控RED，避免把改一个条件或提高超时当作原子化完成。允许engine、legacy-engine-adapter、cli/lib/server及必要interaction-runtime现有回调边界与对应boundary/HTTP测试；不新建队列/状态仓/公开API/业务兼容，不关触发，不变更生产世界。理由是用户明确系统原则且真实副本已证明完成状态被无关阶段推翻；错误代价是现有生命周期接线返工。Task1/2原已通过部分不全量重做，最终受影响链按新增修改升级。

- **Ruling: 终态通知与预算接线** — 同意engine在业务result形成且投影收尾前调用内部onSubsequentSettled，adapter沿既有recordOutcome持久确认，interaction-runtime/graph-server现有lifecycle透传至HTTP原cache；来源onCommitted仍只通知一次，不新增公开API。来源pending ack结束来源等待预算，后续活动阶段使用现有配置时长但独立起算的有限预算；后续终态确认结束该预算，投影不占用它。最终来源ack无后续时直接结束业务预算。真实中断继续pending，outcome EIO不能伪报durable completed；旧业务终态不因投影后迟到signal改变。增加来源接近截止而后续仍获自身预算、completed/failed在投影deferred期间先可读，以及真实取消和无迟到写验证。允许graph-server现有装饰接线，非新服务或队列。
- **生命周期候选提交复审**：664ed94（7代码/测试文件，290增57删），实际报告/原brief已追加；本轮13项矩阵、49项service/runtime、6项Graph和15项关键旅程去重82通过。新增独立预算RED原2/2，worker超时分类RED原1/1已GREEN；自有worker超时failed、外部真实中断pending、持久EIO无终态通知、CAS一次重判与启动callback隔离均保留。staged GitNexus HIGH，diff检查通过。精确范围fe6fd83..664ed94已交原Task2独立评审方；Task3继续暂停待该范围复审，不部署。中间6020057为根侧规格/手机计划文档，代码分工不混同。

- **生命周期回修候选**：b9802de，4代码/测试文件99增8删；3项RED、逐项5/5与2/2GREEN、最终15/15。root实际回读确认完整durable snapshot为基底、按修订合并现有投影字段、按交互关联保全真实通知失败、来源callback缺失时跳过通知。精确包664ed94..b9802de已交原评审方范围复审，原82项证据已完整保存并按未改部分复用。Task3暂不升级，生产仍8b2df30。
