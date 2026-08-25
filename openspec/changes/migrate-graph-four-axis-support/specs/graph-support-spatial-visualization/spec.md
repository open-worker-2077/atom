# graph-support-spatial-visualization Specification

## Purpose

将 owner-local support 与真实枢纽投影为可审计的空间连接。

## ADDED Requirements

### Requirement: Web 只画显式 if→then
Web SHALL 从 antecedent 向 consequent 绘制箭头，current side 只由 modifier 得出；不得推导逆命题或使用 reverse 类方向标记。

#### Scenario: 两侧登记
- **WHEN** 分别存在 A→B 与 B→A
- **THEN** Web 显示两条独立规则与箭头

### Requirement: 真实 hub 不得被抹除
M→N SHALL 投影为 M→真实 hub→N。Web MAY 视觉压缩间距或线干，但 MUST 保留 hub 的 identity、命中、situation/Program 摘要与两条 owner rule。

#### Scenario: 3→hub→3
- **WHEN** H 声明 (A∧B∧C)→H 和 H→X/Y/Z
- **THEN** Web 显示 H 节点、输入共享线干与输出分支，而非一条无节点 3→3

### Requirement: 复合前件拓扑保序
and/or Expr SHALL 按嵌套和 ordinal 构造输入分支与 junction；逻辑结构和视觉布局分离但拓扑一致。

#### Scenario: A and (B or C)
- **WHEN** H 的入线含嵌套 Expr
- **THEN** 分支层级、顺序和 H 终点均可检查

### Requirement: 分流 junction 仅影响视觉
hub→N 的共享线干与输出分支 MAY 默认在约 0.5 处分流；位置 MUST NOT 反写 Atom 或改变逻辑。

#### Scenario: 重排视图
- **WHEN** 用户调整 junction
- **THEN** atom.json 与 rule signature 不变

### Requirement: CLI/Web 投影一致
CLI 与 Web MUST 使用同一 rule id、owner/current side、Expr ordinal、then ordinal 和 hub identity。

#### Scenario: CLI 与 Web 比对
- **WHEN** 同一显式 hub 流被 CLI 回读并由 Web 渲染
- **THEN** 两端方向、顺序、规则数与 hub identity 一致
