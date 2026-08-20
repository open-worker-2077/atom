## Why

Atom 现有 `form()` 只校验并编译 Graph 四轴，尚不能为不同规模、不同启用环节的外层 Program 提供统一的组件启用与缺项判断；注册函数也缺少可供 Agent 查询的粗颗粒内核／应用分类和 Atom 类型信息。继续把这些规则分别写进 `work_order()` 或推进流模板，会让应用流程反向定义内核。

## What Changes

- 保持旧 `form({name, detail, children, partners})` 编译写法兼容，同时增加纯计算的 Form 组件评估：外层 Program 显式选择组件为必需、可选或未启用，内核只计算有效组件和精确缺项，不预设阶段、规模、顺序或跳过理由。
- 允许组件递归嵌套；未启用父组件的整个子树不参与缺项判断，可选组件未投入使用时不形成缺项，从极简单子到多层单子使用同一契约。
- 继续只产生或读取 `name`、`detail`、`children`、`partners`；Form 评估不写世界、不发 Transform，也不增加持久化轴或应用类型。
- 增加唯一的 Program 注册函数目录：一级区分内核函数与应用函数，内核只保留 Graph、Form、Program 三个粗颗粒函数家族；`work_order` 属于应用。
- 注册函数只声明简单的本 Atom 或公共可见范围，不在内核预设公共层级、父级约束或应用方式。本轮平台注册函数均为公共，本 Atom 内的可执行封装继续使用 `@program`。
- 明确 `@program` 是内核类型且仍为当前唯一可执行 Atom 类型；本轮不设计应用类型或新的形态字段。
- Help 统一说明研发开放方式：Agent 可自由编写、研磨并通过 `use_program()` 复用本 Atom Program；Program 不直接修改受保护的注册表和底层运行时源码，但不限制使用方自行研发或提供成熟素材。
- 忽略子项目本地 Agent 集成目录和测试产物，Playwright 输出改到系统临时目录，不再把可重建工具文件混入软件源码工作树。
- 保持既有 `work_order()`、推进流模板和 `use_program({name, arguments})` 行为不变；不在本变更中实现应用模板自适应或 Program 引用迁移。

## Capabilities

### New Capabilities

- `adaptive-form-kernel`: Graph 原生 Form 的兼容编译、递归组件启用和通用缺项评估契约。
- `program-function-registry`: 注册函数的内核／应用分类、粗颗粒函数家族、简单公共作用域、Atom 类型、查询与 Help 暴露契约。

### Modified Capabilities

无。仓库尚无已归档的主规格；本 change 以新能力描述增量，并把已完成旧 change 作为兼容基线。

## Impact

- Program 可信 Python 标准库与 worker 注册命名空间。
- 新的共享 Program 函数注册表、Program 查询入口及 CLI/Web 只读暴露。
- CLI Help、Program 运行时说明和注册生态架构文档。
- Form、函数目录、简单公共作用域、旧编译兼容以及旧工单／推进流不回退的聚焦测试。
