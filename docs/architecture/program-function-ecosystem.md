# Atom Program 函数生态与 Form 内核

## 主干

Atom 的功能目录由注册函数和 Atom 类型构成。注册函数提供可组合能力；`@program` 组织这些能力形成具体应用，但不另造一套 Graph 事实或分类体系。

## 注册函数

注册函数按实际功能分两层：

- **内核函数**：Graph 函数、Form 函数、Program 函数。
- **应用函数**：当前已有工单应用，后续应用自行形成适合其用途的粗颗粒家族。

Graph 函数包含 `explore`、`transform`、`lock` 和 Graph 结果辅助函数；Form 函数包含 `form` 及表单评估、状态和结构计划能力；Program 函数包含组合、交互、模板和通用执行辅助能力。这样的家族只用于整体导航，不把一次完整操作拆成许多顶层标签，也不参与运行分派。`work_order` 使用内核形成具体应用，因此属于应用函数。

权威机器目录可从三个等价入口读取：

```python
function_catalog({})
function_catalog({"layer": "kernel", "family": "graph"})
```

```powershell
atom.cmd --program-function-registry
```

```http
GET /__atom/api/program-function-registry
```

每个目录项除层级和家族外，只带简单的 `atom` 或 `public` 作用域属性。当前平台注册函数为 `public`：它表示函数可供 Program 使用，不表示平台预设公共路径、继承关系或应用结构。具体 Program 如何组合组件，仍由应用自行决定；锁、访问检查、Transform、修订和事务继续约束实际世界操作。

目录只读。Program 运行面没有修改受保护注册表或底层运行时源码的函数。

## Atom 类型

当前 `@program` 是内核类型，也是唯一可执行 Atom 类型。函数的内核／应用层级不会生成新的 Atom 类型；应用类型和新的形态字段仍待真实需求出现后再设计。

Agent 是普通 `thing@program` 的源码能力，不是 Key 类型。Program 的 Situation
中恰有一个顶层字面量 `agent({...})` 时，当前修订的派生目录才将其识别为
Agent Program；零个、多个、动态或嵌套声明均不注册。Agent Program 与其他
Program 使用同一调度器，并统一通过 `use_program()` 完成 Program 间分派。

Agent、锁、Jump、触发器及 Program 目录都是由不可变世界修订中的 Program
源码重建的修订绑定缓存，不持有世界事实，也不形成旁路权限。旧 `@agent`
格式只作为迁移输入被解释：活跃对象转换为带单一字面量声明的 Program，归档
对象降级为普通事实。应用操作消费不可变迁移计划、显式确认与已验证私密备份；
提交后才生成脱敏、持久、修订绑定的迁移回执，回滚操作以该回执为依据。

## Program 研发与注册边界

Agent 可按生产需要自行编写和研磨本 Atom 的 `@program`，并直接通过 `use_program()` 复用；不要求先获得平台注册，也不限制其研究深度。代码、组件和应用模式无论成熟或零碎，都可以成为后续提炼公共能力的素材。

平台保护的是正式注册入口和底层运行时本身，而不是限制 Agent 研发。当前 Program API 只提供 `use_program()` 等运行能力，不提供直接改写正式注册表或底层源码的函数；成熟素材是否进入正式应用函数或内核函数，是后续提炼、验证和注册行为。

以上操作边界统一由 `help` 暴露；注册表只保存运行所需的函数与类型事实，不承载组织身份或研发关系。

## 自适应 Form 内核

旧的 Graph 原生编译调用保持不变：

```python
form({
    "name": "极简单",
    "detail": "",
    "children": [{"name": "直接操作"}],
    "partners": []
})
```

组件评估使用显式 JSON 键值：

```python
result = form({
    "action": "evaluate",
    "components": [
        {
            "name": "定向",
            "activation": "required",
            "value": {"目标": "形成交付物", "边界": ""},
            "requirements": [
                {"path": ["目标"]},
                {"path": ["边界"]}
            ],
            "components": []
        },
        {
            "name": "调研",
            "activation": "disabled",
            "value": {},
            "requirements": [],
            "components": []
        }
    ]
})
```

外层 Program 必须为每个组件明确选择：

- `required`：始终参与校验；
- `optional`：没有投入使用时不形成缺项，出现自身或下级内容后按声明要求校验；
- `disabled`：整个子树不参与校验，也不要求填写跳过原因。

Form 只返回 `valid`、分类后的组件路径、实际参与评估的路径和精确 `missing` JSON 键路径。它不探索世界、不产生 Transform、不选择业务阶段、不决定推进顺序，也不修改状态。组件数量和递归嵌套自然决定单子规模，因此没有“最小／标准／大型”平台模式。

## 当前延期边界

- 不新增应用 Atom 类型或形态字段。
- 不自动把本 Atom Program 提升为公共函数。
- 不修改推进流模板的固定阶段；外层 Program 可采用 Form 评估结果自行形成应用逻辑。
- 不在本变更中实施 `use_program()` 的 Explore-ref 迁移。

## 实施历史

迁移前的控制材料和旧验证记录只作为历史证据保存在
[`docs/history/development-control/`](../history/development-control/)；当前合同、
实现和完成状态分别以批准规格、检出 revision 及绑定该 revision 的新鲜验证
证据为准。
