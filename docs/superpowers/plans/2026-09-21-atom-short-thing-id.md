# Atom 短 Thing ID Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把现有22字符随机永久ID一次性切换为Atom中央顺序分配的最短三位、大小写敏感Thing门牌号，并提供同权限链的`@id`精确寻址与选择性显示。

**Architecture:** `&id=`继续内嵌于Thing Key，是四轴Thing自身的稳定门牌而非第五轴或sidecar；纯函数分配器以中央receipt watermark签发base62顺序ID。部署前在受控冷副本建立一张只用于本次切换的旧ID→短ID映射，用一个中央事务同代替换Thing keys、Strut／Shortcut端点、Program binding snapshot与watermark；正常运行不保留旧ID alias或双格式解析。名称仍默认显示，`@<id>`选择器和`thing~identity`查询只在既有授权链之后返回门牌号。

**Tech Stack:** Node.js 24 ESM、Atom Graph-JSON、node:test、中央世界事务／receipt journal、Playwright Chromium。

**Spec:** `docs/superpowers/specs/2026-08-31-atom-world-program-design.md#23-永久-thing-身份`；依赖`docs/superpowers/plans/2026-09-19-program-reference-index.md`的R4关闭，并作为R5前置门禁；状态只写回`docs/superpowers/plans/2026-09-03-atom-current-requirement-ledger.md`。

## Global Constraints

- **执行边界**：锁定顺序、事实与验证方式。
  - **顺序优先级**：I3／U3／D3／E3；在Program引用R4之后执行，完成前不得进入R5。
  - **迁移事实**：正式世界已有12,243个22字符永久ID；本次是预发布一次性合同切换，不能声称历史ID从未变化。
  - **验证合同**：逐任务只跑最小受影响链；最终候选才运行一次`npm test`，同一revision复用有效证据。
- **编码边界**：锁定短ID表示与生产单轨。
  - **字符合同**：字符表严格为`0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz`且大小写敏感；`000`永久保留，首个可签发ID为`001`。
  - **容量合同**：三位可用`238327`个，三位末项`zzz`之后的下一项必须是`1000`；已签发短ID不改、不补位、永不复用。
  - **单轨合同**：正式运行只接受短ID；旧22字符ID只允许由一次性冷迁移读取器消费，不得进入普通parser、alias表、兼容查询或新receipt。
- **作用边界**：锁定原子提交、授权与披露。
  - **事务合同**：Thing facts、Strut／Shortcut端点、Program owner／target bindings、迁移receipt和allocator watermark必须同代提交；任一失败零写。
  - **显示合同**：名称默认显示；仅`@id`显式查询、`thing~identity`获权审计和已获权重名消歧显示`@<id>`，不得把ID拼进无关错误、普通成功回执或日志。
  - **权限合同**：知道`@id`不授予权限；Explore、Transform、Program与Web必须复用名称／路径选择已使用的解析、访问控制、锁和事务链。
- **上游核对**：当前官方插件仍为`6.4.1`、来源`https://github.com/obra/superpowers`、manifest SHA-256为`8F879F5E2F04C5D2A93BD9EA455072384DC35D01F1DFC5307CA1BE0CEF5BE9AA`，与本分支R4已完成的逐项上游比较一致；`SP-L01—L05`继续作为上游未覆盖的本地补充，本计划未发现新语义冲突。

## File Structure

- **运行核心**：日常分配、持久解析与寻址。
  - `work-engine/atom-language/thing-id-allocator.mjs`：唯一短ID字母表、编码／解码、顺序分配和watermark delta纯函数。
  - `work-engine/atom-language/key-parser.mjs`：正常短ID Key合同；旧22字符格式只在显式migration模式解析。
  - `work-engine/atom-language/thing-selector.mjs`：区分名称／路径与`@id`选择器，不把`@id`解释为type或路径。
