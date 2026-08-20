# Atom Form / 工单 / 年轮开发交接（2026-08-20）

> 2026-08-20 后续开发已恢复。本文第 7 节起保留的是恢复开发前的历史暂停点，不再代表当前状态；当前公共契约见 [work-order-form-runtime.md](./work-order-form-runtime.md)，最终验证结果以本文新增的第 12 节为准。

## 1. 当前任务

在不破坏 Atom 现有 Graph 底层语法和事务边界的前提下，通过一个最小但真实的“工单”完成三项能力：

1. 受保护的 `form()` 内核：让 Program 能定义、生成和运行 Graph 原生单子。
2. 版本化 `work_order()` 外层能力：跑通创建、填写、校验、提交、驳回、修订和回读。
3. Atom “年轮”：基于中央事务回执和诊断构建可按 Atom 查询的紧凑日志投影。

本轮交付不是“画出三个节点”，而是有真实证据的完整闭环：

```text
一次创建完整工单
→ 按 Criteria 约束执行 Step
→ Step 形成 Output
→ Output 提交 Criteria 验收
→ 通过则结束，驳回则返回 Step
→ 全过程状态、实际产出与紧凑轨迹可回读
```

## 2. 不可歪曲的底层边界

### 2.1 Graph 仍然只有四个权威轴

```text
name
detail
children
partners
```

- 不新增 `fields`、`form`、table hierarchy 或另一套持久化结构。
- Form 里的“字段”在 Atom 中本质上就是由 Form 统筹的下级 Atom，即 `children`；不得把飞书多维表的列模型盲目搬入 Graph。
- Program 可以在自己的 `detail` 中调用注册能力，但这不改变 Graph 存储语法。
- `structuring-logic` 是 Agent 的推理与沟通 Skill，与 Atom 同源但不是 Atom；它没有 `name/detail`，不得被写入 Atom 内核或当成 Graph 语法。

### 2.2 `form()` 是受保护的单子内核

- `form()` 只统一处理单子的通用框架：Graph 定义、版本、实例生成、动作、校验、状态与结果回写。
- 它不应由日常 Agent 通过 CLI 随意改内核代码；Agent 可提需求，开发方专门迭代。
- 内部可由多个支撑组件实现，不要强迫一个巨型函数承担所有代码。支撑组件不需全部暴露给 Agent。
- 普通 Program 通过稳定注册名调用已定型能力，而不是研究或改写底层代码。

### 2.3 子 Atom 自治，根 Program 统筹

- 下级 Atom 各自执行本地规则，上报结构化结果；根 Program 只统筹整单状态、动作和汇总。
- 不得把所有子节点计算塞进根节点“一锅粥”重算。
- 每个可变事实必须只有一个权威写入者；子节点上报结果，根节点不重复伪造子状态。
- Program 可用精确路径或显式 `partners` 读取平级、上级、下级与关联目标；不得人为限制为只能读 `children`。
- 短名多重匹配时必须报歧义，不得猜测。

### 2.4 所有写入必须继续走现有事务闭环

```text
Program 意图
→ Transform 契约校验
→ 版本/修订冲突检查
→ 一次原子提交
→ 确定回执
→ 回读
```

- 不允许 `form()` 、`work_order()` 或 Agent 直接改 backing JSON。
- 不允许旧数据静默覆盖新值。
- 同一旧修订上的并发写入至多一个成功，其他明确返回冲突。
- 提交状态未知时不得盲目重放。

## 3. 首个工单的精确模型

### 3.1 一级结构恰好三个节点

```text
工单实例（业务名称，例如 ESG计划）
├─ Output
├─ Step
└─ Criteria
```

- 首版不在这三个下再拆大规模层级。必要槽位先以各自 `detail` 中的结构化 JSON 承载。
- 只有某项内容需要独立寻址、更新、关联、锁定或流转时，才从 `detail` 提升为新 Atom。
- `detail` 内日常字段名、定义、状态值和业务内容使用中文；重要字段先说明定义，JSON 保持缩进可读。

### 3.2 四条功能关系必须是 `partners`

```text
Criteria ─约束→ Step
Step ─产出→ Output
Output ─提交验收→ Criteria
Criteria ─驳回返工→ Step
```

不能只靠包含层级替代关系，否则 Graph 不能呈现工作如何实际流动。

### 3.3 状态职责

- 工单根：保存整项工作的流转状态，初版状态主干为待执行、执行中、待验收、已通过、已驳回、已暂缓。
- `Step`：保存局部执行状态、实际动作、实际产出和异常。
- `Output`：保存要求的交付物、成果引用和版本，不重复工单整体状态。
- `Criteria`：保存事前要求与事后验收结果，不重复工单整体状态。

