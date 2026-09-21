# Program 名称引述与身份绑定 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Program 以显式 `ref("可读名称或exact path")`／`ref("@aZ3")` 引述 Thing，内核持久绑定永久 Thing ID，热态改名／移动不改 Program，冷启动按 ID 校正过期可读路径并由独立保存阶段落盘。

**Architecture:** Program Situation 仍是唯一应用源码事实；`ref()`只是编译期“引述”标记，不是调用／使用能力。内核把 `Program Thing ID＋source hash＋稳定引述点指纹→target Thing ID` 作为中央事务回执元数据原子保存，冷启动从回执恢复并建立可丢弃反向索引；运行前按已绑定 ID 投影当前 exact path。Thing 热态改名／移动只改变 ID→path 投影，不访问或改写 Program Situation。

**Tech Stack:** Node.js 24 ESM、Python 3 AST worker、Atom Graph-JSON、node:test、中央世界事务。

**Spec:** `docs/superpowers/specs/2026-08-31-atom-world-program-design.md#24-program-名称引述与身份绑定`；状态只写回 `docs/superpowers/plans/2026-09-03-atom-current-requirement-ledger.md`。

## Global Constraints

- `ref()`在Atom中称为“引述”，不表示调用、使用或执行，不与`use_program`混用。
- 名称是应用层、Web与CLI的默认显示；只在显式身份查询、重名消歧或获权审计中显示`@<Thing ID>`并允许精确寻址，普通回执与无关错误不得泄漏 ID，整批 binding 元数据仍不可公开读写。
- 普通字符串永远是文本；只有未被局部遮蔽的静态`ref("literal")`和Atom命令操作符已定型的路径角色形成引述。
- `ref()`恰好接受一个静态字符串位置参数；关键字参数、动态表达式、拼接、别名调用、局部定义或导入伪造均不得绑定。
- 引述绑定与Program源码变化在同一中央事务回执中提交；失败、冲突或保存中断不得留下半份源码或半份绑定。
- 热态rename／move对Program源码访问数、引述解析worker启动数与Program写入数均为0。
- 冷启动校正先进入内存唯一事实，再走既有独立保存阶段；磁盘延迟不得阻塞内存读写。
- 显式`backup@default`子树不进入校正、索引或执行；旧裸字符串只经隔离冷副本显式迁移。
- 最终候选才运行一次整仓门禁；中间任务按最小受影响链升级验证。

## Review Focus

- **文本分界**：正文、message文本、注释、字典普通值和同名局部`ref`逐字节不变，只有合法引述绑定。
- **身份守恒**：同名新增、旧路径复用、连续改名／移动及重启后仍指向原target ID。
- **事务守恒**：Program提交冲突、journal失败、内存接受后保存失败和rollback均保持源码与绑定同代。
- **生命周期**：Program复制、归档、恢复及target归档／恢复不泄漏执行、不换绑。
- **性能边界**：10,000 Thing＋1,000无关Program的热态rename／move不扫描Program、不启动Python、不改Situation。

## Revision Authority

- 只执行下方 **Revised Tasks R3—R7** 及R4后明确插入的S1必要依赖。文件后部原Task 1—5保留为历史证据，其中原Task 3—5已被用户定论撤销，不得执行。
- 已验证基础：`310488f`、`61f87bd`、`d43a7e1`提供单次AST与UTF-8站点；`f09ca45`、`8b10d81`提供不可变索引、备份域排除、局部隔离和并发发布守恒。R3已关闭显式引述，R4已由`c5003b3`关闭中央事务持久绑定；进入R5前必须先完成下方S1的一次性短ID合同切换。

## Revised Tasks R3—R7

### Task R3: 显式 `ref()` 引述语法与执行投影

