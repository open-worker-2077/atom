# 默认备份域活跃计算隔离 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 默认备份域完整保留可恢复权威事实，但其子树不再进入活跃 Graph、空间投影、检索索引或 Program 运行记录；恢复出域后按新 revision 自动重新激活。

**Architecture:** World Repository 继续唯一拥有完整活跃与归档事实；新增统一的显式 `backup@default` 边界判定，Graph Projector 与 Program Scheduler 只消费由该边界裁出的活跃视图。备份根保留为一个可识别恢复入口，归档子树只供 Transform 恢复路径读取，不复制到投影或第二存储。

**Tech Stack:** Node.js 24、ES modules、`node:test`、Atom 四轴 Graph、Git/Superpowers。

**Spec:** `docs/superpowers/specs/2026-08-31-atom-world-program-design.md` §4.4。

## Global Constraints

- 只认唯一显式 `thing@backup@default` 类型，不按名称猜测。
- 不删除、迁移或改写生产 Atom 事实与 `atom.json`；本次只改变派生活跃视图。
- `dsc`、`rst`、同名归档、关系与 Shortcut 恢复必须保持现有事务语义。
- 归档 Program 不执行、不进入触发／changed／Explore 依赖索引；恢复后重新进入当前合同。
- 投影是可重建副本，永远不成为恢复事实来源。

---

## 系统模型

- **权威对象**：World Repository 拥有完整 Atom facts、世界 revision、事务日志与归档恢复坐标。
- **活跃对象**：Graph Projector 拥有可重建 Graph；Program Scheduler 拥有 revision-bound 派生索引；Spatial Projector 拥有可重建 Web knowledge。
- **边界关系**：默认备份根属于活跃目录边界；其子树属于冷事实，只能被 Transform 的恢复命令读取。
- **外部参与者**：CLI、Web、Agent 与计划任务只通过 World Service 命令／查询合同访问，不直接读取归档存储。

## 合同矩阵

| 生产者 | 消费者 | 输入 | 输出 | 错误与不变量 |
|---|---|---|---|---|
| World Repository | Active Projection Boundary | 完整 immutable facts | 备份根可见、归档后代剔除的活跃视图 | 多个默认备份根继续稳定拒绝；不修改输入 |
| Active Projection Boundary | Graph Projector | 活跃 facts 与归档坐标集合 | 无归档后代、无跨备份边界关系的 Graph | 活跃非法关系仍失败；归档内容不参与校验 |
| Active Projection Boundary | Program Scheduler | 完整 facts | 只含活跃记录与备份根的 records | 归档源码不解析、不索引、不执行 |
| World Repository | Transform restore | 完整 facts、归档身份、恢复坐标 | 原子恢复后的完整 facts | 冲突安全停止；恢复后才进入活跃视图 |
| Graph Projector | Spatial/Web | 活跃 Graph | 无归档后代的 knowledge/state | 备份根至多一个节点；Web 不布局归档内容 |

## 运行与故障模型

- **冷启动**：恢复完整 facts → 计算一次备份边界元数据 → 构建活跃 Graph／Program records／Spatial；归档子树不被这些派生器递归建模。
- **归档提交**：`dsc` 原子移动完整子树并记录恢复证据 → 新 revision 的活跃派生器移除该子树。
- **恢复提交**：`rst` 从完整权威 facts 读取归档子树并原子移出 → 新 revision 的派生器重新建立其 Graph、索引与空间节点。
- **失败恢复**：边界构建或活跃投影失败不改变已提交 facts；旧投影保持可读并报告 degraded/pending，现有重建路径重试。
- **容量目标**：生产基线 12,281 个 Spatial 节点中 12,240 个位于备份域；修复后全量 Web knowledge 只保留备份根，不保留 12,240 个归档后代，且 Program records 同样不含这些后代。

## 目标结构与依赖方向

- `default-backup-boundary.mjs`：唯一边界判定与有界元数据构建，不依赖 UI、HTTP 或存储路径。
- `context-store.mjs`：消费边界元数据生成活跃 Graph，不再自行定义备份语义。
- `program-runtime.mjs`：构建 records 时在备份根停止递归。
- `legacy-projection-adapter.mjs`：类型索引在备份根停止递归；Spatial 只消费活跃 Graph。
- 依赖方向固定为 `World facts → boundary → Graph/Program → Spatial/Web`；Transform restore 只从 World facts 读取。

## Task 1: 锁定统一边界与 RED

**Files:**
- Create: `work-engine/atom-language/default-backup-boundary.mjs`
- Create: `tests/atom-default-backup-active-boundary.test.mjs`
- Modify: `tests/atom-language-context-store.test.mjs`
- Modify: `tests/atom-language-graph-4d-projection.test.mjs`
- Modify: `tests/atom-program-runtime-scheduling.test.mjs`

