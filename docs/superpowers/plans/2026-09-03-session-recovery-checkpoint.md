# Atom 当前开发恢复断点

**更新时间：** 2026-09-04（ESG测试域Program创建超时进入P0调试）
**权威分支：** `main`
**当前远程交付：** `main@f2d2fd0`；A模式改构前回退标签`pre-a-mode-consolidation-20260904`
**历史实现分支：** `feat/slot-signal`已指向`ead30e2`，不再是待集成分支
**用途：** 新 Session 不依赖聊天历史，按本文恢复当前用户定论、证据与执行顺序。

**当前排队权威：** [`2026-09-03-atom-current-requirement-ledger.md`](2026-09-03-atom-current-requirement-ledger.md)。本文下方保留大量实施证据，但凡状态或顺序与总账冲突，以总账和当前Git／验证证据为准并立即校准本文。

## 0. 当前恢复结论（覆盖下文历史阶段描述）

- **08时巡守断点**：隔离`fix/esg-program-create-timeout`新增恢复历史按需加载：普通读写不再克隆日志，35/35事务／恢复回归通过；真实规模副本读取仍4393ms，因此不是主瓶颈，P0延迟仍未关闭且本项未部署。证据目录`atom-real-write-acceptance-XKvkiQ`；下一步定位engine初始Program周期之后的剩余耗时。主账本已同步，避免重复已排除假设。巡守提示已移除固定过期故障顺序；目标栏仍受产品接口限制。

- **06时性能部署**：`main@61343ca`（含`20e91e2`锁分类）已部署4784；health revision7306投影published，生产候选精确读取569ms、世界修订未变。真实规模副本写后读取从7.6—8.5秒降为4.6秒、创建4.1秒，仍留写后延迟优化项，不宣称全关闭。完整证据在总账“性能改善已部署”；源码／模式／权限／结构失效回归通过，不删减任何指纹语义。下一步继续定位写后读取余下阶段，工单公开参数文档缺口随后补齐，再按队列推进。
- **慢读续接点**：生产`27c9211`保持不变。隔离`fix/esg-program-create-timeout@7f8e825`保存锁动作分类复用，57/57权限矩阵通过但读仍7.6秒，未部署。调度器新建假设已排除并撤回候选。CPU证据及下一步Program语义指纹重复计算分析见总账“慢读当前断点”，不重复已跑全量、不把局部改善称为慢读关闭。
- **2026-09-04回执最新部署**：`main@27c9211`将完整提交回执提前到Program派生投影收尾之前，并在通知前刷新Agent解析修订清单，避免立即回读修订不匹配。真实规模隔离创建4076ms、读取8302ms、回滚与重启通过；受影响测试44/44、组合／投影58/58、HTTP5/5通过。4784已受控重启，health revision7305投影published，公开CLI精确回读候选成功。生产写入待观察，读取与派生收尾性能未关闭；不得从旧“创建均未提交”描述推断当前状态。每小时巡守提示已更新，总目标正文在总账；产品目标栏仍受接口限制保持旧blocked，不影响执行。
- **最新P0断点**：`main@5916883`声明检查复用修复已部署4784；隔离当前世界创建7414ms、回读239ms且回滚／重启／源文件不变验收通过，最终全量1704/1704、合入最小链8/8通过。受控重启后PID46140、health revision7289投影published，公开CLI回读test成功。生产创建待现场验证；普通批量写入已提交但超时回执仍未解决。跨任务回信被平台审查拒绝，需用户明确允许通知指定ESG任务，不绕过、不据此停止开发。
- **🟠 当前P0——Program创建超时**：`🧊manage/包办/判重/ESG计划/test`连续创建最小`thing@program`均在15秒返回`ATOM_INTERACTION_TIMEOUT`且精确回读`ATOM_NOT_FOUND`；`work_order_catalog(...)`与仅`return True`两种Situation都失败，而同域普通14节点Graph约6秒成功。故障目前收束在Program创建链，按系统调试先查根因，再以RED／GREEN和真实CLI回读收口；不得只提高超时。
- **✅ Slot相邻信号**：已完成、集成、部署；`slot({"to":"up|down","labels":[...]})`、接收方`trigger("slot",...)`和`signal()`已进入当前Help与系统测试。
- **✅ 4784交互隔离P0**：已完成、集成、部署。真实4784重启后health正常，`explore 🧊manage`最终约256ms；系统测试`226/226 PASS`。下文“尚在隔离分支／未部署”只保留为历史过程，不代表当前状态。
- **✅ 推支内嵌判定与通用动作**：Strut `if.program`、统一Transform `$动作`、无上限点击次数已完成；不再开发独立click trigger。
- **✅ Strut触发单轨化**：Graph后项决定接收Program，接收方以`trigger("strut", {}, main)`自主响应；旧`nodes`合同已从运行时与生产ESG四条接棒链清除。
- **✅ Web revision补账**：外部CLI/Program提交在SSE断线期间漏掉通知后，EventSource重连会立即核对当前路径与展开路径，并一次导入同一最新revision；不依赖轮询或全世界刷新。
- **✅ Shortcut激活与语义编辑**：深层激活真实Chromium`5/5 PASS`；`thing.lnk.EXACT_TARGET`只改引用自身并保持内部identity，Web不再暴露合同JSON或要求ID。
- **🟠／⏸ 当前次序**：ESG现场已复现已批准功能的P0生产故障，当前先修Program创建超时；A模式规格、计划已提交，隔离分支`feat/a-mode-consolidation`Task 1停在`b1bff98`且聚焦测试`31/31 PASS`，P0关闭后继续，不是取消。手机域名仅被`pixel-10a`离线局部阻塞；零Agent创世继续排在A模式之后。现场反馈不授权改动Graph本体定论。

