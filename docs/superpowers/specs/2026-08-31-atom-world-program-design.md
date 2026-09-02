# Atom 世界与 Program 设计

## 1. 责任边界

- **负责**：定义世界事实、slot/strut/Shortcut 关系、Transform、Program 执行合同、槽体闭环和备份域语义。
- **依赖**：Agent 与授权规格提供身份和许可；运行规格提供事务、修订、投影和恢复；Web 规格只呈现这些语义。
- **不负责**：不定义相机与布局，不自行保存 Agent Session，不把 Graph 或索引当作事实源。
- **主要来源**：Issue #4、#5、#9、#11、#44、#45、#51、#53、#54、#62；相关 PR 只作为实现轨迹。

## 2. 世界模型

### 2.1 事实与关系

- **Thing**：具有稳定身份、名称、类型与可定位坐标；改名、移动和展示变化不得悄然替换身份。
- **Situation**：保存 Thing 的事实正文或 Program 源码；解析 Transform 时，正文内部的 `.ren.`、`.rep.`、`.dsc.` 等字面量保持不透明。
- **Slot**：定义真实层级和权限传播路径；路径变化通过中央事务更新，不能由显示缓存推断。
- **Strut**：保存可审计的前项、后项、内嵌判定 Program 与 clause 身份；普通 Thing 只提供事实，不保存布尔职责，判定 Program 也不伪装成独立 Thing。
- **Shortcut**：保存指向目标稳定身份的虚拟引用；它不是目标副本、权限代理或 Transform 重定向器。

### 2.2 唯一事实与派生物

- **权威写入**：所有业务改变最终形成对 `atom.json` 的一个受控世界事务。
- **派生结构**：Graph、Spatial、反向索引、权限缓存、Program registry 与浏览器场景都可从已提交世界重建。
- **禁止反写**：投影、缓存或 UI 当前值不得作为世界事实覆盖源。
- **路径标识**：外部可读回执同时给出稳定身份和可理解坐标；坐标变更不改变对象身份。

## 3. Program 合同

### 3.1 执行入口

- **精确选择**：`use_program` 复用 Explore 的精确坐标解析，不建立较宽松的第二套寻址规则。
- **受限执行**：Program 在运行脊柱规定的修订、超时、并发、授权和副作用边界内运行。
- **统一提交**：Program 产生的 Transform 与显式订阅 effects 进入同一中央事务；任一提交前失败整笔回滚。
- **ABI 单一**：当前版本只维护一个公开 ABI；旧 ABI 只能经授权维护迁移转换，不能作为永久兼容运行分支。

### 3.2 Strut 判定与交付

- **本体归属**：判定 Program 直接编写在该条 Strut 的 `if` 内，是 clause 自身的条件，不是节点 Program、外部 `thing@program` 引用或全局 Transform 订阅器。
- **上游上下文**：运行时由 clause 结构提供全部普通事实前项的精确 ThingCoordinate、当前 Situation 及本次相关 Transform 动作；复合 Strut 不要求判定代码重新猜测起点集合。
- **判定方式**：内嵌 Program 可按上游 Situation 值、上游是否被 Transform、Transform 中任一已注册 `$` 动作及其参数判断；`$click`只是一个具体动作，例如还可由后续注册动作复用同一机制。值判定示例是读取“价格”前项的 Situation 数值并判断是否超过阈值。
- **统一动作信封**：Strut/runtime 只消费规范化 Transform action envelope（exact target、注册动作名、参数/载荷、交互来源、候选 revision），不得为 `$click` 或未来单项动作建立专用调度旁路；新动作只扩展动作注册与自身校验。
- **纯判定边界**：`if` Program 只读上游事实和触发动作，必须严格返回 `true` 或 `false`；不得 Transform、Jump、发消息或产生其他世界副作用，异常与非布尔均不得默认成 `true`。
- **显式交付**：`true` 只形成绑定候选 revision 的 typed delivery；只有后项自身显式声明 `trigger("strut", ...)` 的 Program 才接收。
- **False 语义**：`false` 保留为本 clause 的可审计判定，不向后项伪造 delivery，也不改变任一前项或后项事实。
- **不隐式执行**：delivery 不等于强制执行后项或后项全部 Program；没有精确订阅就不执行。
- **原子边界**：来源 Transform、订阅 effects、锁、修订和投影发布属于同一可解释结果；失败释放 claim，不留下半交付。
- **旧模型退役**：当前代码把 `if` 中的 `thing@program` 当作独立 Program Thing 选择器，只证明 strict-bool、索引和 delivery 子机制可运行，不符合本规格，必须由 Strut 内嵌 Program 合同替换；旧测试不得继续作为本能力完成证据。

### 3.3 复合 Strut

- **显式枢纽**：N→M 必须由真实、可见、可审计的 H 拆为 N→H 与 H→M 两项 clause。
- **禁止原生 N→M**：解析和写入入口稳定拒绝把多前项、多后项压成一个原生 clause。
- **身份独立**：N→H 与 H→M 各有自己的关系身份、判定和诊断；视觉连续不得合并其业务身份。
- **几何语义**：N→1 在归一化 50% 汇流，1→N 在归一化 50% 分流；几何只投影关系，不改世界事实。

## 4. Transform 与特殊域

### 4.1 Transform 语义

