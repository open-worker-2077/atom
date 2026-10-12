# 桌面启动与大事务日志恢复

> **For agentic workers:** Use superpowers:executing-plans to execute inline; one fresh whole-branch review before delivery.

**Goal:** 用户双击桌面 Atom 即完成检查、必要启动、等待就绪和打开网址；大事务历史不阻断启动。
**Architecture:** 复用 start-atom-graph.ps1、正式运行任务和健康监管。local commit 日志流式校验发布帧，保留轻量位置/身份索引，只按需读取恢复用正文；启动与安装入口记录可恢复日志，不复制世界或另建服务。
**Spec:** 用户2026-10-12截图与明确需求，本计划承接既有 runtime-deployment 计划的服务连续性合同。
**Tech Stack:** Node 24、PowerShell、Windows Scheduler、桌面 .lnk。

## Global Constraints

- I3/U3/D3/E3；先文件、原版推送备份、目标仅链接事实源，再改代码。此前用户已授权实现把控与持续执行，不重复研讨已明确主干。
- 保留全部事务历史，不删除/改写业务事实；正式服务就绪必须 HTTP health 和 Web 页面回读，Running 不等于就绪。健康实例不重启。
- Superpowers manifest 6.4.2 / obra/superpowers / EF99FCE86F655E7B65F9505BDF468C9BCAF9BF49915C72E128ED62BAC40A6586，与项目已核对基线相同，继续已有 SP-L01—05、SP-U01 结论。
- 实际桌面入口在用户 Desktop 创建，原有同名文件不覆盖；日志保存在本地 AtomGraph，不入公共仓库。未经显式授权不读私有 Graph 节点。

## 已验证 RED 与主干

正式4784无监听，直接运行同入口返回 ERR_FS_FILE_TOO_LARGE：2260143653 bytes > 2 GiB。
文件为 world-commits.jsonl；events.jsonl 为1923725013 bytes。运行任务多次退出码1；现有监管只能重试，无法解决全文件 readFile 的硬上限。临时暂停监管用于取证；恢复服务后必须重新启用。
仓库已有启动器与6项测试，桌面无 Atom 快捷方式。复用既有启动链，补日志和并发保护、安装器；修复实际日志读取容量，保留发布proof/abort、未完成尾部和故障恢复语义。流式读取保留轻量帧位置，恢复应用按需读取payload，避免以去掉2GiB检查换成无界内存。

## Review Focus

- 断尾、错误proof和匹配abort仍不能发布错误事实。
- 注入文件系统用于故障测试不能绕过。
- 历史索引不长期保留patch/facts正文；冷启动恢复与证据查询共享校验。
- 多次点击不创建重复运行；健康实例直接开浏览器。
- 失败可见且日志可回查；桌面安装不覆盖用户文件。

### Task 1: 修复大日志启动

- [ ] 增加禁止whole-file read的回归测试，运行RED。
- [ ] 改 json-world-repository.mjs 的localRecords和indeterminate恢复为流式扫描；按需hydrate待应用帧，保持发布协议。
- [ ] 定向world transaction/publication/recovery测试GREEN；真实正式启动就绪并恢复监管。

### Task 2: 桌面入口

- [ ] 对重复点击、就绪先于浏览器、失败日志、安装不覆盖写RED行为测试。
- [ ] 复用start-atom-graph.ps1，加有界互斥、启动日志；增加install-atom-desktop-shortcut.ps1，安装真实快捷方式。
- [ ] 实际从快捷方式打开浏览器、HTTP200、重复启动PID不变；保留安装/诊断回执。

### Task 3: 交付

- [ ] fresh整体评审、修复Critical/Important、最小链→必要门禁→候选全量一次。
- [ ] 推送精确候选并等远端终态；部署、公共回读、main收口和关闭目标。安全备份仅备份不代表验收。

## 当前断点

方案已持久化，待原版安全备份；产品实现尚未开始。原版本4ba0e91，唯一总账保留10-10只读诊断记录。