### 0.1 内部槽位标识隔离最新证据

- **根因**：旧投影把`thing` Key上的全部类型直接映射为用户可见`atomTypes`，把供槽模稳定定位的`slot-role-*`与`slot-revision-*`误当成普通语义类型显示；权威名称本身未被改写。
- **修复**：提交`93200d3`在投影边界只输出正式公开类型，内部角色与修订身份继续保留在权威Graph，不做名称字符串截断。
- **验证部署**：`tests/atom-projection-pipeline.test.mjs`为`13/13 PASS`；通过计划任务`Atom Graph Runtime`正规重启4784，health为revision`7272`、投影`published`、世界revision仍为`sha256:d269cf...a27f`。用户可见`knowledge.json`中`slot-role-*`／`slot-revision-*`命中为0。

### 0.2 手机统一入口最新证据

- **根因**：tailnet的MagicDNS与Serve均正常，但本机Tailscale偏好`CorpDNS=false`，导致系统解析统一域名时返回NXDOMAIN；Tailscale内置查询一直可解析到`100.116.206.105`。
- **修复**：执行`tailscale set --accept-dns=true`恢复系统使用Tailscale DNS；不改变Atom世界、网关身份白名单或正式入口。
- **回读**：`Resolve-DnsName worker.tail33a2eb.ts.net`返回`100.116.206.105`；`https://worker.tail33a2eb.ts.net/__spatial/api/health`返回200、revision 7270、投影published。
- **历史在线链路**：`pixel-10a`曾在线，电脑到手机`100.102.183.62`的Tailscale ping约1.03秒；统一HTTPS health为200、revision 7272、投影published。电脑端Proton VPN按目的地址分流时优先排除手机Tailscale IP`100.102.183.62`，必要时再排除MagicDNS`100.100.100.100`或整个`100.64.0.0/10`。
- **2026-09-04当前断点**：4784为`200/约193ms`，4785按身份门禁返回401，Serve仍正确代理到4785；电脑绕过命令测试代理直连正式域名为`200/约250ms`。同次`tailscale status`显示`pixel-10a`离线，故当前失败发生在手机进入tailnet之前，不支持修改Atom代码或启用公网Funnel。
- **剩余边界**：先在手机恢复Tailscale在线，再从手机浏览器用同一正式域名完成只读Graph请求。若在线后仍失败，继续捕获手机请求是否抵达Serve；电脑回读和ToDesk替代使用均不能替代终端浏览器验收。当前优先级已由用户下调。

