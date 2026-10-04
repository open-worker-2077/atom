# 全局 Atom CLI 静默退出修复计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 恢复全局 atom.cmd 在当前受限调用中的正常 Help 和读取，并解释故障触发条件。
**Architecture:** 修复 CLI 对执行入口与导入模块的身份判断，保留导入无副作用合同。以真实全局调用与隔离回归共同验收。
**Tech Stack:** Windows、PowerShell、Node.js ESM、node:test。
**Spec:** 本计划的验收边界；唯一排队状态见 2026-09-03-atom-current-requirement-ledger.md。

## Global Constraints

- I3/U3/D2/E3；先安全备份、持久化、开启目标，再修复。
- 不改正式世界业务数据，不替 🌍 执行待办迁移；窗口由 session 提供，无全局默认 Agent。
- 不改变操作系统权限或要求使用者修改软件；真实全局入口须在默认受限调用中可用。
- 最小受影响链、真实入口、必要门禁、最终候选全量一次；推送后等待精确 revision 检查终态。

## 已取得证据

- 2026-10-05 回查 🌍 02:54—03:24（Asia/Shanghai）对话：阻断是全局 Help 空输出 exit0；业务迁移尚未执行。
- 当前默认调用复现同样症状。真实源码路径与 npm junction 路径均 stat/readFile 成功、realpath EPERM；提高单次调用权限后 Help 正常。
- CLI 将两个 realpath 失败降级为各自字面路径，别名与真实路径不同，入口 guard 为 false，主程序未运行便正常退出。这是确认的软件缺陷；为什么历史执行环境不同仍待核对，不能直接归因 Codex 升级。
- 安全备份已推送 backup/atom-global-entry-before-repair-20261005，远端精确 SHA 188d820b66b364a58b9cb34341db475655febcf5；同 SHA main 检查 37072430939 completed/success。
- Superpowers 6.4.2，来源 https://github.com/obra/superpowers，manifest SHA256 EF99FCE86F655E7B65F9505BDF468C9BCAF9BF49915C72E128ED62BAC40A6586，与现有核对基线一致；SP-L01—05、SP-U01 继续本地补充。

## Review Focus

1. junction/符号链接入口的 Help 正常输出。
2. realpath 被拒且文件仍可读时入口不能静默跳过。
3. 其他脚本 import CLI 不得执行 CLI。
4. 缺少 Agent 的业务调用仍明确拒绝；不得提供默认窗口。
5. 身份无法判断的真正入口失败必须可观察，不得误报成功。

### Task 1：诊断与入口修复

**Files:** Modify work-engine/atom-language/cli.mjs；Test tests 中既有 CLI 合同文件及必要的新入口回归文件。
**Interfaces:** 消费 process.argv[1] 和 import.meta.url；保持 runAtomCli 原接口与返回合同。

- [ ] 核对入口 guard 引入历史、历史成功调用权限与 Node 版本，记录已确认和证据不足的部分。
- [ ] 建立真实别名入口、realpath 拒绝、模块导入无副作用的失败测试并观察 RED。
- [ ] 实现最小身份判断修复，定向 GREEN；不增加产品默认窗口。
- [ ] 运行 CLI 受影响合同及隔离真实旅程，记录并提交。

### Task 2：全局入口 E3

**Files:** 同一代码候选；证据和状态回写本计划与唯一总账。

- [ ] 一次独立最终评审，修复重要问题；最终 npm test 一次。
- [ ] 推送候选并读取精确远端检查终态。
- [ ] 部署至全局入口实际指向的正式代码；默认受限调用 Help、显式窗口只读查询、缺少窗口拒绝全部通过。
- [ ] 推送 main、等待精确检查终态，持久化收口证据并完成目标。
