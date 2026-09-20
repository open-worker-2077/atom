# Atom Web→CLI 单轨 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Web 只把权威语义路径与用户输入编译成规范 Atom CLI 文本，并与 CLI 共用唯一 parser、validator 和 executor。

**Architecture:** 浏览器保留 UI 草稿与回滚状态，但业务提交只发送规范 `source`。受限 Web 路由在服务器内注入人类权限与来源元数据，然后直接调用共享交互运行时；关系增删先成为 Atom Language 的原子命令，Web 不再读取并重建整段 Strut。

**Tech Stack:** Node.js 24、ES modules、Atom Language、node:test、esbuild、Playwright Chromium。

**Spec:** `docs/superpowers/specs/2026-08-31-atom-system-spine-design.md` 与 `docs/superpowers/specs/2026-08-31-atom-web-spatial-design.md`；执行状态只写回 `docs/superpowers/plans/2026-09-03-atom-current-requirement-ledger.md`。

## Global Constraints

- CLI 文本是唯一公开业务命令范式；Web 不保留第二套 Graph 语义解析。
- `humanAuthority` 只由受限服务器路由注入，请求字段不能提权。
- `origin` 进入幂等指纹，但不改变命令文本的解析含义。
- Web 热态命令不得扫描全图、读取 Graph 文件或调用投影器。
- 异步投影、后续 Program 与独立保存不重新进入来源命令关键路径。
- 新旧 Web 写入链不长期并存；回退依靠部署前精确 revision 与现有世界恢复链。
- 验证按最小受影响链、真实关键旅程、必要系统门禁、最终候选全量一次升级。
- E3 只在正式 4784 浏览器回读与精确远端检查成功后关闭。

## Review Focus

- 只有 `atomPath`、缺少一致 `key/path/id` 的投影节点仍能编辑，不再触发稳定身份错误。
- 中文、引号、反斜杠、换行和包含命令标记的正文保持逐字节语义。
- 相同 interaction id 跨 CLI/Web origin 冲突；同 origin 同 source 重试幂等。
- 关系重复新增、删除不存在关系、目标歧义和无权限均整笔失败且世界不变。
- 投影落后或目标未加载时 Web 明确拒绝并刷新，不猜路径、不退回服务端全图扫描。

---

### Task 1: CLI 原子关系增删

**Files:**
- Modify: `work-engine/atom-language/transform-key-parser.mjs`
- Modify: `work-engine/atom-language/transform-executor.mjs`
- Modify: `work-engine/atom-language/cli.mjs`
- Test: `tests/atom-language-transform-p1.test.mjs`
- Test: `tests/atom-language-transform-batch.test.mjs`
- Test: `tests/atom-access-engine.test.mjs`

**Interfaces:**
- Consumes: exact Thing selector、现有 Strut 永久端点身份与中央 Transform 事务。
- Produces: `transform {"thing":"SRC","strut.add.":{"thing":"DST"}}` 和 `transform {"thing":"SRC","strut.dsc.":{"thing":"DST"}}`；只增删 owner-local 无条件出边，不替换其他 clause。

- [ ] **Step 1: Write failing relation tests**

```js
const added = await execute('transform {"thing":"域/源","strut.add.":{"thing":"域/目标"}}');
assert.equal(added.ok, true);
const duplicate = await execute('transform {"thing":"域/源","strut.add.":{"thing":"域/目标"}}');
assert.equal(duplicate.errors[0].code, 'DUPLICATE_STRUT_RELATION');
```

同时覆盖删除不存在关系、批次中途失败回滚、锁拒绝、目标改名后按 ID 删除。

- [ ] **Step 2: Verify RED**

Run: `node --test tests/atom-language-transform-p1.test.mjs tests/atom-language-transform-batch.test.mjs tests/atom-access-engine.test.mjs`

Expected: 新命令未注册或仍返回 `INVALID_STRUT_TRANSFORM`；失败例 revision 不变。

- [ ] **Step 3: Implement minimal atomic commands**

为 `strut` 注册 `add` 与 `dsc`；Value 必须恰有一个 exact `thing`。复用现有端点解析、ID 绑定、关系校验、权限和事务回滚；重复新增返回 `DUPLICATE_STRUT_RELATION`，不存在删除返回 `STRUT_RELATION_NOT_FOUND`。