**Files:**
- Modify: `work-engine/atom-language/program-worker.py`
- Modify: `work-engine/atom-language/program-reference-runtime.mjs`
- Modify: `work-engine/atom-language/program-runtime.mjs`
- Modify: `work-engine/atom-language/engine.mjs`
- Modify: `work-engine/atom-language/program-function-registry.json`
- Create: `tests/atom-program-ref-syntax.test.mjs`
- Modify: `tests/atom-program-reference.test.mjs`
- Modify: `tests/atom-program-reference-write.test.mjs`

**Interfaces:**
- Consumes: 当前validate-only AST与`{role,selector,startByte,endByte,astPath}`站点。
- Produces: `inspectProgramRefSites(source)`只返回合法`ref()`与命令定型路径；`compileProgramRefs({source,bindings,pathByThingId})`只在执行副本中把站点投影为当前exact path。

- [ ] **Step 1: Write failing syntax-boundary tests**

```js
const inspected = await inspectProgramReferenceSites({ source: `
message({"level":"info","text":"World/Target"})
explore({"thing": ref("World/Target")})
` });
assert.deepEqual(inspected.sites.map(site => [site.kind, site.selector]), [['ref', 'World/Target']]);
```

增加`ref(name)`、双参数、关键字参数、局部`def ref`、赋值遮蔽、注释、相邻字面量、CRLF／Unicode；`.ren/.mov/.cpy/.lnk/.dsc/.rst/.run`命令定型路径仍产生`kind:'command'`站点。

- [ ] **Step 2: Verify RED**

Run: `node --test tests/atom-program-ref-syntax.test.mjs tests/atom-program-reference.test.mjs tests/atom-program-reference-write.test.mjs`

Expected:旧实现仍按消费函数位置识别裸字符串，`ref()`尚无编译投影。

- [ ] **Step 3: Implement the syntax marker**

共享AST只收集未遮蔽的`ref("literal")`；`ref`登记为Program语言语法标记而非授权函数。执行副本按站点指纹查binding、按target ID取得当前path，再把对应AST节点替换为exact path常量；缺binding返回`PROGRAM_REF_BINDING_MISSING`，不得按名称回退。

- [ ] **Step 4: Verify GREEN and commit**

Run: `node --test tests/atom-program-ref-syntax.test.mjs tests/atom-program-reference.test.mjs tests/atom-program-reference-write.test.mjs tests/atom-program-runtime-scheduling.test.mjs`

```powershell
git add work-engine/atom-language/program-worker.py work-engine/atom-language/program-reference-runtime.mjs work-engine/atom-language/program-runtime.mjs work-engine/atom-language/engine.mjs work-engine/atom-language/program-function-registry.json tests/atom-program-ref-syntax.test.mjs tests/atom-program-reference.test.mjs tests/atom-program-reference-write.test.mjs
git commit -m "feat: add explicit Program ref syntax"
```

### Task R4: 中央事务内核引述绑定（已关闭）

**Files:**
- Create: `work-engine/atom-language/program-ref-binding-ledger.mjs`
- Modify: `work-engine/atom-language/engine.mjs`
- Modify: `work-engine/atom-language/program-reference-index.mjs`
- Modify: `src/atom-system/adapters/transactional-world-persistence.mjs`
- Modify: `src/atom-system/adapters/json-world-repository.mjs`
- Modify: `src/atom-system/world-runtime/memory-transaction-ports.mjs`
- Create: `tests/atom-program-ref-binding-ledger.test.mjs`
- Modify: `tests/atom-program-reference-index.test.mjs`
- Modify: `tests/atom-memory-transaction-ports.test.mjs`

**Interfaces:**
- Consumes: R3站点与写入时唯一解析的target Thing ID。
- Produces: receipt result `programRefBindings:{version:1,replacements:[{programThingId,sourceHash,sites:[{fingerprint,role,targetThingId}]}],removals:[programThingId]}`；`rebuildProgramRefBindings(receipts,currentPrograms)`返回不可变binding snapshot。

- [ ] **Step 1: Write failing atomic-binding tests**