- **切换交付**：一次性迁移、部署与既有消费者接入。
  - `work-engine/atom-language/thing-identity-migration.mjs`：稳定遍历、一次性ID映射、四轴与关系／binding同代迁移计划。
  - `scripts/deploy-thing-identity-world.mjs`：冷副本dry-run、apply、postflight、私有备份和整批rollback。
  - 既有事务、Explore／Transform、Program binding、CLI和Web文件只接入上述单一接口，不复制ID规则。

## Review Focus

- **边界序号**：`000`、`001`、`009`、`00A`、`00Z`、`00a`、`zzz`、`1000`的顺序、大小写和最短宽度必须精确。
- **迁移守恒**：12,243个旧ID全部且只映射一次；名称、Situation字节、slot顺序、Strut方向、Shortcut目标和Program source hash不变。
- **失败原子性**：重复／缺失旧ID、悬空端点、binding target缺失、journal失败、postflight失败和rollback均不能留下混合ID或前移watermark。
- **权限与泄漏**：未获权`@id`查询与同名消歧不能泄漏ID；无关错误、普通receipt、默认CLI/Web和日志不得包含门牌号。
- **切换边界**：迁移完成后普通启动拒绝22字符ID且不建alias；第一次普通创建取得迁移watermark之后的下一ID，回滚／删除后也不复用。

---

### Task 1: Base62 allocator与核心Key解析

**Files:**
- Create: `work-engine/atom-language/thing-id-allocator.mjs`
- Modify: `work-engine/atom-language/key-parser.mjs`
- Create: `tests/atom-thing-id-allocator.test.mjs`
- Modify: `tests/atom-language-p0.test.mjs`

**Interfaces:**
- Produces: `THING_ID_ALPHABET`、`parseShortThingId(value) -> {id,ordinal}`、`thingIdForOrdinal(ordinal) -> string`、`planThingIdAllocation({watermark,count}) -> {ids,nextWatermark}`。
- Produces: `parseAtomKey(rawKey,{identityContract:'short'|'legacy-22-migration'})`；默认且普通运行仅为`short`。

- [ ] **Step 1: Write allocator boundary RED tests**

```js
assert.equal(thingIdForOrdinal(1), '001');
assert.equal(thingIdForOrdinal(10), '00A');
assert.equal(thingIdForOrdinal(35), '00Z');
assert.equal(thingIdForOrdinal(36), '00a');
assert.equal(thingIdForOrdinal(238327), 'zzz');
assert.equal(thingIdForOrdinal(238328), '1000');
assert.throws(() => parseShortThingId('000'), { code: 'RESERVED_THING_ID' });
assert.notEqual(parseShortThingId('00A').ordinal, parseShortThingId('00a').ordinal);
```

再覆盖空值、两位、前导补位后的旧ID变形、`_`、`-`、非ASCII、非安全整数、`count:0`与跨`zzz→1000`批量分配。

- [ ] **Step 2: Verify RED**

Run: `node --test tests/atom-thing-id-allocator.test.mjs tests/atom-language-p0.test.mjs`

Expected: allocator模块不存在；Key parser仍只接受22字符base64url。

- [ ] **Step 3: Implement the pure allocator and parser contracts**

```js
export const THING_ID_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

export function planThingIdAllocation({ watermark, count }) {
  const start = parseWatermark(watermark).ordinal + 1;
  const ids = Array.from({ length: count }, (_, index) => thingIdForOrdinal(start + index));
  return Object.freeze({ ids: Object.freeze(ids), nextWatermark: ids.at(-1) ?? watermark });
}
```

`parseAtomKey()`默认只接受最短规范短ID；`legacy-22-migration`必须由迁移模块显式传入，且不得被receiver、Explore、Transform或Program调用。Key规范顺序仍是`thing@type&id=<id>#description`。

- [ ] **Step 4: Verify GREEN and commit**

Run: `node --test tests/atom-thing-id-allocator.test.mjs tests/atom-language-p0.test.mjs tests/atom-graph-four-axis.test.mjs`

```powershell
git add work-engine/atom-language/thing-id-allocator.mjs work-engine/atom-language/key-parser.mjs tests/atom-thing-id-allocator.test.mjs tests/atom-language-p0.test.mjs
git commit -m "feat: define sequential Atom Thing ids"
```

