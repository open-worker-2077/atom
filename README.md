# Atom · 可执行的高维事实世界

[![CI](https://github.com/open-worker-2077/atom/actions/workflows/test.yml/badge.svg)](https://github.com/open-worker-2077/atom/actions/workflows/test.yml)

Atom 让事实、关系、逻辑与交互存在于同一个可持续演化的世界中。Graph 是这个世界的一种空间投影，不是 Atom 本身。

## Atom 解决什么

知识往往分散在文档、图、脚本和对话中：人能看见一部分，Agent 能读取另一部分，但两者难以在同一事实基础上稳定协作。

Atom 将内容、包含关系、有向关系、可执行逻辑和交互窗口统一到同一事实世界，使人、Agent 和 Program 能够：

- 围绕同一份事实读取、判断和改变；
- 从局部进入复杂上下文，而不丢失整体关系；
- 让规则、约束和推进逻辑直接作用于世界；
- 确认改变已真正提交，不被过期界面状态覆盖。

## 核心构成

| 构成 | 在 Atom 中的作用 |
| --- | --- |
| **Atom** | 承载可持续识别的事实，并通过包含与有向关系组成世界 |
| **Program** | 承载规则、判断、约束、推进与自动化，让世界具有可执行性 |
| **Agent** | 作为可指定的交互窗口，使任意任务能在明确上下文中工作 |
| **Spatial Interaction** | 将同一事实世界投影为可进入、可观察、可编辑的多尺度空间 |

Atom 使用 JSON 表达当前事实数据，并使用 Python 承载当前 Program 运行时。它们是可替换、可演进的实现载体，不是 Atom 的定义边界。

## 开始使用

需要 [Node.js 24+](https://nodejs.org/)。

```powershell
npm install
npm start
```

启动后打开终端输出的 `http://127.0.0.1:4784/`。Web 与 CLI 使用同一事实世界；不要直接打开 `index.html` 代替服务入口。

Agent 和工程工具通过公开 CLI 契约交互：

```powershell
atom.cmd --help
atom.cmd --agent "已创建的 Agent 窗口"
```

变量、多行文本或特殊字符通过标准输入传递：

```powershell
$request | atom.cmd --agent "已创建的 Agent 窗口" --stdin
```

## 当前能力边界

- 事实、包含关系与有向关系的统一表达；
- 人工 Web、Agent CLI 与 Program 的统一交互边界；
- 可执行 Program 及其失败隔离、取消与并发边界；
- 节点、详情、位置、关系与注册类型的持久编辑；
- 多尺度空间观察、局部聚焦和方向关系呈现；
- 事务提交、修订冲突、投影恢复与写后回读。

它仍在快速演化。当前代码与契约以 `main`、最新 GitHub Release 及通过的自动测试为准。

## 文档导航

- [架构说明](docs/ARCHITECTURE.md)：世界、运行时、交互和投影的责任边界
- [Program 运行时](docs/atom-program-runtime-2.5.md)：可执行逻辑的当前契约
- [架构决策](docs/adr/)：重要取舍及其原因
- [贡献指南](CONTRIBUTING.md)：开发与提交方式
- [版本记录](CHANGELOG.md)：已发布变化
- [Agent 接手规则](AGENTS.md)：Agent 在本仓库中的工作边界

## 项目状态

- 稳定版本：[Atom v0.3.0](https://github.com/open-worker-2077/atom/releases/tag/v0.3.0)
- 问题与需求：[GitHub Issues](https://github.com/open-worker-2077/atom/issues)
- 变更与评审：[GitHub Pull Requests](https://github.com/open-worker-2077/atom/pulls)
