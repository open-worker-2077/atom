## 1. Program 创建契约

- [x] 1.1 增加 Program 四轴创建、缺失父节点、重复目标和点号更新兼容的失败测试，并逐项确认失败原因来自缺失能力
- [x] 1.2 提取 CLI 与 Program 共用的创建执行路径，并让 Program 编译器仅把完整无指令四轴对象标记为创建
- [x] 1.3 将 Program 创建接入初始效果应用与多轮协调，保持验证、顺序、修订检查和中央事务原子性

## 2. 备份仓 Program 激活边界

- [x] 2.1 增加默认备份仓深层 Program 不执行、不可由 use_program 调用且恢复到活动区后可执行的失败测试
- [x] 2.2 依据 backup/default 类型及祖先链生成活动 Program 集，并统一用于调度、缓存、显式运行和 worker 可调用目录

## 3. 可发现契约

- [x] 3.1 增加 CLI Help 与公共函数注册表的行为测试，覆盖创建判别、更新写法、None 返回和回读要求
- [x] 3.2 更新 Help 与 transform 注册元数据，同时保持注册表 v2 和既有粗粒度分类兼容

## 4. 验证与交接

- [x] 4.1 运行定向 Program/Transform/Scheduler/CLI 测试、OpenSpec 严格校验和完整测试套件
- [x] 4.2 重启 4784 服务并仅在 test 域运行既有 ESG 创建探针，以 exact explore 确认创建且普通读取不再受备份 Program 拖累
- [ ] 4.3 向来源任务发送结构化故障修复回执，提交并推送本次软件与 OpenSpec 改动且不纳入用户原有 AGENTS.md 改动