### Task 2: 中央签发、`@id`解析与同权限链

**Files:**
- Create: `work-engine/atom-language/thing-selector.mjs`
- Modify: `work-engine/atom-language/slot-graph-semantics.mjs`
- Modify: `work-engine/atom-language/shortcut-runtime.mjs`
- Modify: `work-engine/atom-language/exact-selector.mjs`
- Modify: `work-engine/atom-language/query-capability.mjs`
- Modify: `work-engine/atom-language/transform-executor.mjs`
- Modify: `work-engine/atom-language/engine.mjs`
- Modify: `src/atom-system/adapters/transactional-world-persistence.mjs`
- Modify: `src/atom-system/world-runtime/memory-transaction-ports.mjs`
- Create: `tests/atom-thing-id-transaction.test.mjs`
- Create: `tests/atom-thing-id-selector.test.mjs`
- Modify: `tests/atom-program-ref-binding-ledger.test.mjs`
- Modify: `tests/atom-program-runtime-scheduling.test.mjs`
- Modify: `tests/atom-language-operational-cli.test.mjs`
- Modify: `tests/atom-graph-label-lock-matrix.test.mjs`

**Interfaces:**
- Consumes: Task 1 allocator。
- Produces: internal receipt delta `thingIdentityAllocator:{version:1,previousWatermark,nextWatermark,issued:[id]}`；`rebuildThingIdWatermark(receipts) -> string`。
- Produces: `parseThingSelector('@aZ3') -> {kind:'identity',identity:'aZ3'}`；名称／路径返回`{kind:'semantic',selector}`；`resolveThingSelector(candidates,parsedSelector) -> one match | diagnostic`。
- Changes: `createAtom()`、copy、Shortcut和Program effects必须接收事务预留ID，不得自行随机签发。

- [ ] **Step 1: Write transactional allocation RED tests**

```js
const first = await transformNew('Root');
assert.equal(first.internalReceipt.thingIdentityAllocator.issued[0], '001');
const failed = await transformNew('Duplicate Root');
assert.equal(failed.ok, false);
assert.equal(await currentThingIdWatermark(), '001');
assert.equal((await transformNew('Next')).identity, '002');
```

覆盖批量create/copy按候选稳定顺序分配、journal失败零facts／零watermark、同commandId重试不二次签发、已提交create后rollback／delete不复用、memory与disk重启重建相同watermark、普通公开receipt不含allocator内部清单。

- [ ] **Step 2: Write `@id` and authorization RED tests**

```js
assert.equal((await explore({ thing: '@aZ3', agent: allowed })).matches[0].path, '域/目标');
assert.equal((await explore({ thing: '@aZ3', agent: denied })).errors[0].code, 'WINDOW_ACCESS_DENIED');
assert.equal((await transform({ thing: '@aZ3', situation: '新值', agent: denied })).ok, false);
assert.equal(await situationOf('@aZ3'), '旧值');
```

覆盖`@00A`与`@00a`命中不同Thing、`@000`、`@ab`、`@legacy22...`稳定拒绝、名称恰为`@aZ3`不抢占ID语法、Explore／Transform／Program `ref("@aZ3")`共用同一visible candidate与lock判断、未获权歧义不泄漏候选ID。

- [ ] **Step 3: Verify RED**

Run: `node --test tests/atom-thing-id-transaction.test.mjs tests/atom-thing-id-selector.test.mjs tests/atom-program-ref-binding-ledger.test.mjs tests/atom-program-runtime-scheduling.test.mjs tests/atom-language-operational-cli.test.mjs tests/atom-graph-label-lock-matrix.test.mjs`

Expected:创建仍调用随机`createThingIdentity()`；selector把`@id`当普通名称且无watermark receipt。

- [ ] **Step 4: Implement one allocation and selection spine**

事务先计算候选需要的ID数量，再以当前metadata watermark一次预留并把ID显式传给`createAtom`、copy/renew和Shortcut；facts与allocator delta只由同一中央commit接受。`@id`先解析为identity候选，再进入与名称／路径相同的visible-candidate过滤、`authorize()`、锁判断和提交，不提供旁路。

