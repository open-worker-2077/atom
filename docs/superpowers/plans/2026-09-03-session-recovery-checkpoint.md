# Atom 当前开发恢复断点

**更新时间：** 2026-09-03（Slot 相邻信号 Task 4 最终评审修复完成）
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

### P1：Strut context 合同缺口

- **已有**：`antecedents[].{path,thing,situation}`、`consequents[]`和可选`transform`。
- **缺失**：当前 action envelope仅有`targetPath/action/parameter/payload/source`，没有修改轴、旧值、新值；普通 Situation `.rep.`不能据此严谨识别“未完成→已完成”。
- **裁定**：这是运行时与 Help共同缺口，不能只写文档；后续需先定义并实现权威 Transform diff/action envelope，再公开目标、轴、旧值、新值和状态跃迁合同。

### 已撤回

- **幂等**：不新增`once_per_revision`；推支应按真实状态跃迁限制重复评价。
- **本地清理**：槽例本地节点采用软停用，不作为当前缺陷。
- **纵向条目**：不再登记独立`climb`；由当前 Slot功能覆盖。

## 4. 执行状态与下一步

- **已完成提交**：`67be623`持久化规格恢复上下文；`5a3ce51`形成实施计划；`d0947a1`增加 Program ABI；`036b542`解析直接 Slot 亲属；`565e9ee`增加 receiver-owned 调度与 claim；`397ed9a`保证内部 routing nodes 不执行无匹配 trigger 的 Program，并让严格事件校验先于 prepared-index 快路；`f9aad65`完成 Task 4 原子引擎接入与公开合同；`3d24506`修复显式运行后果与 Slot receiver jump 失败原子性。
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
- **真实命令验收**：临时世界位于`C:\Users\worker\AppData\Local\Temp\atom-slot-signal-task4-20260903-01`；实际 server 首次使用临时端口61952，重启后使用59632，所有 CLI 都显式传`--endpoint`，未访问4784世界。down/up分别只改变直接子/父接收目标，未匹配、孙级、祖父级和同级目标保持`before`；消息分别为`down-payload:from,labels:up:handoff`、`up-payload:from,labels:down:report`。signal-only前后世界 SHA256 同为`59FC64A44E4BDC08C4170957D10B04CD592B00E14B0127C853140979BD2ECFAA`，回执 revision before/after 同为`130260388d03469c79ca0b8cc4bdd00999ac6a9d9d7e0c919e8b8b91f56cf7b9`。权限失败连续两次返回`GRAPH_LOCK_DENIED`/exit 4且世界 SHA不变，证明失败可重试；重启后`down-ok`/`up-ok`仍在，两个 sender 再运行仍得到正确 payload。
- **仍未完成 P0**：4784命令端队列失活的总交互预算、取消、队列释放和终态诊断仍未实现；不得把临时重启当修复。
- **恢复顺序**：
  1. 在`feat/slot-signal`回读 Task 4提交与本断点，确认工作区只剩刻意保留的任务报告。
  2. 按项目集成流程复核 Slot四个实现提交；不得在本 worktree自行 push、merge或改生产世界。
  3. Slot集成完成后，以独立规格/TDD处理 P0队列失活：先稳定复现占队列交互，再实现总预算、取消、原子回滚、queue tail释放和终态诊断。
  4. Transform context另行 brainstorming，不把旧/新值等未设计字段混入 Slot。

## 5. 其他暂停工作

- **ASDF worktree**：`D:\Project\〇\subprojects\atom\.worktrees\asdf-navigation-settings`
- **ASDF branch**：`fix/asdf-navigation-settings`
- **ASDF checkpoint**：`9277386 docs(superpowers): checkpoint asdf implementation state`
- **状态**：Task 3评审仍有P1/P2，按用户优先级暂停；不得抢占 Slot首要开发。

## 6. Git 保护

- `main`在本次记录前与`origin/main`一致，HEAD为`9280289`。
- 本轮仅新增/更新 Superpowers文档；不得把 ASDF worktree改动混入`main`。
- 提交和推送前必须运行`git diff --check`并回读实际 diff；没有验证证据不得宣称完成。
