## Purpose

使 Web 能从既有 support clause 稳定呈现复合推支的共享汇流、干线与分流，同时保持 Atom 四轴事实、普通二元关系和局部投影边界不变。

## ADDED Requirements

### Requirement: Clause identity and endpoint roles are preserved
系统 SHALL 直接使用现有 support clause 身份、`antecedentPaths` 事实前项、`dependencyPaths` 唤醒依赖、后项顺序与端点角色形成一项投影；独立 `thing@program` SHALL 只作为推支判定角色，普通前后项 SHALL 只作为事实端点，不得从布尔表达树或节点名称反猜事实分组或布尔值。

#### Scenario: Compound clause projection identity
- **WHEN** 一个已判定为 true 的 clause 包含多个普通前项、一个独立判定 Program 和多个普通后项
- **THEN** 投影产生一项具有原 clause identity、前项路径、判定 Program 路径及有序后项角色的复合组

### Requirement: Fan-in shares one outgoing trunk after 50 percent
系统 SHALL 将 N→1 clause 的普通前项分别连接到位于可见端点归一化路径 0.5 的唯一汇合点，并从该点仅绘制一条进入后项的共享干线。

#### Scenario: N-to-one fan-in geometry
- **WHEN** 同一可见 clause 具有两个或更多普通前项和一个普通后项
- **THEN** 所有前项分支在 0.5 汇合，汇合后到后项只有一条带正确方向的干线

### Requirement: Fan-out shares one incoming trunk before 50 percent
系统 SHALL 将 1→N clause 的唯一普通前项通过一条共享干线连接到位于可见端点归一化路径 0.5 的唯一分叉点，再分别连接各有序后项。

#### Scenario: One-to-N fan-out geometry
- **WHEN** 同一可见 clause 具有一个普通前项和两个或更多普通后项
- **THEN** 分叉前只有一条干线，所有后项分支从 0.5 分叉且保持 `thenOrdinal` 顺序

### Requirement: Many-to-many has a centered shared trunk
系统 SHALL 允许同一既有 clause 表达 N→M；汇合点与分叉点 SHALL 均以归一化路径 0.5 为语义位置，并允许仅为可读性施加对称的最小屏幕空间偏移，从而形成非零共享干线。

#### Scenario: N-to-M compound geometry
- **WHEN** 同一可见 clause 具有多个普通前项和多个普通后项
- **THEN** 投影依次呈现前项汇流、以 0.5 为共同语义位置的非零共享干线及后项分流，并以同一 clause identity 标记全部分段

### Requirement: Ordinary binary support remains compatible
系统 MUST 保持 1→1 普通 support 的既有直接连线、方向箭头、燕尾、标签与交互身份，不得为其创建复合汇合点或分叉点。

#### Scenario: Binary support projection
- **WHEN** 一个 clause 只有一个可见前项和一个可见后项
- **THEN** Web 继续绘制一条从前项直接到后项的普通 support 线

### Requirement: Projection is visible-scope only and fact preserving
系统 SHALL 仅计算端点全部位于当前可见关系团的复合 clause，计算与交互不得写入 Atom 事实、改变 Atom revision 或触发全域 Graph/Program 投影。

#### Scenario: Current visible group projection
- **WHEN** 当前场景只包含世界中一个局部关系团
- **THEN** 仅该团内端点完整可见的 clause 形成几何，其他 clause 不被扫描绘制，Atom revision 保持不变
