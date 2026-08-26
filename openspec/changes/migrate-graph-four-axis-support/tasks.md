# Tasks

## 1. 语言与规范形

- [x] 1.1 四轴闭集、旧轴关闭与 schema/registry 单源
- [x] 1.2 current modifier 严格 true、恰好一个与 O(1) owner 分类
- [x] 1.3 thing/thing@program/and/or Expr、then 保序、selector 与稳定错误
- [x] 1.4 拒绝无 current、current 两侧/重复、线载源码与原生 M→N
- [x] 1.5 建稳定 rule id、owner/dependency/endpoint 索引且不复制持久声明

## 2. 运行时适配

- [x] 2.1 Transform/批量改名移动复制递归保持 rule selector 与顺序
- [x] 2.2 Explore/CLI 从任一端读取唯一 owner 声明并直接展示 if→then
- [x] 2.3 Program AtomView/锁/trigger/Form/工单/槽体统一四轴
- [x] 2.4 前件 Program strict bool 且无效果，后件 Program 自算不被前件代写

## 3. 迁移与数据安全

- [x] 3.1 备份 manifest、哈希、恢复与事务边界
- [x] 3.2 递归迁移 name/detail/children 与空 partners
- [x] 3.3 非空 partners 保持原字符/顺序且隔离于新 support 推理，正文同名字符串不误改
- [x] 3.4 旧 Program/模板做 AST 定位、结构 token 源码升级与歧义批量阻断；普通字符串和业务计算不改

## 4. 投影、Web 与 Help

- [x] 4.1 投影输出 owner/current、rule id、Expr ordinal 与真实 hub identity
- [x] 4.2 Web 渲染 M→hub→N、共享线干、约 0.5 junction 且不隐藏 hub
- [x] 4.3 Web 编辑只生成 owner-local 1→1/1→N/N→1，不生成无 owner/M→N
- [x] 4.4 Help/CLI/错误移除旧方向标记、旧轴、线载源码和原生 M→N 示例，并说明 Program 端点边界

## 5. 测试与验证

- [x] 5.1 覆盖 1→1、1→N、N→1、and/or、嵌套、短路与 selector
- [x] 5.2 覆盖 M→hub→N、普通/Program 端点、bool true/false、效果拒绝与后件自算
- [x] 5.3 覆盖 O(1) owner、端点 Explore、无复制、循环不无限调度
- [x] 5.4 覆盖迁移守恒、正文不误改、备份回退、旧入口关闭
- [x] 5.5 覆盖 Help、CLI、Program、Web、槽体/窗口/Form/工单与全量回归
  - Node 全量回归 1051/1051、相关桥接/空间/渲染契约 158/158、Playwright 真实浏览器旅程 7/7 通过。
  - 浏览器门禁根因已修复：权威数据到达前暂停昂贵占位星图渲染；事务期间只允许同修订的新域补载并保留当前事务，首次进入不再为空。
- [x] 5.6 strict OpenSpec、diff check、GitNexus detect_changes 与本地提交
  - strict、diff check、脚本语法检查与 GitNexus detect_changes 已完成；浏览器门禁通过后形成独立分支本地提交。

## 6. 真实世界兼容读取与预检

- [x] 6.1 为旧/新持久快照增加版本化规范化与 provenance；公开 parser/写入仍严格四轴
- [x] 6.2 兼容快照允许初始化、查询、投影和受控新四轴写入，不长期锁成只读
- [x] 6.3 单遍预检完整聚类节点、partners、Program、默认备份与 exact test 报告分类，不首错退出
- [x] 6.4 输出 revision/facts hash、Program before/after hash、edits/blockers 与可机器判定门禁

## 7. 无损迁移与 Program 隔离

- [x] 7.1 仅做外层 partners→support 并保留 legacy entry 原数组，验证节点/拓扑/字符/顺序/语义守恒与公开伪造拒绝
- [x] 7.2 用 AST 生成只覆盖 Graph API dict key/可证明 AtomView 属性的最小 source edits；复检旧 ABI 残留
- [x] 7.3 删除 worker/runtime legacy Program wrapper 与 manifest Program 授权；备份历史不可执行，活跃/test 全部新 ABI
- [x] 7.4 在备份验证后 revision-bound 原子提交四轴编码与 Program 升级，并可审计 rollback 原源码
- [x] 7.5 manifest 仅推进 legacy relation provenance；覆盖无关写、重启漂移与 Program ABI 不受 manifest 影响

## 8. 部署验证与交付

- [x] 8.1 红测覆盖 wrapper/授权彻底移除、唯一升级、歧义阻断、备份历史不执行和旧入口关闭
- [x] 8.2 用任意规模合成 fixture 覆盖 relation/Program 完整聚类、source edits 正反例及大型单遍性能；primary 数量仅进 evidence
- [x] 8.3 运行受影响组合、一次 Node 全量、strict OpenSpec、语法与 diff check
- [x] 8.4 更新 primary 只读部署门禁说明，GitNexus detect_changes 后本地提交并双向回执

## 9. Primary 阻断收口

- [x] 9.1 红测并修复部署脚本 `--isolated-root` 到 operation `testRoots` 的参数贯通，证明脚本计数与直接 planner 一致
- [x] 9.2 按 primary blocker AST 聚类扩展保守局部数据流证明，覆盖可归约 dynamic key/spec 与 AtomView 来源，同时保持真正动态和普通字符串阻断
- [ ] 9.3 在绑定 revision/fileHash 的同一 primary 只读快照取得42个可执行 Program 全部升级、`blockedPrograms=[]`，再跑聚焦/strict/diff/GitNexus并提交回执
