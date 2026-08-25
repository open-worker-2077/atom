## Why

现有槽体运行时把人工预建的 `空槽例` 当作复制母版，并依靠 `槽模映照` 维护实例；这迫使使用方同时维护定义与空副本，也无法让同一份候选 DataFlow 在研发态和多实例态通过当前域相对引用直接复用。现在需要把已经研磨过的普通 DataFlow 原子封装为槽模，以可见 `print@program` 承载权威实例计划，并把事件计算严格限制在所属槽例域内。

## What Changes

- **BREAKING**：槽体从“槽模／槽例／空槽例”改为“槽模／`print@program`／槽例容器”；不再要求或接受物理 `空槽例` 作为打印母版，旧空槽例机制由新封装流程替代。
- 使用方先建立一棵普通、可单次自运行的候选槽模 DataFlow；上层 Program 调用 `slot_body()` 封装后，内核原子保留同一份逻辑为 `槽模`，生成可见且可审计的 print 计划与空的槽例容器。
- print 计划覆盖全部普通槽、嵌套 contain、support 关系、类型／描述元数据和默认料；打印复制所有槽但不复制共享 Program，也不硬编码输入／输出角色或限制可填写槽。
- 为共享 Program 增加 `./…` 当前域相对选择器：研发态绑定候选槽模，实例态绑定本次槽例；禁止以绝对实例路径冒充相对域，禁止越过嵌套槽体边界。
- 实例事件按“所属槽例 → 相对槽角色 → 槽模局部 support 计划 → 条件命中 → 同槽例 Program”定向调度，不扫描全部槽例或无关世界。
- 同一槽模重新封装时生成新修订 print 计划，局部同步全部所属槽例并重算派生计算；默认料使用旧默认／实例当前值／新默认三方比较，保留并报告个性料。
- 大规模同步可分批提交；每个槽例公开采用的槽模修订，未完成批次必须返回未完成状态，不得宣称整体同步成功。
- 槽体效果继续在 Program 完成后进入锁、世界修订、Graph 校验和中央原子提交；任一失败不留下半份封装、实例或同步结果。
- Help 与函数注册表公开从候选槽模研发、封装、打印、填写、触发计算、重新封装到回读的完整契约，并保留“只读 exact Explore 不重放无关 Program”的回归门禁。
- v1 明确不提供跨槽例引用、外部共享资料或 PowerPivot 式 `FILTER`／`SUM` 聚合；thing／situation／contain／support 的权威表示由独立 Graph 迁移负责，本变更只消费语义适配层。

## Capabilities

### New Capabilities

- `slot-body-packaging`: 候选 DataFlow 封装、可见 print 计划、无空槽例打印和共享 Program 契约。
- `slot-relative-execution`: 当前域相对选择、scope 绑定、嵌套边界与局部 support 触发契约。
- `slot-body-revision-sync`: 槽模修订、三方默认料合并、分批同步和实例派生重算契约。
- `slot-body-operations`: 槽体事务、错误回执、Help、无关 Program 隔离及 Graph 语义适配边界。

### Modified Capabilities

无。既有 `add-slot-domain-runtime` 尚是历史 change 而非主规格；本变更以新的独立 capability 明示替代设计，不改写旧 change 冒充原设计未变。

## Impact

- 槽体布局读取、计划编译、实例打印、修订同步与事务执行器。
- Program Python 安全命名空间、Explore 相对选择、scope 绑定、support 事件索引与效果调度。
- Program 函数注册表、`atom.cmd --help`、运行时回执和错误码。
- 槽体单元／集成／调度／事务测试，以及实现后由总控排他安排的 Atom `test` 域真实 ESG 活动正反试跑。
- 与 `feature/graph-four-axis-support` 的合并点限于 Graph contain/support 语义适配接口；本分支不重定义四轴，不修改 ESG 文件、正式 Atom 节点或共享全局 Skill。