```js
const receipt = await commitProgram(`explore({"thing": ref("World/Target")})`);
assert.equal(receipt.result.programRefBindings.replacements[0].sites[0].targetThingId, targetId);
const rebuilt = rebuildProgramRefBindings((await journal.readMetadataState()).receipts, world);
assert.equal(rebuilt.forProgram(programId).sites[0].targetThingId, targetId);
```

覆盖commit冲突、journal失败、内存事务、同commandId重试、Program删除、rollback，以及普通CLI／Web／Program回执不出现target ID。

- [ ] **Step 2: Verify RED**

Run: `node --test tests/atom-program-ref-binding-ledger.test.mjs tests/atom-program-reference-index.test.mjs tests/atom-memory-transaction-ports.test.mjs`

Expected:receipt尚无binding metadata，索引仍按path重新绑定。

- [ ] **Step 3: Persist and rebuild hidden bindings**

Program源码变化时在候选提交前生成完整replacement，与facts进入同一`atom.world-receipt` result；`readMetadataState()`只读receipt metadata。Task 2索引改为消费binding snapshot＋当前ID→path，不再由Situation path决定target ID。缺失、source hash不符、target不存在分别返回`PROGRAM_REF_BINDING_MISSING`、`PROGRAM_REF_SOURCE_MISMATCH`、`PROGRAM_REF_TARGET_MISSING`并只隔离对应Program。

- [ ] **Step 4: Verify GREEN and commit**

Run: `node --test tests/atom-program-ref-binding-ledger.test.mjs tests/atom-program-reference-index.test.mjs tests/atom-memory-transaction-ports.test.mjs tests/atom-language-transform-receipt.test.mjs`

```powershell
git add work-engine/atom-language/program-ref-binding-ledger.mjs work-engine/atom-language/engine.mjs work-engine/atom-language/program-reference-index.mjs src/atom-system/adapters/transactional-world-persistence.mjs src/atom-system/adapters/json-world-repository.mjs src/atom-system/world-runtime/memory-transaction-ports.mjs tests/atom-program-ref-binding-ledger.test.mjs tests/atom-program-reference-index.test.mjs tests/atom-memory-transaction-ports.test.mjs tests/atom-language-transform-receipt.test.mjs
git commit -m "feat: persist hidden Program ref bindings"
```

### Required Dependency S1: 一次性短 Thing ID 合同切换

**Plan:** `docs/superpowers/plans/2026-09-21-atom-short-thing-id.md`

**Dependency:** 必须在R4关闭后、R5开始前完整实施并达到E3。R4现有binding已引用现世界22字符Thing ID；S1须在受控冷副本按稳定遍历顺序为12,243个现有Thing重新分配短ID，并在同一原子迁移中替换Thing keys、Strut／Shortcut端点、Program owner／target binding元数据及allocator watermark。不得让R5在旧ID上继续生成冷启动校正、索引或保存证据，否则会把待退役身份扩散到后续状态。

**Gate:** S1未完成正式迁移、整批回退演练、选择性`@id`显示／同权限寻址、一次最终全量、4784部署回读及精确远端检查前，R5—R7保持停止。S1完成后，R5只消费已迁移的短ID world snapshot与同代binding snapshot；不得兼容旧22字符ID、建立alias或在普通启动补迁移。

### Task R5: 冷启动按ID校正与独立保存

**Files:**
- Create: `work-engine/atom-language/program-ref-cold-start.mjs`
- Modify: `work-engine/atom-language/graph-server.mjs`
- Modify: `work-engine/atom-language/program-runtime.mjs`
- Modify: `src/atom-system/adapters/legacy-engine-adapter.mjs`
- Modify: `src/atom-system/adapters/durable-world-save-worker.mjs`
- Create: `tests/atom-program-ref-cold-start.test.mjs`
- Modify: `tests/atom-program-projection-lifecycle.test.mjs`
- Modify: `tests/atom-memory-save-capacity.test.mjs`

**Interfaces:** 消费S1已完成短ID切换的world snapshot与同代binding snapshot；`planProgramRefColdStart({facts,bindings}) -> {changed,programs,nextFacts,nextBindings}`；变化通过既有内存世界提交入口接受，save worker独立持久。