- [ ] **Step 4: Verify GREEN and Help**

Run: `node --test tests/atom-language-transform-p1.test.mjs tests/atom-language-transform-batch.test.mjs tests/atom-access-engine.test.mjs`

Run: `atom.cmd --help`

Expected: tests PASS；Help 精确公开两条命令。

- [ ] **Step 5: Commit**

```powershell
git add work-engine/atom-language/transform-key-parser.mjs work-engine/atom-language/transform-executor.mjs work-engine/atom-language/cli.mjs tests/atom-language-transform-p1.test.mjs tests/atom-language-transform-batch.test.mjs tests/atom-access-engine.test.mjs
git commit -m "feat: add atomic strut relation commands"
```

### Task 2: 浏览器纯 CLI 文本映射器

**Files:**
- Create: `src/atom-system/browser-command-mapper.mjs`
- Modify: `src/atom-system/browser-entry.mjs`
- Modify: `spatial-workspace-model.js`
- Test: `tests/atom-web-command-mapper.test.mjs`
- Test: `tests/spatial-workspace-model.test.js`

**Interfaces:**
- Consumes: 投影提供的 `atomPath`、UI operation 和表单草稿。
- Produces: `createBrowserCommandMapper()`，提供 `replaceKnowledge(knowledge)` 与 `compile(operation)`；后者返回冻结的 `{source, operationKind, affectedAtomPaths}`。

- [ ] **Step 1: Write failing mapper tests**

```js
const mapper = createBrowserCommandMapper();
mapper.replaceKnowledge({ nodes: [{ atomPath: '域/节点', label: '节点', id: 'id-only' }], edges: [] });
assert.equal(mapper.compile({
  kind: 'node-edit', node: { atomPath: '域/节点' },
  draft: { label: '新名', description: '正文', atomTypes: [] }
}).source, 'transform {"thing.ren.新名":"域/节点","situation.rep.正文"}');
```

覆盖创建、编辑、改名、移动、批量移动、关系增删、删除、特殊字符、冻结输入和目标未加载。

- [ ] **Step 2: Verify RED**

Run: `node --test tests/atom-web-command-mapper.test.mjs tests/spatial-workspace-model.test.js`

Expected: mapper 不存在；截图同构夹具无法生成 source。

- [ ] **Step 3: Implement mapper and preserve semantic coordinates**

`replaceKnowledge()` 每次权威投影只建立一次 `node key → atomPath` 与 `spatial container → atomPath` 索引；`compile()` 只读索引，不遍历 `knowledge.nodes`。Workspace snapshot 保留只读 `atomPath`，不再以 `path::id` 重建业务身份。

- [ ] **Step 4: Verify GREEN**

Run: `node --test tests/atom-web-command-mapper.test.mjs tests/spatial-workspace-model.test.js`

Expected: PASS；未加载目标返回 `WEB_COMMAND_TARGET_UNRESOLVED`；输入对象保持冻结不变。

- [ ] **Step 5: Commit**

```powershell
git add src/atom-system/browser-command-mapper.mjs src/atom-system/browser-entry.mjs spatial-workspace-model.js tests/atom-web-command-mapper.test.mjs tests/spatial-workspace-model.test.js
git commit -m "feat: compile web edits into Atom CLI text"
```

### Task 3: 共享 Web 文本入口与权限边界

**Files:**
- Modify: `cli/lib/server.mjs`
- Modify: `work-engine/atom-language/graph-server.mjs`
- Modify: `src/atom-system/public/interaction-runtime.mjs`
- Test: `tests/atom-web-cli-ingress.test.mjs`
- Test: `tests/atom-language-graph-server.test.mjs`
- Test: `tests/atom-interaction-runtime.test.mjs`

**Interfaces:**
- Consumes: `{source, interaction:{id}}`。
- Produces: `POST /__atom/api/web-command`；服务器固定注入 `{origin:'web', humanAuthority:true, programMode:'reconcile'}`，最终调用共享 `interactionRuntime.execute()`。

- [ ] **Step 1: Write failing ingress and authority tests**

```js
const web = await post('/__atom/api/web-command', {
  source: 'transform {"thing":"域/节点","situation.rep.新"}',
  interaction: { id: 'web-1' }, humanAuthority: false, origin: 'cli'
});
assert.equal(web.result.ok, true);
assert.equal(observed.origin, 'web');
assert.equal(observed.humanAuthority, true);
```

