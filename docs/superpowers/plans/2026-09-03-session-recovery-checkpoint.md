# Atom 当前开发恢复断点

**更新时间：** 2026-09-03（Slot 相邻信号 relocation closure 已完成并留存重启证据）
**权威分支：** `main`  
**记录前 HEAD：** `9280289`  
**当前实现分支：** `feat/slot-signal`；隔离 worktree 为 `D:\Project\〇\subprojects\atom\.worktrees\slot-signal`
**用途：** 新 Session 不依赖聊天历史，按本文恢复当前用户定论、证据与执行顺序。

## 1. 当前唯一首要功能

- **目标**：优先开发 Slot 相邻层级信号；权威规格为[`../specs/2026-09-03-atom-slot-signal-design.md`](../specs/2026-09-03-atom-slot-signal-design.md)。
- **发送**：`slot({"to":"up|down","labels":[...]})`；`up`到唯一直接父节点，`down`广播给全部直接子节点。
- **接收**：接收节点自己的 Program用`trigger("slot", {"from":"up|down","labels":[...],"match":"all|exact"}, fn)`决定是否运行。
- **取信号**：回调内用标准内建`signal()`取得当前 invocation-local `{"from", "labels"}`；触发域外调用报错。
- **关系限制**：不新增`climb`或第五种 Graph轴；公开 API不提供任意目标、路径、跨层或同级表达；不写“横向稳定拒绝”这类不存在入口的验收。
- **传导限制**：信号不写事实、不自动续传、不授予权限；接收 Program effects仍走现有鉴权和中央原子事务。

## 2. Strut 已形成的纠偏定论

- **Graph 决定后项**：推支线或复核推支线的 clause结构决定 true传给哪些下游，Program不得再次声明或选择下游。
- **Program 只判定**：Strut `if`内嵌 Program只读取前项与动作上下文并返回严格布尔值。
- **后项自己触发**：true送达后，由后项自己的 Program是否声明`trigger("strut", ...)`决定是否运行。
- **`nodes`应退役**：现有`trigger("strut", {"nodes":[...]}, ...)`是设计赘余。Slot首版绝不复制；Strut清除`nodes`另建一次性迁移，因为现有共享槽模 Program仍有依赖，不能暗中保留双轨兼容。

## 3. 开发前现场裁定

### P0：4784 命令端失活

- **已复现**：`http://127.0.0.1:4784/__spatial/api/health`快速返回；最简单的`explore 🧊manage`超过30秒无输出。
- **已确认结构**：`cli/lib/server.mjs`以单一`atomInteractionTail`串行写交互，Explore等待该写尾；未收敛写入可阻塞全部后续命令，health因绕过队列仍可正常。
- **预算缺口**：Program Scheduler每轮预算10秒，但 reconciliation最多8轮；尚无已证实的整个交互总截止、取消、队列释放和终态诊断。
- **证据边界**：队列占用与总边界缺口已确认；具体是哪一个 Program/循环不收敛尚未定位。
- **修复判据**：TDD复现后加入总预算、失败收口、原子回滚、队列释放和终态诊断。重启4784只恢复现场，不算修复。

### Strut context 边界纠偏

- **已有**：`antecedents[].{path,thing,situation}`、`consequents[]`和规范化`transform`动作信封。
- **业务职责**：业务使用方决定是否发起 Transform；Strut内嵌 Program依据当前前项事实和本次动作返回 strict bool。内核不判断新旧值是否相同，也不替业务决定是否操作。
- **裁定**：撤回旧值、新值和状态跃迁合同开发项；除非出现当前事实与动作信封确实无法表达的具体业务证据，否则不扩张内核。

### 已撤回

- **幂等**：不新增`once_per_revision`；是否 Transform及是否推支由业务侧按当前事实与动作语义决定。
- **本地清理**：槽例本地节点采用软停用，不作为当前缺陷。
- **纵向条目**：不再登记独立`climb`；由当前 Slot功能覆盖。

## 4. 执行状态与下一步

