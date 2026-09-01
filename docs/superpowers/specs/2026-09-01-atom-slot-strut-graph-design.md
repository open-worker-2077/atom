# Atom Slot / Strut Graph 设计

## 1. 目标与边界

- **唯一终态**：Atom Graph 的四个权威逻辑轴为 `thing`、`situation`、`slot`、`strut`。
- **语义归属**：Atom Help 定义 Graph 世界的基础交互规则；`manage/包办/办包` 只承载进入 Graph 后的日常事项管理。
- **单轨切换**：正常运行时代码、CLI、Program、投影与持久数据不兼容 `contain`、`support`；旧字段只允许被一次性迁移器读取。
- **后续范围**：Shortcut、ASDF 双击命中、支线贴边和 CLI 更新导致视图紊乱等 Web Bug，在本迁移验收后依次修复。

## 2. 权威本体

- **Thing**：可被识别、引用和操作的事物，拥有稳定身份。
- **Situation**：Thing 当前承载的正文、事实、规则或 Program 内容。
- **Slot**：Thing 面向上下级的递归位置结构。
  - 节点面向上级时，是上级 Slot 中已填写的槽料。
  - 节点面向下级时，自身继续作为 Slot，定义下级槽料的位置和组织。
  - 向上钻取得类别、归属、用途和语境；向下钻取得组成、属性、参数和内部结构。
- **Strut**：Thing 面向相邻 Thing 的支撑结构。
  - Strut 保存支撑的前项、后项、判定条件与可审计关系身份。
  - Thing 可接受 Strut 支撑，也可成为支撑其他 Thing 的 Strut。
  - Strut 强调承托、传力和稳定，不表达网络端口或交通通道。

## 3. 合同矩阵

| 边界 | Slot 合同 | Strut 合同 |
|---|---|---|
| 持久化 | `slot` 数组保存直接下级槽料 | `strut` 数组保存 owner-local `if→then` clause |
| Explore | `slot$latitude±N`、`slot$longitude±N` 钻取 | `strut` 回读相关支柱及 owner 声明 |
| Transform | new、move、rename、discard、restore 维护整棵 Slot 子树 | replace、路径重写和事务提交维护 Strut 端点 |
| Program | `transform()` 只接受新四轴；槽例相对路径沿 Slot 解析 | `trigger("strut", ...)` 接收 strict-true typed delivery |
| 权限 | Agent 窗口、节点锁和子树锁沿实际 Slot 链裁定 | Strut 引用不携带权限，也不扩大窗口 |
| 投影 | Slot 生成递归空间层级 | Strut 生成支柱线、汇流和分流投影 |

## 4. 运行结构

- **唯一入口**：Help、CLI、HTTP、Web 与 Program 都进入同一个新四轴解析器和中央事务。
- **现有槽体**：`slot_body` 是 Slot 范式上的槽模、槽例和填料特化，不再另成一套“槽”定义；内部层级和相对选择器统一沿 `slot`。
- **技术端口**：源码中的 repository port、runtime port 和 TCP port 保持原技术含义；不得与 Graph `strut` 混为一谈。
- **派生命名**：活跃代码中的 Strut runtime、strut clause/index/delivery/trigger 与 Slot traversal/lock/placement 全部改为 Strut 与 Slot 命名。
- **版本边界**：新 Graph Schema 版本为 `3.0.0`；正常加载旧四轴时返回稳定的 retired-axis/schema 错误。

## 5. 数据迁移与安全

- **迁移前备份**：复制完整世界文件并记录字节长度、内容哈希和源修订；备份只防数据事故，不构成旧逻辑运行能力。
- **原子转换**：一次性把所有 Graph key 的 `contain` 改为 `slot`、`support` 改为 `strut`，同步更新 Program 源码中的公开 Graph ABI 和持久路径声明。
- **守恒校验**：迁移前后 Thing 稳定身份、节点数量、父子次序、Situation 字节、类型、锁、Shortcut、Agent/Program 和关系 clause 数量守恒。
- **提交方式**：通过 Atom 官方维护事务写入，不直接手工编辑实际 `atom.json`；迁移失败不发布部分世界。
- **后续运行**：迁移成功后只向前修复新实现；不恢复旧字符，不在运行时增加双读双写。

## 6. 验收

- **Help 唯一**：`atom.cmd --help` 只教授 `thing/situation/slot/strut`，并完整解释递归 Slot 与相邻 Strut。
- **代码单轨**：活跃生产代码、公开 API、Program registry、CLI 和 Web 投影不再暴露 Graph `contain/support`。
- **旧轴拒绝**：正常解析、Explore、Transform 和 Program 对旧字段稳定拒绝，不静默迁移。
- **真实迁移**：实际世界经官方事务迁移并通过守恒、冷启动、CLI 回读和 Web 投影验证。
- **回归完整**：权限、Agent 迁窗、槽体、Shortcut、Program 调度、备份域与中央事务测试均在新轴上通过。
