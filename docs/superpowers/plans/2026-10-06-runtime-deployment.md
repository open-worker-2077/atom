# 正式服务恢复与部署连续性

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 已恢复的公共服务持续可用，静态部署不重启后端，健康实例不被重复启动。
**Architecture:** 沿既有watchdog优先判断公共health，任务状态只在不健康时触发生命周期；全局唯一入口核心约束按部署实际改动匹配服务操作。沿导航目标接续，不新建状态源。
**Tech Stack:** PowerShell、Node test。
**Spec:** 本计划已验证事故与用户“恢复、杜绝”裁定；导航主规格与总账沿用。

## Global Constraints

- I3/U3/D2/E3。当前公共4784已恢复进程46016，health正常、CLI读取exit0、Web导航及表格只读回读通过。禁止为本次静态更新再次重启健康服务。
- 实施前888f626安全备份推送核对；全局入口原文件另保存可恢复归档，不删除原资料。
- 本次只修既有监管，不扩展为新部署平台或重写启动器；约一分钟启动CPU64s为实测，具体内部热点未确认。

## 证据与主干

不必要重启+短等待与启动退出竞态造成正式空窗。后续直接同入口进程约一分钟完成初始化。
既有watchdog先看任务state，再看health；任务Ready但公共health=true仍调用Start，隔离行为RED（9pass/1fail）证实。
主干：静态文件更新只切换文件并回读；必须重启后端时先验证启动、明确就绪与回退，不能把Running当可用。watchdog遇到健康实例不启停、不创建重复实例。

## Review Focus

Ready+healthy无需Start；Ready+unhealthy仍启动并等待；Running+unhealthy保留grace/cooldown；mutex与失败持久化不受影响；全局skill仅追加部署边界不重写官方步骤。

### Task 1: 健康优先监管与入口约束

**Files:** scripts/watch-atom-runtime-health.ps1、tests/atom-runtime-health-watchdog.test.mjs；全局using-superpowers核心段及workspace归档。
**Interfaces:** health→existingtask.lifecycle，默认参数保持；唯一路径继续Superpowers。

- [x] 隔离Ready+healthy行为RED，真实服务已恢复。
- [x] 推888f626安全备份；归档全局入口后精确补一条部署约束。
- [x] 在非Running分支首先检查health，已健康时清旧故障状态并返回none；10项隔离行为GREEN。
- [x] fresh增量评审；候选精确检查通过后只切换正式文件，真实watchdog只读无生命周期动作回读。

### Task 2: 共用正式收口

**Files:** 本计划、导航及表格所属计划、唯一总账。
**Interfaces:** 共用当前goal的导航计划链接，最终main audit只推一次并等待精确终态。

- [ ] 持久化恢复与防复发结果，main精确检查终态通过，健康与CLI最终回读后关闭目标。

**测试纠偏**：RED的action=started有效；GREEN初轮action=none已正确，仅新增断言错误地把必要health读取也当作禁止的调用，改为只断言无start/stop生命周期动作，不降低实际服务检查。

**GREEN**：Windows隔离watchdog10/10，Ready+healthy不Start/Stop且清旧故障、Ready+unhealthy照常启动、grace/cooldown/mutex均通过。全局唯一入口已精确追加部署约束，原/新文件归档在D:/Project/〇/docs/file-management/2026-10-06-deployment-continuity，不新增开发入口。正式服务仍health正常，修改尚未切换正式监管脚本。

**fresh评审GREEN**：888f626..ad162413只读增量评审无Critical/Important/Minor，无搁置事项；10/10真实PowerShell行为证据已读。全局before/after验证只增加部署约束一行。产品导航/表格继续复用已验收证据，不因本次监管脚本修复重新运行浏览器。进入新候选精确远端门禁后仅快进正式文件，禁止服务重启。

**真实监管回读**：worktree新脚本对正式health返回ok=true/action=none/healthy=true，无生命周期动作；4784持续健康。最终候选fc05d2d2f185443c8d2e5a67be329a16b06c05b9的run37346563322进行中；通过后仅快进文件。

**候选完整GREEN**：fc05d2d2f185443c8d2e5a67be329a16b06c05b9精确run37346563322 completed/success。仅快进正式文件并回读监管，禁止再重启服务。

**正式监管E3产品GREEN**：正式main仅快进文件至fc05d2d，无重启；执行正式watchdog返回ok=true/action=none/healthy=true，4784 beforePid=afterPid=46016，health=true/revision8399。全局唯一入口新增部署约束已保存可恢复原文件。Windows10/10、fresh评审通过、精确候选Linux完整2405pass/0fail/22条件skip。当前产品验收已完成；最后main审计提交远端检查成功后关闭目标，不重复生成自指审计提交。
