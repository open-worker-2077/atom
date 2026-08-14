# 贡献指南

## 开始之前

需要 Node.js 22 或更高版本、Git 与已登录的 GitHub CLI。阅读 `README.md`、`docs/ARCHITECTURE.md` 和相关 ADR，并确认工作对应真实 Issue 或用户明确要求。

```powershell
git switch main
git pull --ff-only
git switch -c agent/<topic>
npm.cmd test
```

## 修改边界

- 视觉交互层只负责空间呈现、视角、节点命中和视觉意图。
- 业务计算、权限、审批和数据流转不得进入3D引擎。
- 输入设备与功能意图分离；新增设备映射优先修改 `input-config.js`。
- 新增跨项目通用工作流时再考虑 Skill，单项目事实留在仓库文档与 GitHub。

## 测试与实际渲染

所有代码修改都必须运行：

```powershell
npm.cmd test
```

修改视觉或交互时还必须：

1. 用本地服务或文件入口实际打开页面。
2. 复现修改前的问题或基线。
3. 验证修改后的鼠标／键盘路径、域径和持久化结果。
4. 检查控制台错误与警告。
5. 在 PR 中附上必要截图或明确说明观感结论。

## 运行数据

`data/knowledge.json` 属于本机知识库，不参与版本控制。测试必须使用临时文件，禁止将用户节点、附件、域径或关系提交到 GitHub。暂存时使用显式文件列表，不使用 `git add -A`。

## Commit 与 Pull Request

- Commit 保持单一目的，标题使用简洁祈使句。
- PR 描述必须包含：修改内容、修改原因、用户影响、架构边界、自动化测试和实际渲染。
- 先创建 Draft PR；CI 通过且自检完成后转为 Ready。
- PR 合并后删除功能分支。

## Release

只有用户确认的稳定版本才能发布。Release 必须从合并后的 `main` 创建，并同步更新 `CHANGELOG.md` 与 `docs/releases/`。