### 3.4 首版动作

```text
create
fill
validate
submit
reject
revise
read-back
```

- 创建时输入至少包含工单名称、Output 定义、Step 定义、Criteria 定义、初始工单状态、精确模板版本和稳定创建标识。
- 创建必须幂等：相同创建标识重放不生成第二张单。
- 实例回读只给使用者当前需要的引导、当前值、可用动作、校验结果、状态和下一步；不把模板设计过程、会议纪要或内核源码丢给填单人。
- 完成提交必须依赖 Output、Step、Criteria 各自的结构化结果；缺项时返回负责节点路径，不改完成状态。

## 4. 分库与版本主干

- 受保护内核库：`form()` 及其必要内部支撑组件，由 Atom 开发方维护。
- 通用外层库：`work_order()`、`checklist()` 等可复用单子能力，使用受保护内核但不污染内核。
- 事务专用外层库：ESG、PM、采购等组织可复用的专业模板。分类以事情的通用性为锚，不以某个用户为锚。
- 项目局部库：特定项目的局部封装，通过统一外层注册入口登记，不默认写入开发方的内核注册体系。
- 注册名保持稳定，调用时显式选择精确版本。旧实例保留模板标识与版本来源，新版不静默改写旧实例。
- 本轮只实现工单 v1，不抢跑建设通用 PM、派单/领单、跨单工作流、复杂路由或全量类型生态。

## 5. 年轮（日志）的准确定位

年轮是中央记录的可重建投影，不是每个 Atom 自己运行的日志 Program，也不是新的世界真相来源。

### 持久写回执至少保留

- 时间、命令标识、关联标识、来源渠道。
- 提交前/后修订。
- 受影响 Atom 精确引用或路径。
- 受影响 Graph 轴。
- 结果和回滚关系。

### 限期读取/Program 诊断至少保留

- 时长、Program 精确身份与版本指纹。
- 成功、失败或超时结果。
- 失败原因和受影响引用。

限制：

- 默认不复制完整私密 `detail`。
- 不重复保存未改变的世界快照。
- 索引丢失后可从权威事务回执和诊断重建，不改 `atom.json`。
- 压缩后保留回执身份、修订、影响 Atom/轴、结果和最新安全回滚快照。

## 6. 明确不属于本轮的工作

以下是未来方向或已讨论想法，不得为本轮“顺手”实现：

- 将 `@agent` 并入 `@program`，或将 Atom 整体类型收缩为 Program + 纯文本。
- PM 单、ESG 专用单、采购单等高阶应用。
- 组织派单、领单、多工单流转、跨单工作流、复杂路由。
- 通用公式平台、飞书多维表克隆、全量字段类型。Python 仍是 Program 的主要计算能力。
- 复杂嵌套单、大规模 Step 分支、自动外部行动。
- 用应用层视图、排序、筛选或 AI 推荐反向改造 Form 内核。

## 7. 当前实际进度（不得冒充完成）

### 7.1 OpenSpec 规格已建立

变更名：

```text
add-work-order-form-runtime
```

路径：

```text
openspec/changes/add-work-order-form-runtime/
```

包含 proposal、design、tasks 和三份 spec；`openspec validate add-work-order-form-runtime --strict` 先前已通过。

任务状态：**0/18 完成**。不要因为规格文件存在就标记实现完成。

### 7.2 已发生的红测与局部实现（用户要求在此暂停）

新文件：

```text
tests/atom-program-work-order.test.mjs
tests/atom-program-reference.test.mjs
tests/atom-year-ring.test.mjs
```

有意义的 RED 运行命令：

```text
node --test --test-isolation=none tests/atom-program-work-order.test.mjs tests/atom-program-reference.test.mjs tests/atom-year-ring.test.mjs
```

初始可信 RED 结果：9 个测试中 3 个通过、6 个失败。跨层精确引用通过；Form、工单及年轮按预期失败。

随后已经发生以下**局部实现**，不能再写成“实现尚未开始”：

- `program_stdlib.py` 新增受保护的 `compile_form()` 与 `work_order_template()`。
- `program-worker.py` 最小注册 `form()` 与 `work_order()`，目前只涉及 `create`、`validate` 两个动作。
- `form()` 已限制为 `name/detail/children/partners` 四轴，拒绝 `fields` 等旁路结构。
- `work_order(create)` 已能生成带格式化中文 JSON 的 `Output/Step/Criteria` 和四条关系，并记录模板版本、创建身份及根状态。
- 创建动作开始实现按稳定 `creation_id` 幂等及身份漂移拒绝。
- 不支持版本与 `dispatch` 的断言已收紧为精确错误，原来的假阳性已消除。
- `tests/atom-program-reference.test.mjs` 已增加平级、上级、下级、partner 精确路径引用用例；连同既有歧义短名拒绝均已通过。