```js
const allocation = planThingIdAllocation({ watermark, count: candidateCreates.length });
const nextFacts = candidateCreates.map((candidate, index) => (
  createAtom({ ...candidate, identity: allocation.ids[index] })
));
await commitWorld({
  facts: nextFacts,
  internalResult: { thingIdentityAllocator: {
    version: 1,
    previousWatermark: watermark,
    nextWatermark: allocation.nextWatermark,
    issued: allocation.ids
  } }
});

const match = resolveThingSelector(visibleCandidates, parseThingSelector(selector));
const access = await accessController.authorize(match, operation, field, actor);
if (access.decision !== 'allow') return { ok: false, errors: [access] };
```

普通rollback只逆转业务facts，不倒退allocator high watermark；整批短ID合同切换rollback由Task 4在服务停止时同时恢复整代facts、binding与watermark。

- [ ] **Step 5: Verify GREEN and commit**

Run: `node --test tests/atom-thing-id-transaction.test.mjs tests/atom-thing-id-selector.test.mjs tests/atom-program-ref-binding-ledger.test.mjs tests/atom-program-runtime-scheduling.test.mjs tests/atom-language-operational-cli.test.mjs tests/atom-graph-label-lock-matrix.test.mjs tests/atom-language-transform-p1.test.mjs tests/atom-language-transform-p2.test.mjs`

```powershell
git add work-engine/atom-language/thing-selector.mjs work-engine/atom-language/slot-graph-semantics.mjs work-engine/atom-language/shortcut-runtime.mjs work-engine/atom-language/exact-selector.mjs work-engine/atom-language/query-capability.mjs work-engine/atom-language/transform-executor.mjs work-engine/atom-language/engine.mjs src/atom-system/adapters/transactional-world-persistence.mjs src/atom-system/world-runtime/memory-transaction-ports.mjs tests/atom-thing-id-transaction.test.mjs tests/atom-thing-id-selector.test.mjs tests/atom-program-ref-binding-ledger.test.mjs tests/atom-program-runtime-scheduling.test.mjs tests/atom-language-operational-cli.test.mjs tests/atom-graph-label-lock-matrix.test.mjs
git commit -m "feat: allocate and resolve short Thing ids"
```

### Task 3: 冷副本全量迁移与Program binding同代替换

**Files:**
- Modify: `work-engine/atom-language/thing-identity-migration.mjs`
- Modify: `work-engine/atom-language/program-ref-binding-ledger.mjs`
- Modify: `work-engine/atom-language/program-reference-index.mjs`
- Modify: `work-engine/atom-language/shortcut-runtime.mjs`
- Modify: `work-engine/atom-language/transform-executor.mjs`
- Modify: `tests/atom-thing-identity-migration.test.mjs`
- Modify: `tests/atom-program-ref-binding-ledger.test.mjs`
- Modify: `tests/atom-program-reference-index.test.mjs`
- Create: `tests/atom-short-thing-id-migration.test.mjs`

**Interfaces:**
- Consumes: Task 1 allocator、R4 `rebuildProgramRefBindings()` snapshot。
- Produces: `planShortThingIdentityMigration({facts,programRefBindings,sourceWatermark}) -> {facts,nextBindings,identityMap,receipt,summary}`。
- Produces: migration barrier `thingIdentityMigration:{version:1,sourceContract:'base64url-22',targetContract:'base62-short',thingCount,sourceRevision,targetRevision,allocatorWatermark}`；binding replay在barrier后不得保留barrier前owner／target ID。

- [ ] **Step 1: Write stable traversal and full rewrite RED tests**

```js
const plan = planShortThingIdentityMigration({ facts: legacyFacts, programRefBindings });
assert.deepEqual(plan.summary, {
  thingCount: 12243,
  uniqueShortIdentityCount: 12243,
  topologyPreserved: true,
  activeLegacyIdentityCount: 0,
  allocatorWatermark: thingIdForOrdinal(12243)
});
assert.equal(identityAtPreorder(plan.facts, 0), '001');
assert.equal(bindingTarget(plan.nextBindings, programId), plan.identityMap.get(oldTargetId));
```

