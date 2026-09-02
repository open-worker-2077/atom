# Atom 当前开发恢复断点

**更新时间：** 2026-09-03（ChatGPT 软件更新前）  
**权威分支：** `main`  
**记录前 HEAD：** `9280289`  
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

- **已完成**：Slot规格、恢复断点与 README入口已由本地提交`67be623`持久化。
- **计划已形成**：实施计划见[`2026-09-03-atom-slot-signal.md`](2026-09-03-atom-slot-signal.md)；生产代码、Slot功能 worktree与测试尚未开始。
- **恢复顺序**：
  1. 运行`atom.cmd --help`并读取本文件及 Slot规格。
  2. 检查`git status --short --branch`与`git log -5 --oneline --decorate`。
  3. 校验两份文档无缺失后提交本次规格/断点。
  4. 按[`2026-09-03-atom-slot-signal.md`](2026-09-03-atom-slot-signal.md)建隔离 worktree，使用 `executing-plans`逐任务执行。
  5. 按 TDD先写 Slot RED，再实现、评审、验证；每个任务独立提交。
  6. Slot完成后处理 P0队列失活；Transform context另行 brainstorming，不把未设计字段顺手塞入 Slot。

## 5. 其他暂停工作

- **ASDF worktree**：`D:\Project\〇\subprojects\atom\.worktrees\asdf-navigation-settings`
- **ASDF branch**：`fix/asdf-navigation-settings`
- **ASDF checkpoint**：`9277386 docs(superpowers): checkpoint asdf implementation state`
- **状态**：Task 3评审仍有P1/P2，按用户优先级暂停；不得抢占 Slot首要开发。

## 6. Git 保护

- `main`在本次记录前与`origin/main`一致，HEAD为`9280289`。
- 本轮仅新增/更新 Superpowers文档；不得把 ASDF worktree改动混入`main`。
- 提交和推送前必须运行`git diff --check`并回读实际 diff；没有验证证据不得宣称完成。