- [ ] **Step 1: Write and verify failing cold-start tests**

```js
const started = await coldStart(worldAfterTargetRename, bindingsBeforeRename);
assert.match(programSource(started.memoryFacts, programId), /ref\("World\/Renamed"\)/u);
assert.equal(started.servingBeforeSaveResolved, true);
```

覆盖路径未变零revision、连续改名只取最终path、保存阻塞／失败时内存Explore可用并重试、旧路径复用不换绑、备份Program零访问、target归档局部隔离、二次启动`changed:false`。

Run: `node --test tests/atom-program-ref-cold-start.test.mjs tests/atom-program-projection-lifecycle.test.mjs tests/atom-memory-save-capacity.test.mjs`

Expected:当前启动只建索引，不按已绑定Thing ID校正`ref()`。

- [ ] **Step 2: Implement memory-first reconciliation**

按distinct source hash解析一次，只补丁过期`ref()`，生成新source hash与replacement bindings并通过中央内存提交一次接受；服务使用新内存事实启动，durable save继续现有串行、重试、关闭前flush与备份时序。单Program失败只隔离自身。

- [ ] **Step 3: Verify GREEN and commit**

Run: `node --test tests/atom-program-ref-cold-start.test.mjs tests/atom-program-projection-lifecycle.test.mjs tests/atom-memory-save-capacity.test.mjs tests/atom-language-graph-server.test.mjs`

```powershell
git add work-engine/atom-language/program-ref-cold-start.mjs work-engine/atom-language/graph-server.mjs work-engine/atom-language/program-runtime.mjs src/atom-system/adapters/legacy-engine-adapter.mjs src/atom-system/adapters/durable-world-save-worker.mjs tests/atom-program-ref-cold-start.test.mjs tests/atom-program-projection-lifecycle.test.mjs tests/atom-memory-save-capacity.test.mjs tests/atom-language-graph-server.test.mjs
git commit -m "feat: reconcile Program refs at cold start"
```

### Task R6: 热态零改写、生命周期与旧数据迁移

**Files:**
- Modify: `work-engine/atom-language/transform-executor.mjs`
- Modify: `work-engine/atom-language/engine.mjs`
- Modify: `work-engine/atom-language/program-reference-index.mjs`
- Create: `work-engine/atom-language/program-ref-migration.mjs`
- Create: `scripts/deploy-program-ref-bindings.mjs`
- Create: `tests/atom-program-ref-hot-path.test.mjs`
- Create: `tests/atom-program-ref-lifecycle.test.mjs`
- Create: `tests/atom-program-ref-migration.test.mjs`

- [ ] **Step 1: Write and verify failing lifecycle tests**

```js
const result = await renameTarget(worldWith1000UnrelatedPrograms);
assert.equal(result.metrics.visitedPrograms, 0);
assert.equal(result.metrics.pythonStarts, 0);
assert.deepEqual(programSources(result.world), programSources(before));
```

覆盖copy新Program ID继承target绑定、Program归档／恢复、target归档／恢复、唯一裸字符串迁移、歧义零写和rollback。

Run: `node --test tests/atom-program-ref-hot-path.test.mjs tests/atom-program-ref-lifecycle.test.mjs tests/atom-program-ref-migration.test.mjs tests/atom-language-transform-p2.test.mjs`

Expected:现有Transform executor仍扫描Program并调用rewrite worker；迁移器不存在。

- [ ] **Step 2: Remove hot rewriting and implement migration**

删除rename／move路径的`thingWorldBindings(atoms)`、全Program loop、`rewriteProgramReferenceBatch()`和`rewriteProgramSourceThroughRelocations()`；只更新ID→path投影。copy生成新owner binding；archive只退出活跃索引；restore按ID恢复。迁移仅在冷副本把可证明的旧角色裸字符串原子改为`ref()`＋binding metadata。