- **命令集合**：`new`、`rep`、`ren`、`mov`、`dsc`、`rst` 通过同一外层命令解析和事务入口执行。
- **工程动作族**：`$` 是 Graph Transform 对 exact Thing 施加的开放注册动作族，不是 Web 私有事件；CLI、Web 与 Program 使用同一解析、鉴权、动作信封和触发链。`thing$click` 表示向指定 Thing 提交一次点击动作，其他 `$` 动作按注册表合同解析，核心不得维护动作名称枚举分支。
- **点击入口**：CLI 可用 `transform {"thing$click":"EXACT路径"}` 提交点击；Web 对应点击必须翻译为同一 Transform 动作，不能另造 `POST /click`、`trigger("click")` 或浏览器专属语义。
- **读写分界**：纯粹取得 Thing、Situation、Slot、Strut 或动作前置事实一律使用 Explore；改造世界以及 `$click` 等对 Thing 施加的交互动作一律进入 Transform。动作自身未改变持久事实时不得伪造事实差异，但仍形成可供精确 Strut 条件识别的本次 Transform 动作上下文。
- **输入不可变**：解析器和变换函数不得原地修改调用方传入的冻结数组或对象；需要变更时创建受控副本。
- **正文不透明**：`situation.rep` 只解析外层命令键，replacement 正文按字节处理。
- **失败守恒**：非法轴、冲突、越权或失败注入时，world、revision、projection 和交互 CLI 均保持可继续使用的明确状态。

### 4.2 槽体闭环

- **同体权限**：seal、print、局部触发和 reseal 必须在实际槽体 slot 边界内由获权 Program 完成。
- **同一事务**：槽模修改与同槽体 reseal 合并为一个中央事务；跨槽借权或只完成一半时整笔失败。
- **坐标相对**：槽体内部寻址相对当前获权域解析，同时保留可回读的精确世界坐标。
- **使用结果**：成功链为“seal → print → 局部触发 → 自动锁 → reseal”，且正文、锁与投影一致。

### 4.3 Shortcut

- **读取跳转**：激活 Shortcut 时按 linked stable id 找到目标，并由 Web/CLI 明示其目标坐标。
- **权限不转借**：Shortcut 不授予目标 ACL，不绕过 Agent 的实际 slot 路径裁定。
- **写入不转发**：对 Shortcut 自身的 Transform 不悄然改写目标；目标操作必须显式指向目标身份。
- **失效处理**：目标不存在、不可见或越权时返回稳定原因，不伪装为空节点或本地副本。

### 4.4 软删除、恢复与备份 Program

- **碰撞安全**：`dsc` 进入默认备份域时生成稳定、可读、可追溯的唯一归档身份；同名历史项不覆盖也不阻断新归档。
- **明确恢复**：`rst` 指定归档身份和恢复坐标；目标冲突时安全停止或按显式改名方案继续。
- **关系完整**：子树、strut、Shortcut 引用与中央可逆记录共同提交，恢复后能按当前合同重新投影。
- **Program 停用**：进入备份域的 Program 通过明确类型/状态事实停用，并同步更新触发反向索引；不根据容器显示名猜测。
- **冷启动一致**：停用 Program 冷启动后不得复活；恢复为活跃事实后才重新登记并验收。

## 5. 错误与验收

### 5.1 错误合同

- **稳定拒绝**：非法 strut、原生 N→M、非 strict bool、目标冲突、越权和失效 Shortcut 返回可区分错误码与上下文。
- **提交前失败**：不得改变 world、revision、投影或 Program 索引。
- **提交后辅助失败**：中央事实已提交而辅助 JSONL/诊断镜像失败时，返回成功加明确 warning，不能误报为未知提交。
- **交互连续**：单个命令失败不得让交互 CLI 崩溃或让 Web 误删当前层。

### 5.2 必要验收场景

- **Program 坐标**：同名、跨层和歧义坐标的 Explore/`use_program` 结果一致；旧 ABI 不进入正常运行。
- **Strut 矩阵**：内嵌值判定、普通 Transform、`thing$click`、复合前项、true、false、非布尔、异常、无订阅、精确订阅和订阅失败均验证职责、交付和回滚；移除 Strut 后相同节点 Transform 不得触发原后项。
- **入口同构**：CLI 与 Web 对同一 exact Thing 的 `$click` 产生同构 Transform 动作上下文、命中同一 Strut clause；Explore 不触发 `$click`，浏览器不得选择 Program 名称。
- **动作扩展性**：验收时除 `$click` 外注册一个隔离测试动作；不修改 Strut 解析、依赖索引、判定运行或 delivery 主干即可被内嵌 `if` Program区分并判定，证明实现依赖统一动作合同而非 click 特判。
- **复合关系**：显式 H、N→H/H→M 独立身份、原生 N→M 拒绝、50% 汇流/分流及 H 可交互同时成立。
- **Transform 回归**：冻结输入、正文含命令字面量、同名归档、冲突恢复、失败注入和 CLI 连续性通过。
- **备份 Program**：移动停用、冷启动不复活、恢复重登、无关活跃 Program 不受影响。

### 5.3 追溯关系

- **直接实现轨迹**：PR #49、#56、#57、#59、#60、#63–#71。
- **被替代方案**：PR #63–#65 的部分合同已被后续用户定论和 PR #66–#71 修正，不能单独作为当前设计来源。
- **跨域验证**：权限矩阵由 Agent 规格定义；修订与回滚由运行规格定义；H 的真实视觉交互由 Web 规格验证。