夹具按“顶层数组index→每个Thing的slot子项index深度优先”构造；覆盖Thing key类型／description保留、Strut前后端点、Shortcut目标、Program owner与target binding、同名Thing、备份域、无Program世界、source hash不变和二次plan `changed:false`。

- [ ] **Step 2: Write zero-write preflight RED tests**

重复旧ID、缺失旧ID、混合短／长ID、悬空Strut／Shortcut、binding owner／target不存在、binding source hash失配、12,243数量与实际遍历不符时必须返回稳定阻塞项，且输入facts、binding snapshot、revision与watermark逐字节不变。

Run: `node --test tests/atom-short-thing-id-migration.test.mjs tests/atom-thing-identity-migration.test.mjs tests/atom-program-ref-binding-ledger.test.mjs`

Expected:现迁移只给无ID Thing生成随机值，不会替换现有22字符ID或binding snapshot。

- [ ] **Step 3: Implement one immutable migration plan**

只用显式`legacy-22-migration`读取器扫描旧facts；先完整建立并验证旧→新bijection，再在隔离clone上机械替换所有身份承载点。Program binding migration写入一个全量replacement snapshot与barrier，replay从barrier重新建表，不修改历史receipt、不把旧ID当alias。

```js
export function planShortThingIdentityMigration(input) {
  const records = walkLegacyFactsPreorder(input.facts);
  const allocation = planThingIdAllocation({ watermark: '000', count: records.length });
  const identityMap = new Map(records.map((record, index) => [record.legacyId, allocation.ids[index]]));
  assertMigrationPreflight({ records, identityMap, bindings: input.programRefBindings });
  return freezeMigrationPlan(rewriteIdentityGeneration(input, identityMap, allocation.nextWatermark));
}
```

- [ ] **Step 4: Verify GREEN and commit**

Run: `node --test tests/atom-short-thing-id-migration.test.mjs tests/atom-thing-identity-migration.test.mjs tests/atom-program-ref-binding-ledger.test.mjs tests/atom-program-reference-index.test.mjs tests/atom-program-shortcut.test.mjs tests/atom-language-transform-p2.test.mjs`

```powershell
git add work-engine/atom-language/thing-identity-migration.mjs work-engine/atom-language/program-ref-binding-ledger.mjs work-engine/atom-language/program-reference-index.mjs work-engine/atom-language/shortcut-runtime.mjs work-engine/atom-language/transform-executor.mjs tests/atom-thing-identity-migration.test.mjs tests/atom-program-ref-binding-ledger.test.mjs tests/atom-program-reference-index.test.mjs tests/atom-short-thing-id-migration.test.mjs
git commit -m "feat: plan atomic short Thing id migration"
```

### Task 4: 私有备份、原子部署与整批rollback

**Files:**
- Modify: `scripts/deploy-thing-identity-world.mjs`
- Modify: `src/atom-system/adapters/transactional-world-persistence.mjs`
- Modify: `src/atom-system/adapters/json-world-repository.mjs`
- Create: `tests/atom-short-thing-id-deployment.test.mjs`
- Modify: `tests/atom-system-failure-recovery.test.mjs`
- Modify: `tests/atom-memory-persistence-integration.test.mjs`

**Interfaces:**
- Consumes: Task 3 immutable plan。
- CLI: `node scripts/deploy-thing-identity-world.mjs --dry-run --attempt <id>`、`--apply --attempt <id>`、`--rollback <deployment-receipt>`。
- Produces: 私有`backup-receipt.json`与`deployment-receipt.json`，含源／目标revision、逐文件hash、thing count、allocator watermark、binding generation和中央command ID；旧→新逐项映射只留在私有迁移目录。

- [ ] **Step 1: Write deployment RED tests**

在自动生成的隔离runtime中用12,243个旧ID facts与R4 binding metadata执行dry-run；断言源文件零变化。apply后断言单一中央receipt同时包含迁移barrier、binding replacement和watermark，公开stdout只含计数／hash／revision而不含逐项ID映射。