- [ ] **Step 3: Verify GREEN and commit**

Run: `node --test tests/atom-program-ref-hot-path.test.mjs tests/atom-program-ref-lifecycle.test.mjs tests/atom-program-ref-migration.test.mjs tests/atom-language-transform-batch.test.mjs tests/atom-language-transform-p1.test.mjs tests/atom-language-transform-p2.test.mjs`

Run: `rg -n "rewriteProgramReferenceBatch|rewriteProgramSourceThroughRelocations|thingWorldBindings" work-engine/atom-language/transform-executor.mjs work-engine/atom-language/program-runtime.mjs`

```powershell
git add work-engine/atom-language/transform-executor.mjs work-engine/atom-language/engine.mjs work-engine/atom-language/program-reference-index.mjs work-engine/atom-language/program-ref-migration.mjs scripts/deploy-program-ref-bindings.mjs tests/atom-program-ref-hot-path.test.mjs tests/atom-program-ref-lifecycle.test.mjs tests/atom-program-ref-migration.test.mjs
git commit -m "perf: keep Program refs stable across hot relocations"
```

### Task R7: 性能门禁、生产迁移与E3收口

**Files:**
- Create: `tests/atom-program-ref-performance.test.mjs`
- Modify: `tests/atom-system-performance.test.mjs`
- Modify: `tests/atom-production-architecture.test.mjs`
- Modify: `work-engine/atom-language/cli.mjs`
- Modify: `docs/superpowers/plans/2026-09-03-atom-current-requirement-ledger.md`

- [ ] **Step 1: Add and run scale gates**

构造10,000 Thing、1,000无关Program、1个命中Program；断言热态rename／move均`visitedPrograms===0`、`pythonStarts===0`、`programWrites===0`，100→1,000无关Program的中位数比例小于2。冷启动断言每distinct source hash最多解析一次、只写实际过期`ref()`、普通字符串零绑定；默认／未授权输出不含ID，显式`@id`查询与获权审计按S1合同选择性显示。

Run: `node --test tests/atom-program-ref-performance.test.mjs tests/atom-system-performance.test.mjs tests/atom-production-architecture.test.mjs`

- [ ] **Step 2: Escalate verification once per revision**

Run: `node --test tests/atom-program-ref*.test.mjs tests/atom-program-reference*.test.mjs tests/atom-language-transform-batch.test.mjs tests/atom-language-transform-p1.test.mjs tests/atom-language-transform-p2.test.mjs tests/atom-program-runtime-scheduling.test.mjs`

Run: `npm run test:architecture`

Run: `npm run test:system`

Final candidate only: `npm test`

- [ ] **Step 3: Migrate, deploy and close remotely**

正式冷副本执行dry-run、apply、restart、rollback、再次restart；验证源码、binding receipt、world revision与正式源文件SHA-256。保留私有备份和精确代码回退点后快进main，重启4784并从CLI／Web回读`ref()`path、热态rename零Program写、冷启动校正、health／published和生产事实哈希；推送精确SHA并等待远端检查成功后写回唯一总账、关闭E3。

---

## Historical Superseded Tasks — Do Not Execute

---

### Task 1: 写入时单次 AST 识别与 exact path 规范化

**Files:**
- Modify: `work-engine/atom-language/program-worker.py`
- Modify: `work-engine/atom-language/program-runtime.mjs`
- Modify: `work-engine/atom-language/program-reference-runtime.mjs`
- Modify: `work-engine/atom-language/engine.mjs`
- Test: `tests/atom-program-reference.test.mjs`
- Create: `tests/atom-program-reference-write.test.mjs`

**Interfaces:**
- Consumes: Program validation AST、当前 exact Thing index。
- Produces: `validateProgramSources()` 每个变化 Program 返回 `{sourceHash, referenceSites}`；每个 site 含 `{role,selector,startByte,endByte,astPath}`。`normalizeProgramReferences()` 返回规范源码及 `{targetThingId, exactPath}`。