**Interfaces:**
- Produces: `isTypedDefaultBackup(atom): boolean`；`collectDefaultBackupBoundary(atoms): { rootPath, archivedPaths, archivedIdentities }`。
- Consumes: `parseAtomKey()` 的正式 Key 类型语义。

- [ ] **Step 1: 写入边界 RED**

```js
const records = scheduler.prepareRuntimeRecords(worldWithLargeBackup);
assert.deepEqual(records.map(({ path }) => path), ['Active', 'Default Backup']);
assert.equal(projected.graph.slot.find(isBackup).slot.length, 0);
assert.equal(spatial.nodes.some(({ atomPath }) => atomPath?.startsWith('Default Backup/')), false);
assert.deepEqual(sourceFacts, before, 'projection never mutates authoritative archive facts');
```

- [ ] **Step 2: 验证 RED**

Run: `node --test tests/atom-default-backup-active-boundary.test.mjs tests/atom-language-context-store.test.mjs tests/atom-language-graph-4d-projection.test.mjs tests/atom-program-runtime-scheduling.test.mjs`

Expected: 归档后代仍出现在 Graph、Spatial 或 runtime records 的断言失败。

- [ ] **Step 3: 实现唯一类型边界**

```js
export function isTypedDefaultBackup(atom) {
  const thing = Object.keys(atom ?? {}).find((rawKey) => parseAtomKey(rawKey, {
    descriptionSymbolWarnings: false
  }).baseKey === 'thing');
  if (!thing) return false;
  const types = new Set(parseAtomKey(thing, { descriptionSymbolWarnings: false })
    .types.map(({ name }) => name));
  return types.has('backup') && types.has('default');
}
```

- [ ] **Step 4: 单测边界类型、名称伪装、输入不变与多根拒绝**

Run: `node --test tests/atom-default-backup-active-boundary.test.mjs`

Expected: PASS。

- [ ] **Step 5: 提交 Task 1**

```bash
git add work-engine/atom-language/default-backup-boundary.mjs tests/atom-default-backup-active-boundary.test.mjs
git commit -m "test: define inactive backup boundary"
```

## Task 2: Graph 与 Spatial 停止建立归档子树

**Files:**
- Modify: `work-engine/atom-language/context-store.mjs`
- Modify: `work-engine/atom-language/graph-4d-projection.mjs`
- Modify: `src/atom-system/adapters/legacy-projection-adapter.mjs`
- Test: `tests/atom-language-context-store.test.mjs`
- Test: `tests/atom-language-graph-4d-projection.test.mjs`
- Test: `tests/atom-projection-pipeline.test.mjs`

**Interfaces:**
- Consumes: Task 1 的 `isTypedDefaultBackup` 与边界元数据。
- Produces: 备份根保留但 `slot: []`、跨边界 strut 不进入活跃 Graph、Spatial 不含归档后代。

- [ ] **Step 1: 让 context 投影在备份根停止递归**

```js
const projectedSlot = isTypedDefaultBackup(atom)
  ? []
  : slot.map((child, index) => projectAtom(child, `${location}.slot[${index}]`, rootThing, childOptions));
```

- [ ] **Step 2: 使用边界元数据过滤进入／离开归档子树的 relation**

```js
const activeStrut = value
  .filter((selector) => !isLegacyStrutEntry(selector))
  .map((selector) => projectedStrut(selector, rootThing, options.thingPathByIdentity))
  .filter((selector) => !selectorTouchesArchivedPath(selector, options.archivedPaths, rootThing));
```

- [ ] **Step 3: Spatial 与增量类型索引在备份根停止递归**

```js
const types = publicAtomTypes(atom);
if (types.includes('backup') && types.includes('default')) return;
for (const child of slotOf(atom)) visit(child, path);
```

- [ ] **Step 4: 验证 Graph、Spatial、增量投影与 Web scope 合同**

Run: `node --test --test-isolation=none tests/atom-default-backup-active-boundary.test.mjs tests/atom-language-context-store.test.mjs tests/atom-language-graph-4d-projection.test.mjs tests/atom-projection-pipeline.test.mjs tests/atom-language-graph-server.test.mjs tests/browser-bridge-contract.test.js`

Expected: PASS，且大备份夹具的 Spatial 只含备份根。

- [ ] **Step 5: 提交 Task 2**

```bash
git add work-engine/atom-language/context-store.mjs work-engine/atom-language/graph-4d-projection.mjs src/atom-system/adapters/legacy-projection-adapter.mjs tests
git commit -m "feat: exclude archived facts from active projections"
```