同时证明普通 `/command` 无 Agent 仍失败，客户端字段不能提权，同 origin 重试复用，跨 origin 同 ID 冲突。

- [ ] **Step 2: Verify RED**

Run: `node --test tests/atom-web-cli-ingress.test.mjs tests/atom-language-graph-server.test.mjs tests/atom-interaction-runtime.test.mjs`

Expected: `/web-command` 404 或幂等指纹未隔离 origin。

- [ ] **Step 3: Implement one text execution core**

抽取共享 handler core；CLI 入口只解析真实 Agent，Web 入口只由服务器注入人类权限。幂等指纹固定包含 `{origin,source,agent,agentSelector,history}`；保留 AbortSignal、`onCommitted` 和 `onSubsequentSettled`。

- [ ] **Step 4: Verify GREEN**

Run: `node --test tests/atom-web-cli-ingress.test.mjs tests/atom-language-graph-server.test.mjs tests/atom-interaction-runtime.test.mjs`

Expected: PASS；每个命令 parser、validator、executor 各调用一次。

- [ ] **Step 5: Commit**

```powershell
git add cli/lib/server.mjs work-engine/atom-language/graph-server.mjs src/atom-system/public/interaction-runtime.mjs tests/atom-web-cli-ingress.test.mjs tests/atom-language-graph-server.test.mjs tests/atom-interaction-runtime.test.mjs
git commit -m "refactor: route web text through shared command runtime"
```

### Task 4: 浏览器切换并删除旧语义链

**Files:**
- Modify: `spatial-browser-bridge.js`
- Modify: `src/atom-system/adapters/legacy-runtime-composition.mjs`
- Modify: `src/atom-system/public/interaction-runtime.mjs`
- Modify: `cli/lib/server.mjs`
- Modify: `work-engine/atom-language/graph-server.mjs`
- Modify: `docs/architecture/atom-capability-graph.json`
- Test: `tests/browser-bridge-contract.test.js`
- Test: `tests/atom-legacy-runtime-composition.test.mjs`
- Test: `tests/atom-production-architecture.test.mjs`
- Test: `tests/atom-system-boundaries.test.mjs`

**Interfaces:**
- Consumes: Task 2 mapper 与 Task 3 `/web-command`。
- Produces: 所有 Web 世界编辑请求体仅含 `source + interaction`；删除 `/workspace-edit`、`/human-status`、`createLegacyHumanWorkspaceTranslator()`、`updateHumanWorkspace()` 和 `updateHumanStatus()`。

- [x] **Step 1: Write failing bridge and architecture tests**

固定截图根因：导入节点只有 `atomPath`，编辑后必须向 `/web-command` 发送规范 source。架构测试拒绝旧 route、translator、服务端 `operation.kind` 分派和写前 Graph 文件读取。

- [x] **Step 2: Verify RED**

Run: `node --test tests/browser-bridge-contract.test.js tests/atom-legacy-runtime-composition.test.mjs tests/atom-production-architecture.test.mjs tests/atom-system-boundaries.test.mjs`

Expected: 旧链仍存在且测试失败。

- [x] **Step 3: Cut over without dual-write**

Bridge 初始化和每次权威 state 更新调用 `replaceKnowledge()`；提交时只 POST source。保留草稿、回滚、保存反馈、projection pending 和持久化回执对账；删除所有 Web 专属业务翻译与旧 route。

- [x] **Step 4: Verify GREEN and absence gate**

Run: `node --test tests/browser-bridge-contract.test.js tests/atom-legacy-runtime-composition.test.mjs tests/atom-production-architecture.test.mjs tests/atom-system-boundaries.test.mjs`

Run: `rg -n "Web edit requires one stable node identity|/__atom/api/workspace-edit|/__atom/api/human-status|createLegacyHumanWorkspaceTranslator|updateHumanWorkspace" src cli work-engine spatial-browser-bridge.js`

Expected: tests PASS；生产代码检索无命中。

- [x] **Step 5: Commit**

```powershell
git add spatial-browser-bridge.js src/atom-system/adapters/legacy-runtime-composition.mjs src/atom-system/public/interaction-runtime.mjs cli/lib/server.mjs work-engine/atom-language/graph-server.mjs docs/architecture/atom-capability-graph.json tests/browser-bridge-contract.test.js tests/atom-legacy-runtime-composition.test.mjs tests/atom-production-architecture.test.mjs tests/atom-system-boundaries.test.mjs
git commit -m "refactor: retire web-specific command translation"
```