- [ ] **Step 2: Write failure and rollback RED tests**

逐点注入backup copy/hash、journal prepare、world write、metadata write、projection、postflight失败；apply必须自动回退或报告尚未提交，重启只看见全旧或全新一代。显式rollback必须恢复`atom.json`、journal活动快照、binding generation、watermark与projection，并逐文件核对私有备份hash。

Run: `node --test tests/atom-short-thing-id-deployment.test.mjs tests/atom-system-failure-recovery.test.mjs tests/atom-memory-persistence-integration.test.mjs`

Expected:现脚本只补缺失ID，不能提交短ID binding replacement／watermark或回退同代metadata。

- [ ] **Step 3: Implement cold deployment and postflight**

服务保持停止；先建私有、不可覆盖、逐文件验证的备份，再执行一次中央事务。postflight用正常短ID parser重读facts和活动binding snapshot，要求12,243个唯一短ID、0个活动22字符ID、端点全绑定、watermark等于最后迁移ID；任何失败对已提交command执行整批rollback。

```js
const backup = await createVerifiedPrivateBackup(runtime, attemptId);
const plan = planShortThingIdentityMigration(await readColdGeneration(runtime));
let committed;
try {
  committed = await persistence.commit(shortIdMigrationRecord(plan));
  await assertShortIdPostflight(await persistence.readCommittedGeneration(), plan);
} catch (error) {
  if (committed) await rollbackWholeMigrationGeneration({ persistence, committed, backup });
  throw error;
}
```

- [ ] **Step 4: Verify GREEN and commit**

Run: `node --test tests/atom-short-thing-id-deployment.test.mjs tests/atom-system-failure-recovery.test.mjs tests/atom-memory-persistence-integration.test.mjs tests/atom-world-transaction.test.mjs`

```powershell
git add scripts/deploy-thing-identity-world.mjs src/atom-system/adapters/transactional-world-persistence.mjs src/atom-system/adapters/json-world-repository.mjs tests/atom-short-thing-id-deployment.test.mjs tests/atom-system-failure-recovery.test.mjs tests/atom-memory-persistence-integration.test.mjs
git commit -m "feat: deploy short Thing ids atomically"
```

### Task 5: CLI／Web选择性显示与泄漏门禁

**Files:**
- Modify: `work-engine/atom-language/query-capability.mjs`
- Modify: `work-engine/atom-language/cli.mjs`
- Modify: `work-engine/atom-language/context-store.mjs`
- Modify: `work-engine/atom-language/graph-4d-projection.mjs`
- Modify: `spatial-browser-bridge.js`
- Modify: `tests/atom-language-cli-graph.test.mjs`
- Modify: `tests/atom-language-context-store.test.mjs`
- Create: `tests/atom-thing-id-disclosure.test.mjs`
- Create: `tests/browser/thing-id-address.spec.mjs`

**Interfaces:**
- Consumes: Task 2 selector and access decision。
- Produces: `describeAtom(...,{identityDisclosure:'explicit'|'ambiguity'|'audit'|null})`；仅非null且读取获准时返回`identity:'@aZ3'`。
- Public query: `explore {"thing":"@aZ3"}`自动回显命中的门牌号；`explore {"thing~identity":"域/目标"}`请求获权审计显示；普通`explore {"thing":"域/目标"}`不显示ID。

- [ ] **Step 1: Write CLI disclosure RED tests**

```js
assert.doesNotMatch(await cli('explore {"thing":"域/目标"}'), /@aZ3/u);
assert.match(await cli('explore {"thing":"@aZ3"}'), /identity~address: "@aZ3"/u);
assert.match(await cli('explore {"thing~identity":"域/目标"}'), /identity~address: "@aZ3"/u);
```

覆盖同名获权候选显示各自`path + @id`、部分无权候选完全隐去、未知／无权`@id`不回显原ID、普通Transform成功／失败receipt、Program隔离错误、日志序列化和Shortcut结果不意外拼入Thing ID。

