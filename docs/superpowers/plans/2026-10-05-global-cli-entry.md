# 全局 Atom CLI 静默退出修复计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 恢复全局 atom.cmd 在当前受限调用中的正常 Help 和读取，并解释故障触发条件。

**2026-10-05 用户纠偏（绑定验收）**：重点不是将空输出改为报错。文件仍可访问时，正常软件应恢复入口识别并继续执行；使用者使用同一个全局命令，不改路径、不提权、不因可恢复的 realpath 失败停工。明确错误只适用于真正无法执行的失败，不能作为本问题的解决结果。
**Architecture:** 修复 CLI 对执行入口与导入模块的身份判断，保留导入无副作用合同。以真实全局调用与隔离回归共同验收。
**Tech Stack:** Windows、PowerShell、Node.js ESM、node:test。
**Spec:** 本计划的验收边界；唯一排队状态见 2026-09-03-atom-current-requirement-ledger.md。

## Global Constraints

- I3/U3/D2/E3；先安全备份、持久化、开启目标，再修复。
- 不改正式世界业务数据，不替 🌍 执行待办迁移；窗口由 session 提供，无全局默认 Agent。
- 不改变操作系统权限或要求使用者修改软件；真实全局入口须在默认受限调用中可用。
- 最小受影响链、真实入口、必要门禁、最终候选全量一次；推送后等待精确 revision 检查终态。

## 已取得证据

- 用户截图所示 🌍 03:31 再次成功的 Help，原始工具参数明确为 require_escalated；同一时点默认调用仍空输出 exit0，不是自恢复，也不代表修复已部署。
- 默认环境新增最小对照：fs.realpathSync（JS逐段解析）正常得到 junction 的真实路径，而 fs.realpathSync.native 返回 EPERM；说明“所有 realpath 均受限”的旧归纳错误，应按具体解析实现定界。

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

**RED**：真实子进程将 argv 指向同一文件的 junction，并仅令 realpath 返回 EPERM；Help 输出为空导致 --agent 断言失败，模块导入仍无输出。Windows 测试预加载 URL 与参数分界错误先修正，不计作产品 RED。现有 CLI 合同基线19/19通过。默认环境 stat 返回两路径相同 dev=2364630212、ino=562949954502045，可据文件身份识别同一入口。入口 guard 已存在于2026-08-14源码基线；没有证据证明本周新增，不能把当前失败推断为近期 Atom 改坏。

**Files:** Modify work-engine/atom-language/cli.mjs；Test tests 中既有 CLI 合同文件及必要的新入口回归文件。
**Interfaces:** 消费 process.argv[1] 和 import.meta.url；保持 runAtomCli 原接口与返回合同。

- [x] 核对入口 guard 引入历史、历史成功调用权限与 Node 版本，记录已确认和证据不足的部分。
- [x] 建立真实别名入口、realpath 拒绝、模块导入无副作用的失败测试并观察 RED。
- [x] 实现最小身份判断修复，定向 GREEN；不增加产品默认窗口。
- [x] 运行 CLI 受影响合同及隔离真实旅程，记录并提交。

### Task 2：全局入口 E3

**评审与修复**：一次独立评审指出当前 Node 的 native main 可能掩盖文件身份回退，以及旧受支持版本的恢复缺口。补充真实委托启动（import.meta.main=false）、realpath 与 stat 均拒绝的测试；旧90cde05 Help为空为RED，新实现使用非native realpathSync逐段解析恢复为GREEN。该路径在真实默认环境已验证成功；不提高 Node 最低版本。原候选全量在新证据形成后终止，不作为通过证据。Minor：导入测试尚未使用真实 importer 文件，按技能延后；现有真实模块导入惰性测试通过。

**Ruling:** 所有身份解析方法均不可用且无 native main 时，无法安全区分导入与执行；本次解决可读入口的已复现失败，不凭文件名猜测执行。误判的成本是导入触发业务操作，故保持不猜测，并将该极端环境视为证据不足的边界。

**Ruling:** 默认执行环境的HTTP connect EACCES与入口缺陷独立；不绕过沙箱网络边界、不改变OS权限。E3验证默认Help及窗口拒绝，真实只读HTTP在执行工具允许网络的调用中验收。成本：使用方Agent需要沿执行工具的既有网络授权途径调用，而不能声称Atom能授予自己OS权限。实际候选Help165行、缺窗exit4 AGENT_REQUIRED、获准只读根查询exit0均已取得。

**正式部署回读**：6f5e635精确候选run37228862822完整npm test成功（2424项，2403通过、0失败、21平台跳过）。正式main快进至同SHA并推送，PR#76自动MERGED。正式全局atom.cmd在默认环境Help为165行exit0、缺窗AGENT_REQUIRED exit4，获准本机网络的只读根查询exit0。服务未重启、业务世界未写。main精确run37229459216与Windows本地完整测试仍待终态，目标未关闭；脱敏证据见../evidence/2026-10-05-global-cli-entry.txt。

**Files:** 同一代码候选；证据和状态回写本计划与唯一总账。

- [x] 一次独立最终评审，修复重要问题；最终 npm test 一次。
- [x] 推送候选并读取精确远端检查终态。
- [x] 部署至全局入口实际指向的正式代码；默认受限调用 Help、显式窗口只读查询、缺少窗口拒绝全部通过。
- [x] 推送 main、等待精确产品检查终态，持久化收口证据；审计提交精确检查成功后关闭目标。

## 完成证据

Windows完整npm test：2424项、2423通过、0失败、1平台跳过，846137ms，exit0。
产品main@6f5e63526276fe9ba2794ba4b564e720fd5fcba3精确run37229459216 completed/success。
默认全局Help165行exit0、缺窗exit4 AGENT_REQUIRED、获准本机网络的同一全局入口只读根查询exit0。
此前阶段所述“尚未部署／待main终态”已被以上证据替代；当前仅推送审计记录并等待该精确revision检查，不重复本地同产品全量。
工作树及忽略目录中的测试、构建和历史证据保留，遵守零删除要求。
