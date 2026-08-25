## Purpose

确保槽体封装、打印、同步和相对域计算继续遵守 Atom 的中央事务、只读纯净、公开 Help 与 Graph 语义边界，使使用方能仅凭公开契约完成真实工作并可靠验收。

## ADDED Requirements

### Requirement: 槽体效果只通过中央候选事务提交
Program 调用 `slot_body()` SHALL 只登记候选效果；Program 结束后，系统 SHALL 统一执行调用源验证、窗口锁、世界修订、局部槽体计划、相对域 Program 效果、Graph 校验与一次中央提交。此过程 SHALL 是同步候选事务而非时间延迟或后台任务；任一步失败 SHALL 不留下半份槽体、槽例、修订或派生结果。

#### Scenario: 多个槽体效果一次提交
- **WHEN** 一个 Program 合法登记封装或同步以及相应局部计算效果
- **THEN** 所有效果通过同一候选世界验证后只增加一次世界修订，回执列出可 exact 回读的受影响路径

#### Scenario: 最终 Graph 校验失败时全部回滚
- **WHEN** 候选布局含重复同级名、悬空内部 support 目标或其他非法 Graph
- **THEN** 系统返回对应精确错误，事实文件、投影和世界修订均保持事务前状态

### Requirement: print 效果必须来自当前可见计划
运行时 SHALL 验证打印效果由目标槽体当前 `print@program` 发出，携带的计划修订与可见当前计划一致；手工伪造、过期计划或其他 Program 代发 SHALL 被拒绝。运行时缓存只能作为派生索引，缓存缺失或重启后 SHALL 从可见计划恢复且不得打印实例。

#### Scenario: 过期 print Program 不生成实例
- **WHEN** 调用方在槽模重封装后提交旧修订的打印效果
- **THEN** 系统返回 `SLOT_PRINT_PLAN_STALE`，不生成槽例且提示重新读取当前 print Program

#### Scenario: 重启只恢复索引不重放计划
- **WHEN** Atom 服务在已有 print 计划和槽例时重启
- **THEN** 系统可恢复局部索引，但不封装、打印、同步、重算或改变世界修订

### Requirement: 只读回读与无关 Program 保持隔离
exact Explore、Help、函数注册表和其他只读投影 SHALL NOT 调度或重放 Program 写效果。创建或修改 Program 的 Transform SHALL 只运行显式命中 support／trigger 的 Program或本次 exact Program 的必要验证，不得因 Program 目录、缓存或槽体计划变化重放其他 Program。

#### Scenario: exact Explore 不受旧打印 Program 污染
- **WHEN** 世界中存在曾打印具名槽例的旧 Program而使用方 exact Explore 任意节点
- **THEN** Explore 只返回事实，不执行旧 Program、不重复打印，也不返回 `SLOT_BODY_EXAMPLE_EXISTS`

#### Scenario: 创建无关 Program 不重放槽体效果
- **WHEN** 已有槽体包含非幂等 print Program而调用方在其他位置创建新的无关 Program
- **THEN** 新 Program 可正常验证与提交，既有槽例数量不变且旧 print Program 不执行

### Requirement: Help 公开完整使用链与精确错误
`atom.cmd --help` 与 Program 函数注册表 SHALL 公开候选槽模试运行、首次封装、print 计划回读、实例打印与填写、相对选择器、support 触发、重新封装、分批继续、修订回读和失败回滚的完整输入、结果与示例。Help SHALL 至少解释本规格中的所有 `SLOT_*`／`INVALID_SLOT_BODY_LAYOUT` 错误，使用方不得需要阅读源码或测试夹具猜测结构。

#### Scenario: 使用方只凭 Help 完成全生命周期
- **WHEN** 未读源码的使用方读取 Help 和函数注册表
- **THEN** 它能构造普通候选 DataFlow，完成正向封装／打印／填写／计算／重封装／回读，并能按精确错误完成越域、重名、过期修订和事务失败的负向判断

### Requirement: 槽体只消费权威 contain 与 support 语义
槽体运行时 SHALL 通过 Graph 语义边界读取真实 contain 与有向 support，不新增或重定义 thing／situation／contain／support 持久化轴。当前 Graph 表示与未来四轴迁移 SHALL 通过适配保持同一槽体行为；现有 `.cpy.`、`instantiate()`、`template_catalog()`、`form()`、`work_order()`、普通 Program trigger 和锁契约 SHALL 在未调用新槽体能力时保持兼容。

#### Scenario: Graph 适配变化不改变槽体公开结果
- **WHEN** contain／support 的底层读取由当前 Graph 表示切换到权威四轴实现而输入语义相同
- **THEN** print 计划、相对角色、触发选择、实例结果和错误码保持相同

#### Scenario: 旧非槽体调用无需迁移
- **WHEN** 既有应用不调用新槽体封装或相对域能力
- **THEN** 其复制、模板、表单、工单、trigger 和锁输入输出保持既有行为