## 1. Slot相邻信号已关闭（历史首要功能）

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

### P0：交互原子隔离（已关闭）

- **已复现**：`http://127.0.0.1:4784/__spatial/api/health`快速返回；最简单的`explore 🧊manage`超过30秒无输出。
- **2026-09-03再次核实**：真实4784 health在248ms返回`ok:true`、revision 7255、projection `published`；连续两次最小只读`explore {"thing":"🧊manage"}`均在5秒截止时取消。权威`atom.json`仍为`瞻权=1、判针=1、瞻判=0、排针=0`，最后写入时间为2026-09-02 23:31，证明本轮两次改名均未提交，不得盲目重放。
- **根因定性**：`cli/lib/server.mjs`以单一`atomInteractionTail`串行整个写交互，Explore也等待该尾链。不定性为“队列失活”，而定性为“原子交互被错误做成全局串行依赖”。
- **用户定论**：每个交互自己计算、超时、回滚和回执；原子间不互相等待。只有最终权威提交的短临界区串行。
- **已实现**：`3111dcb`移除全交互尾链；`d1b7b6c`加入独立截止、`AbortSignal`传导和超时后禁止迟到提交；`ece6293`将候选世界计算移出提交互斥，提交时重新复验修订。
- **本地验证**：挂起 Transform 时独立 Explore/独立 Transform均通过；40ms截止返回`ATOM_INTERACTION_TIMEOUT`且随后 Explore通过；迟到计算不提交；World Transaction `21/21 PASS`。
- **集成部署**：`3111dcb`、`d1b7b6c`、`ece6293`及回归修正`ead30e2`已合入并推送`main`；真实4784已重启验收。
- **关闭证据**：`npm run test:system`为`226/226 PASS`；真实`explore 🧊manage`成功，最终约256ms。当前优先级已转为Strut `nodes`退役。

### Strut context 边界纠偏

- **已有**：`antecedents[].{path,thing,situation}`、`consequents[]`和规范化`transform`动作信封。
- **业务职责**：业务使用方决定是否发起 Transform；Strut内嵌 Program依据当前前项事实和本次动作返回 strict bool。内核不判断新旧值是否相同，也不替业务决定是否操作。
- **裁定**：撤回旧值、新值和状态跃迁合同开发项；除非出现当前事实与动作信封确实无法表达的具体业务证据，否则不扩张内核。

### 已撤回

- **幂等**：不新增`once_per_revision`；是否 Transform及是否推支由业务侧按当前事实与动作语义决定。
- **本地清理**：槽例本地节点采用软停用，不作为当前缺陷。
- **纵向条目**：不再登记独立`climb`；由当前 Slot功能覆盖。

## 4. 执行状态与下一步

### Strut接收端单轨化（已部署）

