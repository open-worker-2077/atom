# Atom Program 函数生态与 Form 内核

## 主干

Atom 的可执行世界只有一套 Graph 事实。注册函数是 Program 操作、组织和运行该世界的公共能力；使用方在具体生产中通过本 Atom 的 `@program` 自主组合能力，后台研发从生产涌现中筛选素材并沉淀公共应用或内核。

## 四个独立维度

以下维度不能互相代替：

1. **函数层级**：内核函数或应用函数。
2. **二级类别**：函数实际支持的稳定能力职责，例如 Graph 世界操作、结构与约束、Program 执行与组合、工单应用。
3. **作用域**：本 Atom 或公共。
4. **Atom 类型**：当前 `@program` 是内核类型，也是唯一可执行类型；函数层级不产生新的 Atom 类型。

`explore` 与 `transform` 是 Graph 世界操作的读取和变更两个方向，在目录中属于同一二级类别。`form` 是内核的结构与约束能力。`work_order` 使用内核形成具体应用，因此属于应用函数。

权威机器目录可从三个等价入口读取：

```python
function_catalog({})
function_catalog({"layer": "kernel", "category": "graph-world"})
```

```powershell
atom.cmd --program-function-registry
```

```http
GET /__atom/api/program-function-registry
```

目录只读。它描述公开契约，不赋予调用者修改底层代码或发布注册函数的权限。

## 本 Atom 与层级公共

作用域只有两类：

- **本 Atom**：使用方为当前 Atom 封装和运行 `@program`。
- **公共**：允许跨 Atom 使用的后台注册能力。

公共采用层级路径。位于某个公共父级之下的“局部公共”仍然属于公共，并继承所有上级公共约束；系统不再定义独立的“授权跨 Atom”第三类作用域。公共层级是契约继承，不替代既有锁、访问检查、Transform、修订和事务权限边界。

## 使用方与后台研发方

所有不负责 Atom 底层软件代码、以现实生产产出为首要目标的参与者都属于使用方。领域专业化只改变使用场景，不改变其使用方身份，也不允许其直接修改受保护内核或公共注册表。

使用方不承担底层通用性判断：

```text
使用方按生产 ROI 编写本 Atom Program
→ 代码、组件和应用模式自然形成素材
→ 后台结合紧急重要实例筛选
→ 深度提炼、验证和稳定化
→ 沉淀为公共应用函数或内核函数
```

任何碎片都可能包含可提炼的通用规律。当前限制是研发成本、方法成熟度和事项优先级，不是素材的先验资格。系统不会自动复制、发布或强制版本化本 Atom Program；后台研磨是独立研发行为。

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
- 不自动把使用方 Program 提升为公共函数。
- 不修改推进流模板的固定阶段；使用方可在自己的 Program 中采用 Form 评估结果自行形成应用逻辑。
- 不在本变更中实施 `use_program()` 的 Explore-ref 迁移。

## 验证记录（2026-08-20）

- OpenSpec 严格校验通过。
- Form、Program 标准库、工单、推进流、CLI/Web 和数据边界聚焦回归 60/60 通过。
- 架构测试 10/10、系统测试 87/87 通过。
- 浏览器构建通过；完整仓库回归 885/887 通过。
- 两项未通过均位于既有 `tests/render-contract.test.js`：仍断言旧的
  `drawStars()/drawDomainBackdrop()` 调用，而当前渲染器使用
  `drawStaticBackdrop()`。本变更未修改渲染器或渲染契约测试，不将这两项
  既有基线失败表述为本变更完成。
