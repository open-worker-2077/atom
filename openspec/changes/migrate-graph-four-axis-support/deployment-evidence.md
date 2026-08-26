# Primary read-only deployment evidence

## Evidence identity

- **来源**：总控提供的 primary 世界只读预检清单。
- **数据操作**：本专项未读取、写入或启动共享 4784，也未触碰正式 Atom/ESG。
- **source revision**：未随清单提供。
- **facts hash**：未随清单提供。
- **执行门禁**：`closed`。以下库存可用于评估覆盖面，不能单独授权迁移提交；排他部署前必须在同一只读快照重跑 planner，并绑定 source revision 与 facts hash。

## Reported inventory

- **节点**：11,038。
- **legacy partners**：706 条，分布于 578 个节点。
- **Program**：93 个。
- **旧 Graph ABI Program**：47 个。
  - typed default backup：5 个。
  - 调用方 exact test 隔离域：36 个。
  - 活跃非 test：6 个。

## Candidate evidence

- **大型合成预检**：1,621 节点、3,000 条 legacy relation、120 个旧 ABI Program；完整聚类与守恒检查通过，未把实例数量硬编码进内核。
- **组合聚焦**：四轴持久兼容、槽体相对域、jump/changed、window self-lock、事务与投影 93/93 通过。
- **Node 全量**：首次 1,102/1,103，唯一失败为 operations 向 work-engine 的禁止反向依赖；模块归位后关键回归 28/28，最终全量 1,103/1,103 通过。
- **部署前动作**：总控排他读取 primary → 生成 revision/hash 绑定报告 → 核对上述库存分类 → 验证备份 → 才可执行原子编码升级。
