# Atom Startup Hot State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 4784 在监听前完成并驻留全局运行/投影热态，使首个及后续 CLI/Web 局部请求不再重新读取和清洗完整投影。

**Architecture:** `createStore()` 是 Spatial 投影的进程内唯一所有者：启动从磁盘读取并规范化一次，此后查询从驻留快照派生；命令在私有候选副本上修改，原子持久化成功后才交换驻留快照。Graph Server 只有在世界、Program/锁索引、Spatial Store 和初始备份全部准备完成后才监听，并用生产规模首请求合同证明 ready。

**Tech Stack:** Node.js 24、Node test runner、JSON 原子持久化、Atom Graph 4784。

**Spec:** `docs/superpowers/specs/2026-08-31-atom-runtime-projection-recovery-design.md` §3.1、§4.1、§6.1。

## Global Constraints

- `atom.json` 仍是唯一世界事实；Graph/Spatial 仍是可重建投影。
- 启动只从磁盘读取并规范化当前 Spatial 投影一次。
- 查询不得重新读盘或重新规范化全量投影。
- 命令不得直接修改已发布驻留快照；持久化失败时旧快照保持可读。
- 不调大浏览器超时掩盖服务端全量放大。
- 验收投影不少于 10,000 个实体，首个 health/root/deep-state 各低于 1 秒。

---

### Task 1: 驻留 Spatial 投影与 ready 验收

**Files:**
- Modify: `cli/lib/store.mjs`
- Modify: `tests/spatial-store.test.mjs`
- Modify: `tests/atom-language-graph-server.test.mjs`
- Modify: `docs/superpowers/README.md`

**Interfaces:**
- Consumes: `createStore(file).init/read/execute`。
- Produces: 启动时一次水合、查询期内存快照、写成功后原子交换，以及 10,000 实体首请求性能证据。

- [x] **Step 1: Write failing ownership and production-scale tests**

在 Store 测试中启动后破坏底层临时文件，断言 `read()` 与局部查询仍读取已驻留 revision；再注入持久化失败，断言失败命令不污染驻留快照。在 Graph Server 测试中生成 10,000 实体投影，监听后测量 health、root state 与 deep state，逐项要求低于 1 秒。

- [x] **Step 2: Run tests to verify RED**

Run: `node --test --test-isolation=none tests/spatial-store.test.mjs tests/atom-language-graph-server.test.mjs`

Expected: Store 在启动后仍重读损坏文件；生产规模首请求超过预算或发生重复全量准备。

- [x] **Step 3: Implement one owned in-memory snapshot**

`init()` 读取并规范化一次后保存快照。`read()` 返回快照的隔离副本而不访问磁盘。每个写命令从当前快照复制候选值，完成校验与原子写入后才替换快照；失败保持旧快照。

- [x] **Step 4: Verify focused and system regression**

Run: `node --test --test-isolation=none tests/spatial-store.test.mjs tests/atom-language-graph-server.test.mjs tests/atom-system-performance.test.mjs`

Run: `npm run test:system`

Expected: all PASS；10,000 实体的三个首请求均低于 1 秒。

2026-09-02 补充根因与回归证据：真实 22MB 投影的单个局部请求约 0.17—0.25 秒，但旧读取路径会为每个 scope 同步复制完整投影，16 路并发放大至 3.49 秒、24 路放大至 5.27 秒。新增 10,000 实体、约生产体量的 16 路局部并发 RED，旧实现最慢 1067.7ms；Store 增加驻留快照局部 projector 后只复制裁剪结果，聚焦回归 38/38、系统回归 219/219 通过。

- [ ] **Step 5: Deploy and verify the real 4784**

提交并快进合并到 `main`，安全重启 4784；记录健康、root state、当前深层 state 的首字节和总耗时，确认进程不再因重复全量读取持续膨胀。保留部署前 Git revision 作为代码回退点。

- [ ] **Step 6: Commit and push**

```bash
git add cli/lib/store.mjs tests/spatial-store.test.mjs tests/atom-language-graph-server.test.mjs docs/superpowers/specs/2026-08-31-atom-runtime-projection-recovery-design.md docs/superpowers/plans/2026-09-02-atom-startup-hot-state.md docs/superpowers/README.md
git commit -m "fix(runtime): retain startup spatial hot state"
git push origin main
```