- [ ] **Step 1: Write failing write-time binding tests**

```js
const result = await createProgram('explore({"thing":"目标"})', world);
assert.match(result.source, /域\/目标/u);
assert.equal(result.sites[0].targetThingId, targetId);
```

覆盖 `explore`、Transform trigger、`use_program`、`lock`、`transform`，以及动态表达式、普通文本、注释、函数遮蔽、不存在和歧义。

- [ ] **Step 2: Verify RED**

Run: `node --test tests/atom-program-reference.test.mjs tests/atom-program-reference-write.test.mjs`

Expected: 写入路径未规范化或同一 source 被二次启动 worker。

- [ ] **Step 3: Reuse validation AST and normalize once**

让现有 validate-only AST 同时返回 reference sites；engine 在候选提交前以 exact index 唯一解析并按 byte range 倒序替换为完整路径。同一 source hash 只解析一次；删除写入阶段额外 `inspect-references` 调用。

- [ ] **Step 4: Verify GREEN**

Run: `node --test tests/atom-program-reference.test.mjs tests/atom-program-reference-write.test.mjs`

Expected: PASS；歧义/不存在为零写入；动态引用逐字节不变。

- [ ] **Step 5: Commit**

```powershell
git add work-engine/atom-language/program-worker.py work-engine/atom-language/program-runtime.mjs work-engine/atom-language/program-reference-runtime.mjs work-engine/atom-language/engine.mjs tests/atom-program-reference.test.mjs tests/atom-program-reference-write.test.mjs
git commit -m "feat: bind Program references on write"
```

### Task 2: 冷启动反向索引

**Files:**
- Create: `work-engine/atom-language/program-reference-index.mjs`
- Modify: `work-engine/atom-language/graph-server.mjs`
- Modify: `work-engine/atom-language/engine.mjs`
- Test: `tests/atom-program-reference-index.test.mjs`
- Test: `tests/atom-program-projection-lifecycle.test.mjs`

**Interfaces:**

```js
createProgramReferenceIndex(atoms, { inspectProgram })
index.sitesForTargets(targetThingIds)
index.withProgram(programThingId, inspection)
index.withoutProgram(programThingId)
index.transition({ relocations, changedPrograms })
```

- [ ] **Step 1: Write failing cold-start tests**

100 个 Program 冷启动各解析一次，得到 target ID 双向索引；世界 bytes 与 revision 不变。相同 source hash 重建复用解析结果；缺失目标只隔离相关 Program并返回 `PROGRAM_REFERENCE_TARGET_MISSING`。

- [ ] **Step 2: Verify RED**

Run: `node --test tests/atom-program-reference-index.test.mjs tests/atom-program-projection-lifecycle.test.mjs`

Expected: index 模块不存在。

- [ ] **Step 3: Implement immutable disposable index**

索引只消费当前四轴 Program 事实和 Thing ID/path map；不参与授权、不写世界。启动失败不阻断无关 Explore/Transform；被隔离 Program 不进入执行索引。

- [ ] **Step 4: Verify GREEN**

Run: `node --test tests/atom-program-reference-index.test.mjs tests/atom-program-projection-lifecycle.test.mjs`

Expected: PASS；正常冷启动 revision 完全不变。

- [ ] **Step 5: Commit**

```powershell
git add work-engine/atom-language/program-reference-index.mjs work-engine/atom-language/graph-server.mjs work-engine/atom-language/engine.mjs tests/atom-program-reference-index.test.mjs tests/atom-program-projection-lifecycle.test.mjs
git commit -m "feat: build Program reference index at startup"
```

### Task 3: rename/move 按目标 ID 增量改写

**Files:**
- Modify: `work-engine/atom-language/transform-executor.mjs`
- Modify: `work-engine/atom-language/engine.mjs`
- Modify: `work-engine/atom-language/program-reference-index.mjs`
- Create: `tests/atom-program-reference-relocation.test.mjs`
- Test: `tests/atom-language-transform-batch.test.mjs`
- Test: `tests/atom-language-transform-p1.test.mjs`