- **合同实现**：Graph `then`显式指向实际接收`thing@program`；接收Program只声明`trigger("strut", {}, main)`；运行时按`delivery.consequentPath === program.path`索引，不读取`nodes`。槽例从前项路径恢复实例域，只把实际Program角色映射到槽模共享Program，兄弟槽例隔离。
- **迁移实现**：Python AST只改写唯一顶层Strut Trigger参数并对动态／多Trigger失败封闭；纯计划器按现有Graph关系把旧订阅改为显式Program后项；`changedPaths`覆盖改写Program和实际Strut owner。部署脚本支持`--dry-run|--apply|--rollback`，校验真实路径与containment，执行私有备份、中央提交、Graph投影回读及失败自动回滚；提交后回执丢失可由备份和事务日志恢复，不重放提交。
- **提交链**：`2baea2e`、`0f6864d`、`166d9c8`、`d7dbc17`、`4884346`、`7245107`、`fbbfea6`、`970bd0a`；已快进合入并推送`origin/main`。
- **TDD证据**：旧合同清理后的RED为`33 tests / 32 pass / 1 fail`，唯一失败来自Form内核`STRUT_FACT_CONSEQUENT_REQUIRED`；最小修正后`33/33 PASS`。
- **受影响链**：Form、Graph、Program、Slot body、投影与迁移共`170/170 PASS`，duration `48940.1532 ms`；迁移专项含apply、硬中断恢复、receipt-only rollback、投影故障自动回滚与链接逃逸，共`10/10 PASS`。
- **最终验证**：`npm test`功能结果`1683 PASS`；唯一失败为未受本分支影响的空间布局耗时阈值，随后同一用例独立复跑通过；`npm run test:system`为`229/229 PASS`，duration `60967.7311 ms`；Node syntax、Python AST与`git diff --check`通过。终审两轮完成，最终结论“无阻断”。全量构建机械刷新build-id，已恢复且不纳入提交。
- **生产预检**：attempt `strut-final-preflight-20260903-02`只读成功；migration `strut-receiver-2871846a8d22a2d58790`；源revision `sha256:ee3ced5db6bbad898e1f113b7a032080c8772f00c15024688e6c576a6bb3a5ed`，目标revision `sha256:d269cf00aeabdd88c612488da0956f67272af263b7f6a42454ea92a23855a27f`；精确命中ESG步骤02—05四个`接棒`Program、4个旧订阅和4个Graph后项；未写生产世界。
- **生产迁移**：`strut-production-20260903-01`在4784停机窗口先生成私有备份，再把4个旧订阅及4个Graph后项原子迁移；世界从`sha256:ee3ced...a5ed`提交到`sha256:d269cf...a27f`，部署回执位于`C:\Users\worker\AppData\Local\AtomGraph\worlds\primary\migration-backups\strut-receiver\strut-receiver-2871846a8d22a2d58790\strut-production-20260903-01\deployment-receipt.json`。
- **部署验收**：4784 revision `7269`、投影`published`；公开CLI回读步骤02—05四个`接棒`均为`trigger("strut", {}, main)`，对应批次Strut `then`均显式指向自身接棒Program。首次重启暴露“新代码先于旧世界迁移”的启动门槛，迁移后重新启动即健康；未发生迁移回滚。
- **重复预检**：部署后迁移工具曾把现行空参数Trigger误报为动态旧合同；现已按TDD修正为安全空操作。迁移专项`11/11 PASS`；生产只读预检`strut-completion-audit-20260903-02`退出码0，源／目标revision同为`sha256:d269cf...a27f`，迁移计数`0/0/0`且未写事实。
- **精确后续顺序**：Shortcut、ASDF设置和内部槽位标识隔离均已部署；后续顺序只从当前需求总账读取，不再沿用本条历史顺序。

### Web/CLI局部视图即时一致性（已部署）

- **根因**：持续SSE连接收到revision时原链可即时刷新，但EventSource断线期间的CLI/Program提交事件不可补发；连接恢复时旧逻辑只有页面已标记`offline`才重新拉取，普通自动重连因此继续展示旧局部事实。
- **修复**：浏览器记录EventSource是否已经成功打开；第二次及后续`open`一律调用既有`pullKnowledge()`，只读取当前路径及已展开路径，并复用同revision齐备后单次导入合同。首次连接保持原启动拉取，不增加周期任务。
- **TDD证据**：新增“断线期间遗漏CLI revision、重连后无消息补推也必须得到r2”用例，修复前精确失败为`r1 !== r2`，修复后转绿；提交通知与浏览器桥接链`55/55 PASS`，入口哈希、静态服务与桥接合同`48/48 PASS`。
- **交付证据**：实现提交`88d36c6`已推送`origin/main`；真实4784回读`ok:true`、投影`published`、入口build `sha256-06964fc1abf84f07`，在线`spatial-browser-bridge.js`包含重连补账逻辑。

