# Agent Guidance

## 事实源

按以下顺序判断项目状态，不依赖历史聊天：

1. 最新 GitHub Release：稳定验收基线。
2. `main`：已经合并的当前实现。
3. 开放 GitHub Issues：真实待办、缺陷与研究课题。
4. 当前 PR：尚未合并的修改与验证证据。
5. `README.md`、`CONTRIBUTING.md`、`docs/ARCHITECTURE.md` 与 `docs/adr/`：长期规则与决策。

开始工作前先运行：

```powershell
git status -sb
gh release view --repo player-314159/graph-4d
gh issue list --repo player-314159/graph-4d --state open
npm.cmd test
```

## 项目主线

本项目用三维空间、球域和节点网络替代传统表单／卡片式交互。3D 范式负责视觉呈现、视角旅行、节点命中与空间导览；业务计算、审批、权限和数据流转仍由外部脚本负责。

必须保持：

- 所有载体都是可进入的隧洞球；是否已有子节点不决定其未来可扩展性。
- 球镜是独立展示层，不替代子域拓扑。
- 物理按键只映射视觉意图，不能写死为业务功能。
- 普通同层关系、父子关系和跨域关系保持不同视觉语法。
- 不把界面退化为卡片、表格、工业仪表、蓝图网格或暖色科普行星页。
- 当前工作不得把视觉层扩张为业务数据流脚本。

## 文件地图

- `spatial-engine.js`：相机、投影、命中、球域旅行和 Canvas 绘制。
- `spatial-visual-model.js`：纯视觉模型、关系路由与稳定排版。
- `spatial-workspace-model.js`：节点、关系、跨域落脚和知识快照模型。
- `input-config.js`：设备输入到视觉意图的映射。
- `spatial-browser-bridge.js`：浏览器与本地知识文件之间的桥。
- `cli/`：全局 `spatial` CLI 与本地服务。
- `SPATIAL-GRAMMAR.md`：空间语法规范。
- `docs/ARCHITECTURE.md`：系统边界与依赖方向。
- `docs/adr/`：已经采纳的架构决策。

## 数据安全

- `data/knowledge.json` 是本机运行数据，不是源代码；禁止提交、覆盖或用测试数据替换。
- `*.baiduyun.uploading.cfg`、日志与临时文件禁止进入版本库。
- 持久化测试必须使用测试框架临时目录或独立临时存储。
- 工作区混有用户数据时只显式暂存目标源码文件，禁止 `git add -A`。

## 开发与验收

- 从 `main` 创建 `agent/<topic>` 分支，通过 PR 合并。
- 功能和缺陷遵循测试先行；完整验证运行 `npm.cmd test`。
- 修改视觉表现或交互后必须实际浏览器渲染并保存必要截图。
- PR 必须说明范围、边界、测试、实际渲染结果以及是否触及知识数据。
- 用户确认稳定版本后再创建 Tag 与 GitHub Release。

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **atom-4784** (26770 symbols, 63222 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user. For unified PDG impact, add `mode: "pdg"` with optional `line: <N>` — it returns statement-level `affectedStatements` over CDG + REACHING_DEF and inter-procedural symbols in `interproceduralByDepth`/`byDepth`; no-layer/degraded PDG results are UNKNOWN-risk notes (`--pdg` layer).
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "main"})`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({search_query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).
- For control/data dependence, `pdg_query({mode: "controls", target: "fileOrSymbol"})` answers "under what condition does X run?" (CDG, incl. guard clauses) and `pdg_query({mode: "flows", target, variable})` traces "where does variable Y flow?" (REACHING_DEF). `--pdg` layer.

## Never Do

- NEVER edit a function, class, or method without first running `impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit changes without running `detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/atom-4784/context` | Codebase overview, check index freshness |
| `gitnexus://repo/atom-4784/clusters` | All functional areas |
| `gitnexus://repo/atom-4784/processes` | All execution flows |
| `gitnexus://repo/atom-4784/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