**Interfaces:**
- Consumes: Task 2 index 与路径变化中的受影响 Thing IDs。
- Produces: `patchIndexedProgramReferences({atoms,index,targetPathById,targetThingIds})`，只返回变化 Program、候选源码和候选索引；commit 成功后才 publish。

- [ ] **Step 1: Write failing incremental tests**

建立 1,000 个无关 Program 和 1 个命中 Program；rename/move 只访问、解析和改写命中 Program。同名邻居、旧路径复用、批量改名交换、提交失败回滚均保留原 target ID。

- [ ] **Step 2: Verify RED**

Run: `node --test tests/atom-program-reference-relocation.test.mjs tests/atom-language-transform-batch.test.mjs tests/atom-language-transform-p1.test.mjs`

Expected: spy 显示当前实现扫描全部 Program并启动 Python。

- [ ] **Step 3: Replace full scans with index lookup**

从变更子树取得 Thing IDs，调用 `sitesForTargets()` 得到最小 Program 集；用已有 byte range 机械更新 exact path 和 source hash。删除 rename/move 路径上的 `thingWorldBindings(atoms)`、全 Program candidate loop 与 `rewriteProgramReferenceBatch()` spawn。

- [ ] **Step 4: Verify GREEN and forbidden dependency**

Run: `node --test tests/atom-program-reference-relocation.test.mjs tests/atom-language-transform-batch.test.mjs tests/atom-language-transform-p1.test.mjs`

Run: `rg -n "rewriteProgramReferenceBatch|thingWorldBindings" work-engine/atom-language/transform-executor.mjs`

Expected: tests PASS；热态改名/移动实现无全量 rewrite 调用。

- [ ] **Step 5: Commit**

```powershell
git add work-engine/atom-language/transform-executor.mjs work-engine/atom-language/engine.mjs work-engine/atom-language/program-reference-index.mjs tests/atom-program-reference-relocation.test.mjs tests/atom-language-transform-batch.test.mjs tests/atom-language-transform-p1.test.mjs
git commit -m "perf: update Program references by target identity"
```

### Task 4: copy、归档、恢复与旧数据迁移

**Files:**
- Modify: `work-engine/atom-language/program-reference-index.mjs`
- Modify: `work-engine/atom-language/transform-executor.mjs`
- Create: `work-engine/atom-language/program-reference-migration.mjs`
- Create: `scripts/deploy-program-reference-index.mjs`
- Create: `tests/atom-program-reference-archive.test.mjs`
- Create: `tests/atom-program-reference-migration.test.mjs`
- Test: `tests/atom-language-transform-p2.test.mjs`

**Interfaces:**
- Consumes: 旧 Program static literal 与现有冷副本部署/回滚设施。
- Produces: `planProgramReferenceMigration(atoms)`，只把唯一可证明引用规范化为 exact path；歧义/不存在返回逐项阻塞清单并禁止 apply；二次运行 `changed:false`。

- [ ] **Step 1: Write failing lifecycle and migration tests**

copy Program 获得新 Program ID但保持目标；归档 Program 退出活跃索引；目标归档/恢复与 Program 恢复按原 ID/path 校正；旧短名迁移唯一时成功、歧义时零写入、rollback 恢复原 bytes/revision。

- [ ] **Step 2: Verify RED**

Run: `node --test tests/atom-program-reference-archive.test.mjs tests/atom-program-reference-migration.test.mjs tests/atom-language-transform-p2.test.mjs`

Expected: lifecycle/migration 模块不存在或当前路径换绑。

- [ ] **Step 3: Implement lifecycle transitions and explicit migration**

Program copy 只更换 owner ID；archive 从活跃索引移除但不改源码；restore 重新解析 exact path并恢复索引。迁移脚本固定支持 `--dry-run`、`--apply`、`--rollback-receipt`，apply 前使用现有私有备份与单次中央事务。

- [ ] **Step 4: Verify GREEN and cold-copy rollback**