最近一次聚焦运行（未包含年轮）为：8 个测试中 **7 个通过、1 个失败**。失败的是：

- `work_order(validate)` 当前返回的 `missing` 为空，没有识别 `Output/Step/Criteria` 中缺失的必要内容；因此验证语义尚未成立。

年轮测试在前一次运行中仍失败：

- 已提交回执尚无 `affectedAtoms`、`committedAt` 和 `source` 顶层投影。

这 7 个通过只证明当前局部合同，不证明完整工单闭环。`fill/submit/reject/revise/read-back` 尚未实现，真实世界事务闭环、CLI/Web 一致性和顶层 `test` Atom 端到端均未验收。

### 7.3 尚未完成的红测基线

接手方不得跳过 OpenSpec 任务 1.2/1.3：

- 精确模板版本和创建身份幂等已有局部测试；旧修订拒绝与无部分提交由既有事务测试覆盖底座，但尚未接到工单真实写入链证明。
- 平级、上级、下级、partner 精确路径读取与歧义短名拒绝已建立并通过。
- 后续还需对 create/fill/validate/submit/reject/revise/read-back 全闭环补红测。

### 7.4 当前 Git 事实

- 当前分支：`backup/web-convergence-checkpoint-20260817-154248`
- 当前 HEAD：`a508c2d fix(web): verify batch moves and scope magnifier hits`
- 本轮规格与红测尚未提交、未推送。
- 工作树原有/其他未归属项包含 `AGENTS.md`、`.agents/`、`.claude/`、`CLAUDE.md`、`test-results/`。不得删除、覆盖或连带提交，除非先查清归属并获得授权。
- 本轮新增/修改包括 `openspec/`、上述测试、`program_stdlib.py`、`program-worker.py` 与本交接文档；局部运行时实现尚未提交、未推送。
- 用户已明确要求更新本文后停止；接手方应从当前工作树核验差异，不假设局部代码已经成熟。

## 8. 已完成的代码影响分析

GitNexus 先前分析结论：

- `createProgramRuntimeScheduler`：上游风险 **HIGH**，直接影响 legacy adapter、composition 和 Graph server 等公共入口。
- `createCommitCoordinator`：上游风险 **HIGH**，直接影响事务持久化。

因此：

- 不得把 Form/工单逻辑随意散入公共调度器。
- 优先把纯验证/编译逻辑放在受保护的 Python 标准库或模板库，worker 只做最小世界交互和效果收集。
- 回执扩展保持向后兼容，不破坏旧回执读取。

GitNexus 索引当时落后代码约 10 个提交；接手时应先刷新索引或用当前文本搜索交叉验证，不把旧索引当最新事实。

## 9. 建议的下一步实施顺序

1. 先复核当前未提交局部实现与聚焦测试结果，不要重复从零开发，也不要把 7/8 误报为闭环完成。
2. 修正 `validate` 的必要内容判断，使其报告精确缺失路径；再补工单写入经过既有事务链的证据。
3. 逐项接 fill、validate、submit、reject、revise、read-back，每项先红后绿。
5. 证明所有效果继续经过现有 Transform/修订/事务闭环，补并发冲突和无部分提交证据。
6. 再扩展紧凑回执、有界诊断与可重建年轮索引。
7. 在顶层专用 `test` Atom 内跑真实 create → fill → validate → submit → read-back，不修改业务数据。
8. 跑聚焦单测、集成、事务、Program 运行时、CLI、Web 和端到端套件，记录验收证据。
9. 只在行为确实实现且证据通过后勾选 OpenSpec 任务；不得按计划意图勾选。

## 10. 完成判定与汇报规则

不得使用以下任一项单独宣称完成：

- 写了代码。
- 单元测试局部通过。
- OpenSpec 校验通过。
- 能生成 Output/Step/Criteria 三个节点。
- CLI 返回了成功字样。

只有以下证据同时成立才可交付：

1. 全部 18 项 OpenSpec 任务在真实完成后勾选。
2. 工单七动作闭环在真实 Program/Transform/事务路径上跑通。
3. 幂等、精确版本、冲突拒绝、歧义拒绝、无部分提交都有回归证据。
4. 专用顶层 `test` Atom 的真实闭环已回读，且业务世界未被测试污染。
5. 年轮可从中央记录重建，日志容量与私密边界测试通过。
6. CLI 与 Web 使用同一契约、动作、错误和回执，不是仅某一端“看起来可用”。
7. 焦点套件与相关全量回归通过，没有让已有 Atom 能力回退。