- **已完成提交**：`67be623`持久化规格恢复上下文；`5a3ce51`形成实施计划；`d0947a1`增加 Program ABI；`036b542`解析直接 Slot 亲属；`565e9ee`增加 receiver-owned 调度与 claim；`397ed9a`保证内部 routing nodes 不执行无匹配 trigger 的 Program，并让严格事件校验先于 prepared-index 快路；`f9aad65`完成 Task 4 原子引擎接入与公开合同；`3d24506`修复显式运行后果与 Slot receiver jump 失败原子性。Relocation closure 的代码提交为`b01bf20`、`e4c54b6`、`1b63956`、`6c3e2f1`、`585ac72`、`fc7f7f8`、`fb2e1d4`。
- **Task 4 评审修复 round 1**：`3d24506`把显式`.run.`的 sender Transform 与 Slot 事件一起送入完整候选事务队列，并让 Slot claim 周期中的 jump authorization/jump 失败阻断回滚。
- **Task 4 最终评审修复**：本文件所在提交将 Slot effect 延后到 cycle 结构 effect 应用后的候选世界解析，并按 relocation 改写 sender path；结构 co-effect 时先排 Transform 刷新事件、后排 Slot 投递，使普通 Transform trigger 与显式`.run.`在 receiver 改名/移动后一致。`SLOT_SIGNAL_REQUIRED`现在会阻断并回滚显式运行与调和 cycle；`use_program()`的 Slot sender 身份保留为实际 referenced Program path；Slot callback 对 positional-only、普通位置、vararg、keyword-only 和 kwarg 都要求真正零参数。
- **Task 4 验证**：
  - 原 Task 4 的真实顺序为：首次聚焦`44/44 PASS`；随后增强“同一 sender 同时发 Transform 与 Slot”后 E2E `4/4 PASS`；最后重新运行完整聚焦集并得到`44/44 PASS`。此前把最终 44/44 写在增强之前，现已纠正。
  - 评审修复 RED：E2E 共6项，`3 pass / 3 fail`；失败精确对应 Transform observer 未执行、Slot receiver jump authorization 错误被降级、Slot receiver jump 错误被降级。
  - 评审修复 GREEN：E2E `6/6 PASS`；最终聚焦集`46/46 PASS`。共存用例同时验证 Transform observer、Transform 触发的 Strut subscriber、Slot receiver，并确认 Strut/Slot claims 都为`confirmed`。
  - Program/Strut/jump 相关回归选择集共182项，修正受控 jump 事件边界后全部通过、exit 0；受控 jump 与 E2E 交叉集`15/15 PASS`。
  - `npm run test:system`：220/220 PASS，0 fail，duration 50163.5484 ms。
  - `npm test`：1642/1642 PASS，0 fail，duration 467236.6105 ms；构建只机械刷新`index.html` build-id，已恢复且未纳入提交。
  - `git diff --check`：0 error。
  - 最终评审 RED：`node --test --test-isolation=none tests/atom-slot-signal-e2e.test.mjs tests/atom-slot-signal-scheduling.test.mjs`得到`29 tests / 21 pass / 8 fail`，duration 19414.0787 ms；失败精确覆盖普通 trigger 改名/移动丢投递、两类越界`signal()`、CLI exit、referenced sender 身份与两种隐藏参数。
  - 最终评审 GREEN：同一命令`29/29 PASS`，duration 18419.7105 ms；Slot/runtime/registry 聚焦集`57/57 PASS`，duration 19247.7115 ms。
  - Program/Strut/jump 相关回归`182/182 PASS`，duration 113358.8231 ms；`npm run test:system`为`220/220 PASS`，duration 49762.7958 ms；`npm test`为`1653/1653 PASS`，duration 502129.4535 ms。
  - 全量构建只机械刷新`index.html` build-id，已恢复且未纳入提交；Node syntax、Python AST、`git diff --check`全部通过。
  - Task 1 延后 Minor 现有专用回归`cached producers never replay slot signals and mixed cycles include only uncached producers`：完全缓存 cycle 返回零 Slot effect，混合 cycle 只聚合未缓存 producer。
- **Relocation closure 范围裁定与修复**：原 Task 2 计划只允许写恢复断点，但强制验收连续暴露三个可复现的生产合同缺陷；控制方逐项把范围最小扩展为 TDD 修复，未开放公共 API 或 schema。
  - `585ac72`修复 retained jump authorization retry：只有`refreshPreparedTriggerOwnership`安装的私有 dependency-owner marker 可以触发无 previous result 的强制执行；marker 与 ownership 状态一起 clone、prune、consume，普通 uncached dependency 仍保持 dormant。修复前相关选择集`183 tests / 182 pass / 1 fail`，duration `131106.9192 ms`；隔离失败`0/1`，duration `5697.929 ms`；聚焦 RED `0/2`，duration `5619.6462 ms`；GREEN `3/3`，duration `6279.3173 ms`。
  - `fc7f7f8`修复单 Transform 本地 patch 漏掉 Program 变更路径：`reconcileProgramsForWorld`在所有出口只返回 authoritative result 中`changed === true`的 Program Transform path，single-transform commit 与既有 changed paths 合并。修复前 system 为`222 tests / 221 pass / 1 fail`，duration `52139.7494 ms`；隔离 RED `0/1`，duration `445.7345 ms`；GREEN `1/1`，duration `540.1589 ms`。
  - `fb2e1d4`修复 graph-server/persisted prepared-index 冷启动时显式 sender 或祖先改名丢 Slot：在首次 Slot delivery 入队/消费前，显式运行分支只用 candidate scheduler 的私有`refreshPreparedTriggerOwnership(application.atoms, initialProgramRelocations)`更新 trigger/read ownership，不调度业务 effect，也不重放 sender。忠实 prepared-projection RED 为`0/3`，duration `3635.543 ms`；GREEN 为`3/3`，duration `4767.5647 ms`。
  - 三处均为高传播面内部路径：GitNexus 影响分析分别给出 CRITICAL；最终实现仍受现有 Agent 鉴权、中央事务、Slot claim 与 FIFO 回归约束。范围没有扩展到其他具体不变量。
