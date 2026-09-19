# Program 名称引用增量索引 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Program 静态名称引用在写入时规范化并绑定永久 Thing ID，冷启动只建立一次反向索引，改名与移动只更新受影响引用。

**Architecture:** Program Situation 仍是唯一可读源码事实；所有可维护静态引用在写入或一次性迁移时规范化为 exact 语义路径。运行时从这些事实解析目标 ID，维护可丢弃的 `targetThingId → reference sites` 索引；路径变更与命中源码改写同一事务提交，索引仅在提交成功后发布。正常冷启动不改写世界、不制造 revision。

**Tech Stack:** Node.js 24 ESM、Python 3 AST worker、Atom Graph-JSON、node:test、中央世界事务。

**Spec:** `docs/superpowers/specs/2026-08-31-atom-world-program-design.md#24-program-名称引用索引`；状态只写回 `docs/superpowers/plans/2026-09-03-atom-current-requirement-ledger.md`。

## Global Constraints

- 本计划只在 Web→CLI 单轨 E3 完成后执行。
- Program 源码仍是 Situation 字符串；不新增第五轴、权威 sidecar 或隐藏 ID 文本。
- 新增/修改 Program 的可维护静态引用必须唯一解析并规范化为 exact path；不存在或歧义则整笔拒绝。
- 动态表达式、注释、普通字符串和被遮蔽函数不自动绑定或改写。
- 冷启动只重建/校验派生索引，不写世界；索引丢失可由规范 exact path 重建。
- rename/move/archive/restore 与引用路径改写同一世界事务，失败不发布候选索引。
- 热态不得扫描无关 Program 或启动新的 Python 进程。
- 旧短名 Program 只经显式冷副本迁移规范化，不能在普通启动时偷偷修复。

## Review Focus

- 同名新增、旧路径复用后，原引用仍指向原 Thing ID。
- 完整四轴 `transform({...})` 创建与 `.ren/.mov/.cpy/.lnk/.run` 的参数角色不能误分类。
- 归档 Program 不进入活跃执行索引，恢复后仍按原目标校正路径。
- CRLF、Unicode、单双引号转义和多引用长度变化按 UTF-8 byte range 正确补丁。
- worker 超时、事务冲突、源码哈希失配和保存失败不留下半份源码或提前发布索引。

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
