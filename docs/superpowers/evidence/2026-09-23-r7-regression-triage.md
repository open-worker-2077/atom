# R7 剩余回归清单（2026-09-23）

- **结论前提**：本清单 15 个文件在**已部署基线** `b38c787` 上全部通过（见总账“决定性对比”条），故全部为候选分支引入的回归
- **当前门禁**：2389 项中 2357 通过、31 失败、1 平台跳过（候选 revision `ea10393`）
- **真实数据**：写入/回读/重启/回滚与改名四轴守恒两项隔离验收均通过，正式 `atom.json` 哈希未变

## 按失败签名分组

| 文件 | 失败数 | 代表性错误 | 初判性质 | 预估 |
|---|---|---|---|---|
| atom-rename-sealed-descendants | 8 | `AGENT_LABEL_DELEGATION_DENIED`、`DUPLICATE_THING_IDENTITY(003)`、旧“改名重写源码”断言 | 归档复制/恢复身份与委派校验 + 2 项旧契约断言需迁移 | 大 |
| atom-program-service-e2e | 3 | 内层引擎回执 `ok:false`（服务端 4784 流程） | 服务端后续执行链 | 中 |
| atom-slot-body-structure-lock-integration | 3 | 断言值差异（结构锁复用/编译） | 槽体结构锁与绑定采纳交互 | 中 |
| atom-language-graph-server | 3 | 深比较差异；一项 `TypeError: terminated`（304s） | 服务端初始化/空间投影通知链 | 中 |
| atom-program-projection-lifecycle | 2 | 严格相等差异 | 投影生命周期与绑定失效判定 | 中 |
| atom-slot-body-plan-integration | 2 | 实例推进/计划断言 | 槽体计划与实例同步 | 中 |
| atom-language-operational-cli | 2 | `INVALID_PROGRAM_SOURCE: Program reference must resolve uniquely: Target` | 未绑定引用在 CLI 流程被要求唯一解析 | 小-中 |
| atom-slot-body-mirror-runtime | 1 | `Shortcut creation requires one transaction-reserved identity` | 快捷引用创建路径的身份来源 | 小 |
| atom-program-runtime-scheduling | 1 | `Program dependency revalidation took 17636ms` | 新增解析/校验导致的时延超出阈值 | 小-中 |
| atom-program-work-order-e2e | 1 | `the work order is persisted below the dedicated test Atom` | 工单持久位置 | 小 |
| atom-slot-body-two-step-flow | 1 | 内层 `transform` 回执失败 | 两步流末段 | 中 |
| atom-slot-strut-lock-acceptance | 1 | 内层 `transform` 回执失败 | strut 锁验收末段 | 中 |
| atom-transform-postcommit-boundary | 1 | 对象深比较差异 | 提交后边界 | 小 |
| atom-program-interaction-e2e | 1 | `Cannot read properties of undefined (reading 'text')` | 交互回执结构 | 小 |
| atom-language-cli-graph | 1 | 断言失败（CLI 图） | CLI 图路径 | 小 |

## 建议推进顺序（供决策参考，不代表范围已确认）

1. **先做小-中项**（`operational-cli`、`mirror-runtime`、`work-order`、`transform-postcommit`、`interaction-e2e`、`cli-graph`，共 7 项）：单项影响面小、定位成本低。
2. **再做服务端组**（`service-e2e` 3 项、`graph-server` 3 项）：同一运行面，可合并定位。
3. **最后做归档/槽体大类**（`rename-sealed-descendants` 8 项、`slot-body-structure-lock-integration` 3 项、`slot-body-plan-integration` 2 项、`two-step-flow` 1 项、`strut-lock-acceptance` 1 项）：均涉及身份/绑定与归档复制语义，需要一次专项设计而非逐点修补。

## 已知不该再走的路（避免重复投入）

- 交互起点“把世界已有身份计入分配器”并重发水位：实测无改善且引发水位冲突。
- 让播种水位越过既有身份但不登记签发：实测无效。
- 对 `atom-rename-sealed-descendants` 逐项试修：两次尝试均为 17/9（基线 18/8），已回退。
