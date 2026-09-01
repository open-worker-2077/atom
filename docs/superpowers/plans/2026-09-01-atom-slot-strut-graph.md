# Atom Slot / Strut Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Atom Graph 以 `thing/situation/slot/strut` 单轨运行，并把实际世界原子迁移到新四轴。

**Architecture:** 在 Schema 边界先建立 3.0.0 新合同，再由同一术语贯穿存储、查询、变换、Program、权限与投影。旧轴只存在于一次性迁移输入适配器中，不能进入正常运行路径。

**Tech Stack:** Node.js 24、ES modules、Python Program worker、Node test runner、Playwright、Graph-JSON。

**Spec:** `docs/superpowers/specs/2026-09-01-atom-slot-strut-graph-design.md`

## Global Constraints

- 正常运行时只接受 `thing`、`situation`、`slot`、`strut`。
- 不建立 `contain/support` 双读、双写或兼容分支。
- 实际世界只由 Atom 官方维护事务迁移，不直接编辑 backing JSON。
- 每项生产代码变更必须先有会因缺失新行为而失败的真实测试。
- 实际迁移前必须有可校验私密备份，迁移后必须做守恒和冷启动验证。

---

### Task 1: Graph Schema 与 Graph-JSON

**Files:**
- Modify: `work-engine/atom-language/graph-schema.mjs`
- Modify: `work-engine/atom-language/key-parser.mjs`
- Modify: `work-engine/atom-language/registry.mjs`
- Modify: `work-engine/atom-language/context-store.mjs`
- Modify: `cli/lib/graph-json.mjs`
- Test: `tests/atom-graph-slot-strut.test.mjs`

**Interfaces:**
- Produces: `GRAPH_AXES = ['thing','situation','slot','strut']`、Schema `3.0.0`、新四轴解析与旧轴拒绝。

- [ ] **Step 1: Write the failing test**：创建真实 Graph-JSON，断言新四轴可解析、旧轴返回 `RETIRED_GRAPH_AXIS`、Strut 类型标记被拒绝。
- [ ] **Step 2: Run test to verify it fails**：`node --test tests/atom-graph-slot-strut.test.mjs`，预期因 `slot/strut` 未注册失败。
- [ ] **Step 3: Write minimal implementation**：替换 Schema、Key parser、字段验证与格式化结构轴。
- [ ] **Step 4: Run test to verify it passes**：重复上条命令，预期 0 failure。
- [ ] **Step 5: Commit**：提交 `feat: establish slot strut graph schema`。

### Task 2: 查询、Transform 与权限路径

**Files:**
- Modify: `work-engine/atom-language/engine.mjs`
- Modify: `work-engine/atom-language/query-capability.mjs`
- Modify: `work-engine/atom-language/transform-executor.mjs`
- Modify: `work-engine/atom-language/world-laws/*.mjs`
- Modify: `work-engine/atom-language/window-*.mjs`
- Modify: `src/atom-system/world-runtime/*.mjs`
- Test: `tests/atom-language-context-store.test.mjs`
- Test: `tests/atom-language-transform-*.test.mjs`
- Test: `tests/atom-agent-window.test.mjs`

**Interfaces:**
- Consumes: Task 1 的新四轴解析结果。
- Produces: 沿 Slot 遍历、移动、锁裁定和 Strut 端点重写的统一事务行为。

- [ ] **Step 1: Write the failing tests**：把最小 Explore、move 子树、上级窗口向下操作和 Strut 路径重写场景转换为新轴。
- [ ] **Step 2: Run tests to verify they fail**：运行对应文件，确认失败来自旧字段读取。
- [ ] **Step 3: Write minimal implementation**：将层级访问改为 Slot，将关系写入和重写改为 Strut，并删除正常路径旧轴分支。
- [ ] **Step 4: Run focused tests**：预期所列测试 0 failure。
- [ ] **Step 5: Commit**：提交 `refactor: move graph traversal to slot strut`。

### Task 3: Program ABI、槽体与调度

**Files:**
- Modify: `work-engine/atom-language/program*.mjs`
- Modify: `work-engine/atom-language/program*.py`
- Modify: `work-engine/atom-language/program-function-registry.json`
- Rename: `work-engine/atom-language/support-runtime.mjs` to `work-engine/atom-language/strut-runtime.mjs`
- Modify: `work-engine/atom-language/slot-*.mjs`
- Test: `tests/atom-program-*.test.mjs`
- Test: `tests/atom-slot-*.test.mjs`

