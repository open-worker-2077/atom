# Superpowers 上游兼容清单

本清单只登记工作区对官方 Superpowers 的补充差异及上游核对结果。官方 Skill 保持只读；Atom 的需求、实施状态和证据仍由既有规格、计划与唯一总账承载。

## 当前核对基线

- **上游来源**：`obra/superpowers`
- **上游版本**：Superpowers 6.3.0
- **Manifest SHA-256**：`D7AC84A700062E865715F75626945A2A3324778C68DBA1A543C7ED41E48DEF10`
- **本地规则源**：工作区 `D:\Project\〇\AGENTS.md` 的“Superpowers 连续性补充”
- **检查时点**：每个新 Session 首次开展实质开发时读取已安装插件 manifest
- **触发条件**：版本、来源或 manifest SHA-256 任一项变化

## 本地差异

| 编号 | 补充目的 | 上游主要核对位置 | 6.3.0 结论 |
| --- | --- | --- | --- |
| SP-L01 | 用户顺序、依赖、紧急度、重要度和交付层级共同决定持续执行顺序 | `using-superpowers`、`writing-plans`、`executing-plans` | 继续补充 |
| SP-L02 | 新结论即时写回现有规格、计划或唯一总账 | `writing-plans`、`executing-plans` | 继续补充 |
| SP-L03 | 验证从直接影响链逐级升级，最终候选只做一次必要全量 | `test-driven-development`、`systematic-debugging`、`verification-before-completion` | 继续补充 |
| SP-L04 | 局部阻塞只限制依赖步骤，其余已批准工作持续推进 | `executing-plans`、`systematic-debugging` | 继续补充 |
| SP-L05 | 推送后按精确 revision 等待 GitHub 检查终态并收口红灯 | `verification-before-completion`、`finishing-a-development-branch` | 继续补充 |
| SP-U01 | 上游升级时逐项核对全部本地差异 | 全部相关 Skill 与插件 manifest | 继续补充 |

## 升级核对

- **完整读取**：读取新版插件 manifest 和每项所列相关 Skill 的完整原文，不能只看发布说明或文件名。
- **逐项结算**：每个稳定编号分别标记“上游已覆盖”“继续补充”或“冲突待裁定”，并附上新版原文位置；不得用整体判断代替逐项核对。
- **退出重复**：上游已经完整提供同一作用时，移除对应本地规则并保留本次核对记录，避免双重规则产生漂移。
- **保留缺口**：上游没有提供同一作用时继续沿用本地规则；上游与用户定论冲突时停止自动合并，由用户裁定。
- **更新基线**：全部编号结算后，同时更新本页版本和项目既有总账中的核对结论；缺少任一编号时不得宣称升级核对完成。