- **Relocation closure 最终自动验证**：
  - Program/Strut/Slot/jump 既定选择集：`184/184 PASS`，0 fail，duration `127906.5899 ms`。
  - `npm run test:system`：`222/222 PASS`，0 fail，duration `58734.8058 ms`。
  - `npm test`：`1666/1666 PASS`，0 fail，duration `544539.9057 ms`。此前在`fc7f7f8`后的首轮全量仅有既存负载敏感 compactness 阈值在`1338.8 ms > 1300 ms`失败（`1665/1666`，duration `542507.1049 ms`）；隔离立即通过`1/1`，test duration `832.3033 ms`、run duration `928.6978 ms`，随后同一代码全量通过`1666/1666`，duration `511916.125 ms`，最终`fb2e1d4`后再得到上述全绿结果。
  - 一次未授权 sandbox 重跑因所有 worker `spawn EPERM`形成广泛伪失败，改用允许测试 worker spawn 的同一命令后全绿；这不是产品失败。全量构建只机械刷新`index.html` build hash（`b2e38876e9d0a48b`→`dafc7ae149a147eb`），已核对并恢复；`git diff --check`为0 error。
- **Relocation closure 真实命令验收**：
  - 修复前证据保留在`C:\Users\worker\AppData\Local\Temp\atom-slot-relocation-task2-20260903-01`，临时端口`50765`。Cascade 已命中最终 receiver，但显式 sender 改名和祖先改名只提交 relocation、receiver target 仍为`before`，从而触发`fb2e1d4`修复；server 已停止，fixture 未删除。
  - 最终证据保留在`C:\Users\worker\AppData\Local\Temp\atom-slot-relocation-task2-20260903-02`。首次 server 使用 OS 分配端口`61222`：显式 sender 改名、显式祖先改名、级联 receiver 改名/移动三条真实 CLI 命令各只输出一次最终路径消息；三个正确 target 均为`delivered`，四个 wrong/collision target 均为`before`，复制/中间/新邻居节点未截获。
  - 停止`61222`并确认 health 不可达后，以同一`atom.json`重启到新端口`50443`，不重放 sender；三个正确 target、四个错误 target及五个 final/collision Program path 全部从磁盘回读一致。重启前后`atom.json` SHA256均为`A47DE87CA0718C27963367715D75807C0729E42CA251811B7F80A5EE5C6FD4E1`。`50443`也已停止并确认不可达；两个 fixture 均保留。
  - 所有 CLI 都显式传`--endpoint`和`--agent Verifier`；未访问、重启或修改 live 4784，没有生产世界、remote、push或merge操作。
- **真实命令验收**：临时世界位于`C:\Users\worker\AppData\Local\Temp\atom-slot-signal-task4-20260903-01`；实际 server 首次使用临时端口61952，重启后使用59632，所有 CLI 都显式传`--endpoint`，未访问4784世界。down/up分别只改变直接子/父接收目标，未匹配、孙级、祖父级和同级目标保持`before`；消息分别为`down-payload:from,labels:up:handoff`、`up-payload:from,labels:down:report`。signal-only前后世界 SHA256 同为`59FC64A44E4BDC08C4170957D10B04CD592B00E14B0127C853140979BD2ECFAA`，回执 revision before/after 同为`130260388d03469c79ca0b8cc4bdd00999ac6a9d9d7e0c919e8b8b91f56cf7b9`。权限失败连续两次返回`GRAPH_LOCK_DENIED`/exit 4且世界 SHA不变，证明失败可重试；重启后`down-ok`/`up-ok`仍在，两个 sender 再运行仍得到正确 payload。
- **仍未完成 P0**：4784命令端队列失活的总交互预算、取消、队列释放和终态诊断仍未实现；不得把临时重启当修复。
- **恢复顺序**：
  1. 在`feat/slot-signal`回读 Slot Task 4、relocation closure 七个代码提交与本断点，确认工作区只剩刻意保留的任务报告。
  2. 按项目集成流程复核 Slot实现提交；不得在本 worktree自行 push、merge或改生产世界。
  3. Slot集成完成后，以独立规格/TDD处理 P0队列失活：先稳定复现占队列交互，再实现总预算、取消、原子回滚、queue tail释放和终态诊断。
  4. Strut后续只按已持久化的 Graph 定论推进：Graph决定后项，内嵌`if` Program判定 strict bool，后项自己的 Trigger决定响应；不得重新引入旧/新值内核判断。

## 5. 其他暂停工作

- **ASDF worktree**：`D:\Project\〇\subprojects\atom\.worktrees\asdf-navigation-settings`
- **ASDF branch**：`fix/asdf-navigation-settings`
- **ASDF checkpoint**：`9277386 docs(superpowers): checkpoint asdf implementation state`
- **状态**：Task 3评审仍有P1/P2，按用户优先级暂停；不得抢占 Slot首要开发。

## 6. Git 保护

- `main`在本次记录前与`origin/main`一致，HEAD为`9280289`。
- 本轮仅新增/更新 Superpowers文档；不得把 ASDF worktree改动混入`main`。
- 提交和推送前必须运行`git diff --check`并回读实际 diff；没有验证证据不得宣称完成。