### Shortcut语义改向（已部署）

- **公开合同**：Agent用`transform {"thing.lnk.EXACT目标":"EXACT快捷入口"}`改向；Graph精确消歧新目标并复用读取鉴权，只改引用自身的内核metadata，stable reference identity保持。改名与改向可在一个Transform内原子完成；普通Thing稳定拒绝。
- **Web合同**：Shortcut投影显示`快捷目标：语义路径`，不显示合同JSON或reference ID；编辑球镜只显示名称和目标路径，隐藏Markdown与附件入口，保存后进入同一Transform/事务/回读链。
- **TDD证据**：新增核心RED为`UNKNOWN_GRAPH_FIELD`，Web模型RED为缺少`shortcutTargetPath`，translator RED错误生成`situation.rep`，投影RED精确暴露合同JSON。最终最小受影响链`215/215 PASS`，Shortcut Chromium`5/5 PASS`，浏览器构建与development-control通过。
- **交付证据**：`a48f33f`已快进合入并推送`origin/main`；真实4784重启后health`ok:true`、revision`7270`、投影`published`、Web build`sha256-7ba5295f501e0740`，在线HTML与engine均含语义目标编辑路径；当前Help回读包含`.lnk.`。

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
- **P0 代码状态**：已完成系统验收、集成、部署和推送，关闭。
- **恢复顺序**：
  1. Strut单轨化已关闭：不得重新引入`nodes`或旧/新值内核判断。
  2. Web/CLI Transform断线revision补账已关闭：后续现场若仍复现，保留网络时序证据并继续追查其他根因，不回退到轮询或全量刷新。
  3. Shortcut深层激活与语义编辑已部署关闭。
  4. ASDF Task 3评审缺口已修复、集成并部署；历史分支状态不得再作为下一动作。

## 5. 用户延后工作

- **A模式收束**：当前A可用；S、D退役与F沉浸融入A已排为手机终端断点后的下一可执行项，先完成规格中最后一个交互裁定，再进入实施计划。
- **零Agent创世**：当前已有合法Agent，紧急度较低但不是取消；排在A模式收束之后继续。
- **手机入口**：仍未根治，但ToDesk可替代使用，暂不抢占账本校准。

## 5.1 会话恢复与证据缺口

- **原始会话已找回**：本机rollout JSONL仍在，共31,010条记录；剔除注入项后回查168条实际用户消息。界面历史丢失不再作为状态缺口。
- **工务世界证据已校准**：CLI精确回读确认旧`推进`已完整位于普通可用的`外务/旧版本`；提交回执`legacy-b67250821108fc80e9b3f88b38ed55474a83494cc31a0229563837585d79e540`证明其后又完成`职务→职务·FDE`、`规划→设计`、`实施→开发`，且后续ESG结构使用该新路径。旧工务2—4目标因此退役，不需要Graph写入。
- **巡守已恢复**：`atom-2`已恢复为每小时`ACTIVE`；提示先读当前总账、只跑最小受影响链、无变化保持安静，不再沿用旧Slot／4784顺序。

## 6. Git 保护

- `main`与`origin/main`已回读一致为`f2d2fd083329e0c145248988f16fb722a1b4c085`；远程标签`pre-a-mode-consolidation-20260904^{}`解引用到同一提交。
- A模式实施中的阶段提交均必须通过对应最小受影响链；回退时可从上述标签新建恢复分支，不要用破坏性`reset --hard`覆盖用户工作。
- 提交和推送前必须运行`git diff --check`并回读实际 diff；没有验证证据不得宣称完成。
