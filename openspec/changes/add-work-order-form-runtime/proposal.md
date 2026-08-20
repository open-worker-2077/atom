## Why

Atom 已具备可执行 Program、Graph 四轴、模板规划辅助函数与事务回执，但仍缺少一套可直接复用的最小“工单”能力。Agent 目前需要重复拼装节点、校验与状态逻辑，既低效，也容易让业务结构偏离 `name`、`detail`、`children`、`partners` 的既有底层语法。

## What Changes

- 增加受保护的 `form()` 内核能力：由 `@program` 的 Python `detail` 调用，以普通 Graph-JSON 描述一类单子的根、子 Atom、关系、规则与版本。
- 增加首个外层库模板 `work_order()`：以最小工单为代表，生成可独立填写和运行的实例；首版包含 Output、Step、Criteria 三个编组及其必要下级槽位，不扩展派单、领单、跨单工作流或复杂路由。
- 允许工单内 Program 通过精确路径或显式 `partners` 使用平级、上级和下级 Atom；不把运行逻辑限制为仅访问 children，也不引入 Graph 之外的平行结构。
- 子 Atom 自行执行本地规则并上报结构化结果；根 Program 只负责单子级状态、动作和汇总，不重复计算所有子节点内部逻辑。
- 所有创建、填写、校验、提交与回读继续走现有 Transform、版本与事务边界；禁止静默覆盖新值。
- 将现有事务回执补成可按 Atom 查询的最小运行轨迹。写操作永久保留紧凑回执；读取与 Program 诊断采用限期记录。年轮是日志投影，不为每个 Atom 安装日志 Program，也不复制整棵世界。
- 保持 `@agent` 的上下文入口语义与 `@program` 的执行语义不变；首版不合并类型，避免破坏现有 CLI、窗口与数据兼容性。

## Capabilities

### New Capabilities

- `program-form-runtime`: 受保护的 `form()` 契约、Graph 原生模板解析、实例生成、填写、校验、状态与动作回写。
- `work-order-template`: 首个外层库工单模板及其最小 Output、Step、Criteria 闭环。
- `atom-year-ring`: 基于现有事务与执行记录的按 Atom 可查询轨迹、保留与压缩规则。

### Modified Capabilities

无。当前 OpenSpec 目录尚无既有规格；本变更只新增能力。

## Impact

- Program 可信标准库、模板注册与运行调度。
- CLI 与 Web 对同一工单动作和回执的呈现；不另造仅 Web 可识别的结构。
- 世界事务回执与诊断日志的索引、压缩和按 Atom 查询。
- 新增针对 Graph 语法保持、幂等实例化、横纵引用、并发写冲突、日志容量和端到端工单闭环的测试。