### Task 5: CLI/Web 同构、性能与 E3 收口

**Files:**
- Create: `tests/browser/web-cli-parity.spec.mjs`
- Create: `scripts/accept-web-cli-parity.mjs`
- Modify: `tests/atom-system-performance.test.mjs`
- Modify: `docs/superpowers/plans/2026-09-03-atom-current-requirement-ledger.md`

**Interfaces:**
- Consumes: 同一初始世界副本与同一 source 序列。
- Produces: CLI/Web parser 结果、最终四轴事实、失败错误码、失败后哈希和分段延迟对比报告。

- [ ] **Step 1: Write failing parity and performance journey**

真实浏览器依次执行创建、正文编辑、改名、移动、关系新增、关系删除、Thing 删除；CLI 在隔离副本执行浏览器捕获的相同 source。加入 12,500 个无关 Thing，记录 `uiMapMs/sharedCommandMs/roundTripMs/feedbackMs`。

- [ ] **Step 2: Verify RED**

Run: `node --test tests/atom-system-performance.test.mjs`

Run: `npx playwright test tests/browser/web-cli-parity.spec.mjs --project=chromium`

Expected: 现有 Web 协议不同或缺少分段性能证据。

- [ ] **Step 3: Meet the bounded performance contract**

`replaceKnowledge()` 只在线性投影导入时执行；热态 `compile()` p95 ≤ 5ms；30 次本机样本中 Web `sharedCommandMs` p95 ≤ CLI p95 × 1.10 + 5ms；网络与信封 p95 ≤ 50ms；保存开始反馈 ≤ 100ms；每命令 parser/validator/executor 各一次。

- [ ] **Step 4: Escalate verification once per revision**

Run: `node --test tests/atom-language-transform-p1.test.mjs tests/atom-language-transform-batch.test.mjs tests/atom-access-engine.test.mjs tests/atom-web-command-mapper.test.mjs tests/atom-web-cli-ingress.test.mjs tests/atom-language-graph-server.test.mjs tests/atom-interaction-runtime.test.mjs tests/browser-bridge-contract.test.js tests/atom-production-architecture.test.mjs tests/atom-system-boundaries.test.mjs tests/atom-system-performance.test.mjs`

Run: `npm run build:browser`

Run: `npx playwright test tests/browser/web-cli-parity.spec.mjs tests/browser/save-feedback.spec.mjs --project=chromium`

Run: `npm run check:development-control`

Final candidate only: `npm test`

- [ ] **Step 5: Prepare rollback, deploy and read back**

记录部署前精确 commit、浏览器 build fingerprint、4784 health/revision 与生产 `atom.json` SHA-256；按既有监督任务受控重启。运行 `node scripts/accept-web-cli-parity.mjs --endpoint http://127.0.0.1:4784 --public-smoke`，验证 F5/重启一致且验收事实进入可恢复备份。

- [ ] **Step 6: Persist and close remote evidence**

把 RED、GREEN、候选 SHA、build fingerprint、性能 p50/p95、4784 回读和回退点写回唯一总账。获推送授权后执行 `git push origin main`，以 `git rev-parse HEAD` 取得精确 SHA，再用 `gh run list --commit` 与 `gh run watch --exit-status` 等待终态。

- [ ] **Step 7: Commit evidence**

```powershell
git add tests/browser/web-cli-parity.spec.mjs scripts/accept-web-cli-parity.mjs tests/atom-system-performance.test.mjs docs/superpowers/plans/2026-09-03-atom-current-requirement-ledger.md
git commit -m "test: prove web and CLI command parity"
```

## Self-Review

- 规格覆盖：唯一文本入口、Web 人工权限、关系原子命令、身份故障、效率同构、失败守恒、正式部署均有任务。
- 类型一致：`createBrowserCommandMapper()` 与 `/__atom/api/web-command` 仅在一个任务定义，后续任务原样消费。
- 迁移边界：没有长期双写或数据格式迁移；回退使用精确代码 revision，世界事实由现有可逆 Transform 处理。
- Review Focus 五项均在 Task 1—5 有明确测试。