**Interfaces:**
- Consumes: Task 2 的 Slot/Strut 世界事务。
- Produces: `transform({slot,strut})`、`trigger("strut", ...)`、Strut strict-bool delivery 与 Slot 相对槽例运行。

- [ ] **Step 1: Write failing Program tests**：验证新四轴创建、Strut 判定/交付/订阅及 Slot 槽例相对访问。
- [ ] **Step 2: Run tests to verify they fail**：确认失败分别来自旧 ABI 和旧 trigger 名。
- [ ] **Step 3: Write minimal implementation**：更名运行时、registry、worker DTO、索引和槽体内部字段。
- [ ] **Step 4: Run Program and Slot tests**：预期全部 0 failure。
- [ ] **Step 5: Commit**：提交 `refactor: migrate program abi to slot strut`。

### Task 4: Help、投影与 Web 合同

**Files:**
- Modify: `work-engine/atom-language/cli.mjs`
- Modify: `work-engine/atom-language/graph-4d-projection.mjs`
- Modify: `src/atom-system/adapters/*.mjs`
- Modify: `src/spatial-markdown-editor.mjs`
- Modify: browser Graph/Spatial modules and codecs
- Test: `tests/atom-language-cli-graph.test.mjs`
- Test: `tests/atom-language-graph-4d-projection.test.mjs`
- Test: `tests/render-contract.test.js`

**Interfaces:**
- Consumes: Tasks 1–3 的新 Graph 与 Program 合同。
- Produces: Help 唯一定义和 Slot/Strut Web 投影。

- [ ] **Step 1: Write failing boundary tests**：运行 CLI Help、投影真实 Graph 和浏览器 codec，断言用户结果只出现新轴。
- [ ] **Step 2: Run tests to verify they fail**：确认 Help 或投影仍读取旧轴。
- [ ] **Step 3: Write minimal implementation**：更新 Help、投影 DTO、空间 codec 与边标签。
- [ ] **Step 4: Run focused CLI/projection/browser tests**：预期全部 0 failure。
- [ ] **Step 5: Commit**：提交 `feat: expose slot strut through help and web`。

### Task 5: 一次性世界迁移

**Files:**
- Modify: `work-engine/atom-language/graph-migration-planner.mjs`
- Modify: `work-engine/atom-language/program-graph-abi-migration.py`
- Reuse: `src/atom-system/operations/graph-four-axis-migration.mjs`
- Reuse: `scripts/deploy-graph-four-axis-world.mjs`
- Test: `tests/atom-slot-strut-world-migration.test.mjs`

**Interfaces:**
- Consumes: 旧世界快照、备份 port、世界事务 port。
- Produces: Schema 3.0.0 世界、迁移收据和守恒摘要；不导出正常运行兼容解析器。

- [ ] **Step 1: Write failing migration tests**：用含 Program、锁、Shortcut、嵌套和关系的旧快照验证转换及失败零提交。
- [ ] **Step 2: Run tests to verify they fail**：确认迁移入口不存在。
- [ ] **Step 3: Write minimal implementation**：实现预检、备份、纯转换、守恒校验和单次事务提交。
- [ ] **Step 4: Run migration tests**：预期全部 0 failure，并验证输出无旧 Graph key。
- [ ] **Step 5: Commit**：提交 `feat: add atomic slot strut world migration`。

### Task 6: 全局收口与真实部署

**Files:**
- Modify: active tests and current Superpowers specs that expose Graph vocabulary
- Do not modify: `docs/history/**` except adding a migration provenance note when required

**Interfaces:**
- Consumes: Tasks 1–5 的完整实现。
- Produces: 新四轴代码版本与已迁移实际世界。

- [ ] **Step 1: Run active-source audit**：检查活跃产品/测试/当前规格中的旧 Graph 术语，只允许一次性迁移器输入常量和历史资料命中。
- [ ] **Step 2: Run full verification**：`npm test`、`npm run test:browser` 以及实际 `atom.cmd --help`/CLI 冷启动回读。
- [ ] **Step 3: Create and verify private backup**：记录实际世界文件哈希、长度、修订与备份位置。
- [ ] **Step 4: Execute official migration**：通过脚本调用 Atom 维护事务，随后重新启动并校验节点/关系/Program/锁守恒和 Web 投影。
- [ ] **Step 5: Commit and push**：提交剩余测试/规格，推送 `main`，再核对远端 commit 与本地 HEAD 一致。
