# Markdown表格单元格换行

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 单元格主动换行生效，连续●分项各占一行，长文自然折行且短时间值完整。
**Architecture:** 共用Markdown渲染器只转换表格文本token中的无属性br及●分项；代码、链接和其他原始HTML保持既有语义。CSS保留正常断词规则。正文事实不变。
**Tech Stack:** MarkdownIt、DOMPurify、JavaScript、Playwright。
**Spec:** ../specs/2026-08-31-atom-web-spatial-design.md。

## Global Constraints

- I3/U3/D2/E3。用户2026-10-06授权尽量换行并研究解决，接续导航目标。
- 原版本40f98faba26213d71cfd5a819a2dbd9a20ac5b6a已推安全分支backup/atom-before-table-wrap-20261006；持久化后再次核对远端。仅备份、尚未整体验收。
- HTML仍禁用，仅无属性<br>、<br/>、<BR />作为表格换行；不打开任意HTML。
- 不改写排期事实；自动刷新不移动正在使用的相机；导航计划继续E3收口。

## 问题与证据

现有breaks:true只覆盖解析出的普通换行；html:false将单元格br显示成字符。●分项无主动断行。详情容器overflow-wrap:anywhere让窄时间列09:50拆成三行。
真实浏览器table-diagnosis.log：主动br、分项、时间完整三项RED，原HTML禁用安全一项PASS（38.8秒）。

## Review Focus

无属性br与代码/恶意带属性br分界；●跨强调或链接token不损坏结构；已有br不产生重复空行；长文折行、短值完整；所有共用预览消费同一渲染函数。

### Task 1: 共用表格换行

**Files:** src/spatial-markdown-editor.mjs、spatial.css、vendor/spatial-markdown-editor.bundle.js、index.html、tests/browser/table-line-breaks.spec.mjs。
**Interfaces:** sanitizeRenderedMarkdown→所有正文预览；仅表格inline.children转换，CSS正常最小列宽。

- [x] 浏览器先复现三项RED并确认安全原行为。
- [x] 在表格文本token中识别主动br和分项；保留代码、原HTML禁用与sanitize。
- [x] 调整单元格折行规则，构建实际bundle；四项浏览器GREEN。
- [ ] 导航与正文自动刷新关键旅程、Markdown合同及受影响链组合验证；阶段提交。

### Task 2: 评审与E3

**Files:** 本计划、既有总账与导航计划。
**Interfaces:** 消费Task1最终候选，沿导航计划一次候选完整门禁与正式部署。

- [ ] 一次fresh表格增量评审；Important/Critical按RED→GREEN修复。
- [ ] 和导航候选共用最终精确revision远端检查与正式4784回读，main审计推送成功。

**执行记录**：持久化后远端精确核对40f98fa。共用表格token转换与CSS已实现并构建；保留无源码变化的场景bundle构建输出后恢复原bundle，重算入口实际资源版本。首轮浏览器运行本机HTTP沙箱未形成测试结果，结束后按本机网络权限重跑，不计产品失败。

**GREEN**：Windows Chromium4/4（28.4秒），br三种写法实际四行、●实际三行、窄视口09:50一个文本行且长文多行、带属性br与img不执行/代码不转换。Markdown合同8/8。跨强调与链接/已有br分项组合加入最终旅程。