- [ ] **Step 2: Write Web disclosure RED tests**

真实Chromium默认节点标签／悬浮详情只显示名称；用户在已选Thing的审计详情中显式展开“门牌号”后显示`@aZ3`并可复制为精确选择器。重名选择器显示名称、路径和门牌号；无读取权限的节点和门牌均不进入DOM、scene snapshot或网络响应。

Run: `node --test tests/atom-thing-id-disclosure.test.mjs tests/atom-language-cli-graph.test.mjs tests/atom-language-context-store.test.mjs`

Expected:当前投影完全剥离ID且没有选择性披露；若直接透传persistent key会造成默认泄漏。

- [ ] **Step 3: Implement reason-scoped disclosure**

身份字段只由查询层在授权完成后按reason添加；持久`&id=`原文不进入公开投影。CLI以派生`identity~address`呈现；Web只给显式审计面板和重名消歧器传`@id`，scene entity仍用内部稳定引用而不把门牌拼入默认label或错误。

```js
function disclosedIdentity(match, reason, access) {
  if (access.decision !== 'allow' || !['explicit', 'ambiguity', 'audit'].includes(reason)) return null;
  return `@${storedThingIdentity(match.atom)}`;
}

const identity = disclosedIdentity(match, options.identityDisclosure, readAccess);
return { ...describePublicThing(match), ...(identity ? { identity } : {}) };
```

- [ ] **Step 4: Verify GREEN and commit**

Run: `node --test tests/atom-thing-id-disclosure.test.mjs tests/atom-language-cli-graph.test.mjs tests/atom-language-context-store.test.mjs tests/atom-thing-id-selector.test.mjs tests/browser-bridge-contract.test.js`

Run: `npx playwright test tests/browser/thing-id-address.spec.mjs --config=playwright.config.mjs`

```powershell
git add work-engine/atom-language/query-capability.mjs work-engine/atom-language/cli.mjs work-engine/atom-language/context-store.mjs work-engine/atom-language/graph-4d-projection.mjs spatial-browser-bridge.js tests/atom-language-cli-graph.test.mjs tests/atom-language-context-store.test.mjs tests/atom-thing-id-disclosure.test.mjs tests/browser/thing-id-address.spec.mjs
git commit -m "feat: show Thing ids only on explicit request"
```

### Task 6: 定向门禁、一次全量与E3部署

**Files:**
- Modify: `tests/atom-production-architecture.test.mjs`
- Modify: `tests/atom-system-performance.test.mjs`
- Modify: `tests/atom-agent-registration-path-authorization.test.mjs`
- Modify: `tests/atom-default-backup-active-boundary.test.mjs`
- Modify: `tests/atom-language-transform-p2.test.mjs`
- Modify: `tests/atom-program-shortcut.test.mjs`
- Modify: `tests/atom-projection-pipeline.test.mjs`
- Modify: `tests/atom-world-transaction.test.mjs`
- Modify: `docs/superpowers/plans/2026-09-03-atom-current-requirement-ledger.md`
- Modify: `docs/superpowers/plans/2026-09-19-program-reference-index.md`

**Interfaces:**
- Consumes: Tasks 1—5全部GREEN与Task 4 deployment receipt。
- Produces: 同一最终revision的定向、全量、冷迁移／rollback、4784回读和远端检查证据；成功后解除Program引用R5门禁。

- [ ] **Step 1: Add architecture and scale gates**

架构门禁拒绝`randomBytes`签发Thing ID、普通parser接受22字符ID、生产alias map、任一第二分配器、未授权身份披露和Program binding barrier前ID进入活动snapshot。规模门禁对12,243迁移断言稳定顺序、唯一性、线性遍历和一次binding replacement；对238,327→238,328边界断言`zzz→1000`。

```js
assert.deepEqual(await scanProductionIdentityWriters(), ['thing-id-allocator.mjs']);
assert.equal(migration.summary.activeLegacyIdentityCount, 0);
assert.equal(rebuiltBindings.generation, migration.receipt.targetRevision);
assert.equal(thingIdForOrdinal(238327), 'zzz');
assert.equal(thingIdForOrdinal(238328), '1000');
```