## Task 3: Program 记录与恢复闭环

**Files:**
- Modify: `work-engine/atom-language/program-runtime.mjs`
- Test: `tests/atom-program-runtime-scheduling.test.mjs`
- Test: `tests/atom-rename-sealed-descendants.test.mjs`
- Test: `tests/atom-program-service-e2e.test.mjs`
- Modify: `docs/superpowers/plans/2026-09-03-atom-current-requirement-ledger.md`

**Interfaces:**
- Consumes: Task 1 的显式边界判定。
- Produces: `prepareRuntimeRecords()` 只返回活跃 records 与备份根；`rst` 后恢复节点重新出现。

- [ ] **Step 1: 在 runtime records 的备份根停止递归**

```js
records.push(record);
const inactiveBackup = record.types.includes('backup') && record.types.includes('default');
if (!inactiveBackup) {
  for (const [index, child] of children.entries()) visit(child, ref, nextPath, `${address}/${index}`);
}
```

- [ ] **Step 2: 新增归档前／归档后／恢复后的记录与执行矩阵**

```js
assert.equal(activeRecords.some(({ path }) => path.endsWith('/Archived Program')), false);
assert.equal(restoredRecords.some(({ path }) => path === 'Restored Program'), true);
assert.deepEqual(restoredCycle.messages.map(({ text }) => text), ['restored']);
```

- [ ] **Step 3: 验证恢复、权限、Shortcut 与关系守恒**

Run: `node --test --test-isolation=none tests/atom-program-runtime-scheduling.test.mjs tests/atom-rename-sealed-descendants.test.mjs tests/atom-program-service-e2e.test.mjs tests/atom-program-shortcut.test.mjs`

Expected: PASS；归档不可执行，恢复后重新激活，权威 facts 与恢复身份保持。

- [ ] **Step 4: 记录生产候选容量证据**

```text
修复前：knowledge 12281 nodes；默认备份域 12240 nodes（99.67%）。
候选：默认备份根保留；其归档后代在 Graph/Spatial/runtime records 中为 0。
```

- [ ] **Step 5: 提交 Task 3**

```bash
git add work-engine/atom-language/program-runtime.mjs tests docs/superpowers/plans/2026-09-03-atom-current-requirement-ledger.md
git commit -m "feat: isolate archived facts from active runtime"
```

## Task 4: 系统验证、部署与回滚

**Files:**
- Modify: `docs/superpowers/plans/2026-09-03-atom-current-requirement-ledger.md`

**Interfaces:**
- Consumes: Tasks 1—3 的同一候选 revision。
- Produces: 聚焦、真实恢复、全量、生产回读与精确远端证据。

- [ ] **Step 1: 运行最小受影响链**

Run: `node --test --test-isolation=none tests/atom-default-backup-active-boundary.test.mjs tests/atom-language-context-store.test.mjs tests/atom-language-graph-4d-projection.test.mjs tests/atom-projection-pipeline.test.mjs tests/atom-program-runtime-scheduling.test.mjs tests/atom-rename-sealed-descendants.test.mjs`

Expected: PASS。

- [ ] **Step 2: 运行完整候选门禁**

Run: `npm test`

Expected: 0 FAIL；仅允许既有 Windows symlink 条件跳过。

- [ ] **Step 3: 在生产事实只读副本上比较投影体量**

```text
原始完整 facts 的 revision 与归档节点数不变；候选 Graph/knowledge/runtime records 不含归档后代；一次 rst 副本恢复后对应节点重新出现。
```

- [ ] **Step 4: 独立代码审查并修复所有 Critical／Important**

Run: 比较基线 SHA 与候选 SHA，审查事实守恒、跨边界关系、增量投影、Program 索引和恢复路径。

- [ ] **Step 5: 快进 main、部署 4784、回读并等待精确远端检查**

```text
health ok；Graph/knowledge 的生产 revision 与完整 facts 对应；备份后代为 0；正式入口仍可用；GitHub Actions 对精确 SHA success。
```

## 回滚与验收矩阵

- **代码回滚**：回退本候选提交后，由同一完整权威 facts 重建旧投影；无需数据迁移。
- **数据保护**：本改造不写生产 facts，不移动归档，不改变事务日志或恢复坐标。
- **行为验收**：归档不执行、恢复再激活、关系/Shortcut/身份守恒、多默认备份根拒绝。
- **性能验收**：生产规模投影不再包含 12,240 个归档后代；Graph、Spatial、Program records 三处同时为零。
- **故障验收**：边界或投影失败保持 facts 不变，旧投影可读，恢复入口不依赖 Spatial 副本。
