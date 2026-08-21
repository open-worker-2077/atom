## Why

应用侧 `@program` 已能声明 `transform(spec)` 效果，却无法用完整四轴 Atom 对象创建新节点；同时运行时会执行默认备份仓中的历史 Program，令无关超时进入正常交互路径。两者共同阻断了 ESG 工单批量生成，并使普通读取出现不必要的等待。

## What Changes

- 允许 `@program` 以完整 `name/detail/children/partners` JSON 对象声明创建效果，并复用 `transform new` 的父路径解析、重复名拒绝、Graph 校验、事务提交和回执语义。
- 保持现有带点号指令的 `transform(spec)` 更新行为兼容，不引入第二套 Graph 写法。
- 将唯一默认备份仓及其后代排除出可执行 Program 集；备份事实仍保留、仍可恢复，但不再参与锁、消息、选择或 Transform 计算。
- 在 Help 与 Program 函数注册信息中明确 `transform(spec)` 的创建判别、更新判别、返回值及错误边界。
- 增加单元、端到端和回归测试，覆盖创建成功、父节点缺失、同名冲突、现有更新兼容、备份 Program 不执行和活动 Program 仍执行。

## Capabilities

### New Capabilities

- `program-runtime-effects`: 规定 Program Transform 的创建与更新效果契约，以及默认备份仓对 Program 激活范围的边界。

### Modified Capabilities

无。

## Impact

- 受影响代码：Program worker、Program runtime scheduler、Program Transform 编译与执行、CLI Help、Program 函数注册表。
- 受影响接口：`@program` 内的 `transform(spec)`；现有更新写法保持兼容。
- 受影响运行行为：默认备份仓内的 `@program` 从“被执行”改为“仅保存、可恢复”。
- 无新增外部依赖；所有写入继续经过既有中央事务、修订检查和 Graph 投影校验。