把普通运行测试中的22字符或带`-`伪ID机械替换为任务共享的规范短ID fixture；只有`atom-short-thing-id-migration`与deployment测试保留22字符源代，且必须显式进入`legacy-22-migration`读取器。此步只改测试身份样本，不改变测试原有业务路径、名称、权限或预期结果。

- [ ] **Step 2: Run the final targeted chain**

Run: `node --test tests/atom-thing-id*.test.mjs tests/atom-short-thing-id*.test.mjs tests/atom-program-ref-binding-ledger.test.mjs tests/atom-program-reference-index.test.mjs tests/atom-program-shortcut.test.mjs tests/atom-language-transform-p1.test.mjs tests/atom-language-transform-p2.test.mjs tests/atom-world-transaction.test.mjs tests/atom-system-failure-recovery.test.mjs tests/atom-production-architecture.test.mjs tests/atom-system-performance.test.mjs`

Run: `npm run build:browser`

Run: `npm run test:architecture`

Expected:全部PASS；`rg -n "randomBytes\(16\)|\{22\}|identityAlias" work-engine src`只命中显式迁移读取器或迁移拒绝门禁。

- [ ] **Step 3: Run the single final full gate**

Run once for the final candidate revision: `npm test`

Expected:全量PASS；Windows符号链接等平台条件skip单独记录，不把真实失败归为skip。

- [ ] **Step 4: Prove cold-copy dry-run, apply, rollback and re-apply**

从正式世界只读复制facts、journal与投影到隔离冷副本；依次执行dry-run、apply、postflight、restart、普通create取得watermark下一ID、显式rollback、旧代码／旧facts恢复启动，再以最终候选重新apply并restart。每一步保存receipt、逐文件hash、四轴语义摘要、binding generation与watermark；不得把隔离结果冒充正式部署。

- [ ] **Step 5: Deploy and read back E3**

确认正式服务停止且私有备份可恢复后，在正式世界执行一次apply；快进`main`到精确候选并受控重启4784。CLI与Web回读默认名称、`@id`精确查询、`thing~identity`审计、重名消歧、未授权拒绝、Program binding运行、Strut／Shortcut目标、allocator下一ID、health与projection published；核对12,243旧Thing全部转为短ID且无活动22字符ID或alias。

- [ ] **Step 6: Persist evidence, push and close the dependency**

把实际RED／GREEN、迁移与回退receipt位置、私有备份hash、正式revision、4784回读、一次全量和回退点写入唯一ledger；把Program引用计划S1 gate标为精确部署SHA后再允许R5。获授权后推送精确SHA并等待远端检查终态成功。

```powershell
git add tests/atom-production-architecture.test.mjs tests/atom-system-performance.test.mjs tests/atom-agent-registration-path-authorization.test.mjs tests/atom-default-backup-active-boundary.test.mjs tests/atom-language-transform-p2.test.mjs tests/atom-program-shortcut.test.mjs tests/atom-projection-pipeline.test.mjs tests/atom-world-transaction.test.mjs docs/superpowers/plans/2026-09-03-atom-current-requirement-ledger.md docs/superpowers/plans/2026-09-19-program-reference-index.md
git commit -m "test: prove short Thing id cutover"
```

## Self-Review

- **规格覆盖**：allocator、normal parser、`@id`同权限寻址、冷迁移、Program binding同代替换、私有备份／rollback、CLI／Web选择性显示和E3均有独立任务。
- **迁移边界**：旧22字符ID只由一次性migration reader读取；活动facts、binding snapshot、普通parser和查询均不保留双轨或alias。
- **接口一致**：Task 1的ordinal／watermark被Task 2—4原样消费；Task 3 migration barrier同时重置Task 2 allocator与R4 binding replay。
- **Review Focus**：五项均分别落到Task 1、Task 3、Task 4、Task 5和Task 6的可执行测试或门禁。
- **执行状态**：本计划只定义后续实施，不代表任一产品代码、迁移、全量、部署或E3已经完成。