Run: `node --test tests/atom-program-reference-archive.test.mjs tests/atom-program-reference-migration.test.mjs tests/atom-language-transform-p2.test.mjs`

在自动生成的临时冷副本执行 dry-run、apply、postflight、rollback；正式源文件 SHA-256 必须不变。

- [ ] **Step 5: Commit**

```powershell
git add work-engine/atom-language/program-reference-index.mjs work-engine/atom-language/transform-executor.mjs work-engine/atom-language/program-reference-migration.mjs scripts/deploy-program-reference-index.mjs tests/atom-program-reference-archive.test.mjs tests/atom-program-reference-migration.test.mjs tests/atom-language-transform-p2.test.mjs
git commit -m "feat: migrate and preserve Program reference bindings"
```

### Task 5: 性能、门禁与 E3 收口

**Files:**
- Create: `tests/atom-program-reference-performance.test.mjs`
- Modify: `tests/atom-system-performance.test.mjs`
- Modify: `tests/atom-production-architecture.test.mjs`
- Modify: `work-engine/atom-language/cli.mjs`
- Modify: `docs/superpowers/plans/2026-09-03-atom-current-requirement-ledger.md`

**Interfaces:**
- Consumes: 冷启动索引与热态增量链。
- Produces: 机器可读性能证据：冷启动每 Program 最多解析一次；热态 rename/move 的 visited Programs 与受影响 Program 数一致，Python starts 为 0。

- [ ] **Step 1: Write failing scale test**

夹具含至少 10,000 个无关 Thing、1,000 个无关 Program 和 1 个命中 Program；比较无关 Program 从 100 增至 1,000 时热态改名中位数，比例必须小于 2，且 `visitedPrograms === 1`、`pythonStarts === 0`。

- [ ] **Step 2: Verify RED**

Run: `node --test tests/atom-program-reference-performance.test.mjs tests/atom-system-performance.test.mjs`

Expected: 当前实现 visitedPrograms 为全部 Program且启动 Python。

- [ ] **Step 3: Remove measured residual scans**

只修性能测试定位出的剩余全量遍历；架构门禁禁止 Transform executor 依赖解析 worker、禁止索引写回 Graph、禁止普通启动改写 Program。

- [ ] **Step 4: Escalate verification**

Run: `node --test tests/atom-program-reference*.test.mjs tests/atom-language-transform-batch.test.mjs tests/atom-language-transform-p1.test.mjs tests/atom-language-transform-p2.test.mjs tests/atom-program-runtime-scheduling.test.mjs`

Run: `npm run test:architecture`

Run: `npm run test:system`

Final candidate only: `npm test`

- [ ] **Step 5: Deploy, read back and persist**

先在生产冷副本完成 dry-run/apply/rollback；正式部署前保留私有备份与精确代码回退点。正式 4784 重启后证明启动未制造 world revision，CLI 与 Web 同轨 rename 命中同一增量链；记录 health、build、world revision、Program source 与性能证据。

- [ ] **Step 6: Remote closure and commit**

把实际 RED、GREEN、迁移回执、性能、正式回读与回退点写回唯一总账。获推送授权后推送 main 并等待精确 SHA 的 GitHub 检查终态。

```powershell
git add tests/atom-program-reference-performance.test.mjs tests/atom-system-performance.test.mjs tests/atom-production-architecture.test.mjs work-engine/atom-language/cli.mjs docs/superpowers/plans/2026-09-03-atom-current-requirement-ledger.md
git commit -m "test: prove incremental Program reference maintenance"
```

## Self-Review

- 规格覆盖：写入绑定、身份守恒、冷启动索引、增量维护、解析复用、旧数据迁移与性能均有任务。
- 四轴守恒：权威事实仍只有 Program Situation exact path；反向索引完全可丢弃并可重建。
- 接口一致：Task 2 定义的 index API 被 Task 3—5 原样消费。
- Review Focus 五项均在 Task 1—5 有明确测试。