## 11. 权威参考顺序

接手时按以下顺序判断，后者不得反向覆盖前者：

1. 用户在当前任务中的明确边界与本交接文档的“不可歪曲”条款。
2. `openspec/changes/add-work-order-form-runtime/specs/`。
3. `openspec/changes/add-work-order-form-runtime/design.md`。
4. 原始工单交接文本：`C:\Users\worker\.codex\attachments\195dff7a-8e1c-4966-a93c-e780acd81661\pasted-text.txt`。
5. 现有测试契约与当前代码事实。
6. 讨论中的比喻、未来设想和实现偏好。

如以上来源真正冲突，先更新 OpenSpec 使其与用户最新明确需求一致，再继续实现；不得私自忽略或让用户代做技术取舍。

## 12. 恢复开发后的最终实施与验证状态

本节覆盖第 7—10 节记载的历史暂停点。当前 `add-work-order-form-runtime`
的 18 项任务均已按实际实现和验证勾选，未提交、未推送。

### 12.1 已实现的交付主干

- `form()` 继续只编译 `name/detail/children/partners` 四个权威轴。
- `work_order()` v1 已实现 create、fill、validate、submit、reject、revise、read-back；
  精确版本、稳定创建身份、状态流转、负责节点缺项与幂等回放均有断言。
- 工单 Program 效果已通过真实 Transform、访问检查、修订比较和中央事务提交；
  同一旧修订并发写至多一个成功，非法多组填写无部分事实和无事务回执。
- Program 专用完整 detail 意图将 `.rep.`、`.sum.` 等用户正文视为不透明文本，
  不再让正文中的点号字样被误解析为 Transform 指令。
- 提交回执已带受影响 Atom、Graph 轴、时间和来源，且旧回执兼容。
- 读取与 Program 诊断已持久化到独立有界文件；年轮索引可从回执和诊断重建，
  压缩后仍保留所有紧凑事件与最新安全回滚快照。
- `work-order-registry.json` 是 Program、CLI 和 Web 的同一注册表来源；CLI
  `--work-order-registry`、HTTP GET `/__atom/api/work-order-registry` 与 Web Help
  使用相同动作、错误和提交回执字段。
- 公共架构与运维说明见 [work-order-form-runtime.md](./work-order-form-runtime.md)。

### 12.2 可复核验收证据

以下结果均为 2026-08-20 在当前工作树重新执行所得：

1. `openspec validate add-work-order-form-runtime --strict`：通过，change valid。
2. 工单、事务、Program、CLI、Web、年轮和架构边界相关全套：154/154 通过；
   最终又收紧“创建必须显式给出精确版本”和 `submit` 条件输入公开契约，相关核心链
   57/57 复跑通过。
3. 隔离顶层 `test` Atom：真实 create → fill → validate → submit → read-back
   在一个中央提交中通过；非法填写无部分写入；并发旧修订至多一个提交。
4. 年轮/交互/服务聚焦组：24/24 通过。
5. Web 共享注册表 Chromium 实际渲染：1/1 通过，页面动作、错误和回执字段与
   HTTP 注册表逐项一致。
6. 全部 Node 测试：875/877 通过。剩余两项均位于 `tests/render-contract.test.js`，
   仍要求 `renderScene()` 直接调用 `drawStars()`/`drawDomainBackdrop()`，而当前
   HEAD `a508c2d` 已使用 `drawStaticBackdrop()`；`spatial-engine.js` 与这两项断言
   相对 HEAD 均无本轮差异。因此它们是当前仓库既有渲染断言基线不一致，不能写成
   本轮功能通过，也不能为追求全绿而篡改无关断言。
7. 完整 Chromium 关键旅程：6/7 通过；本轮新增工单旅程通过。剩余既有
   double-Shift 批量落位旅程在全套和单独复跑中均于 30 秒超时；本轮对该文件的
   唯一差异是在原有旅程前新增工单注册表测试，没有修改失败旅程或空间引擎。

### 12.3 当前 Git 事实

- 分支：`backup/web-convergence-checkpoint-20260817-154248`
- HEAD：`a508c2d`
- 所有本轮实现、规格、测试和文档仍在工作树中，未提交、未推送。
- `AGENTS.md`、`.agents/`、`.claude/`、`CLAUDE.md`、`test-results/` 等原有或
  其他未归属项未删除、未覆盖、未纳入完成结论；浏览器复跑只在现有
  `test-results/` 下刷新了测试工具产物。

结论边界：可以交付“工单/Form/年轮变更已由相关全套和真实端到端验证通过”；
不得交付“仓库全部 877 项或全部 7 项浏览器旅程全绿”。
