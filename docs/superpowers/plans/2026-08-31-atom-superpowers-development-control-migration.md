# Atom Superpowers Development Control Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Make the official Superpowers artifacts in this repository the active Atom development-control path while preserving GitHub and OpenSpec material as read-only, recoverable history.

**Architecture:** The repository will recognize only docs/superpowers/specs and docs/superpowers/plans as active local design and implementation artifacts. Existing OpenSpec and GitHub control material will be moved without deletion into docs/history/development-control, while project instructions, CI, contribution docs, and GitHub templates will point to the official globally installed Superpowers workflow rather than defining a replacement framework.

**Tech Stack:** Node.js 24, node:test, PowerShell, Markdown, GitHub Actions, official Superpowers 6.3.0 skills.

**Spec:** docs/superpowers/specs/2026-08-31-atom-acceptance-operations-design.md and docs/superpowers/specs/2026-08-31-atom-system-spine-design.md

## Global Constraints

- The installed Superpowers 6.3.0 Skill files, references, templates, rules, and definitions are read-only and must not be copied, wrapped, overridden, or edited.
- This plan changes only the Atom repository; no other repository or software enters scope.
- GitHub Issues, GitHub Project fields, and OpenSpec files remain historical evidence, not current requirement, status, or completion authority.
- Every source file is preserved through a collision-checked move; no source file is deleted or overwritten.
- Active specs live only under docs/superpowers/specs and active implementation plans live only under docs/superpowers/plans.
- Node.js remains at least version 24.
- Real atom.json data, business facts, credentials, private backup paths, and local absolute paths must not be committed.
- Execution starts in a Superpowers-created isolated worktree and uses explicit file staging; no GitHub push or pull request is authorized by this plan.

## File Map

- scripts/check-development-control-source.mjs: classifies active-control violations and scans the repository.
- tests/development-control-source.test.mjs: proves official Superpowers paths are allowed and retired discovery paths are rejected.
- docs/history/development-control/: immutable source-preserving home for retired GitHub and OpenSpec material.
- docs/file-management/2026-08-31-development-control-migration.md: exact old-to-new path ledger.
- AGENTS.md: project routing into the installed official Superpowers skills plus the existing GitNexus safety block.
- README.md and CONTRIBUTING.md: human-facing entry and contribution workflow.
- .github/ISSUE_TEMPLATE/development.yml and .github/pull_request_template.md: optional intake and code-review surfaces, not state authorities.
- package.json and .github/workflows/test.yml: run the new repository-control gate.

---

### Task 1: Switch the Repository Control Boundary Without Losing History

**Files:**
- Create: scripts/check-development-control-source.mjs
- Create: tests/development-control-source.test.mjs
- Create: docs/history/development-control/README.md
- Create: docs/file-management/2026-08-31-development-control-migration.md
- Move: openspec/ to docs/history/development-control/openspec/
- Move: docs/github/ to docs/history/development-control/github/
- Move: scripts/check-online-control-source.mjs to docs/history/development-control/implementation/check-online-control-source.mjs
- Move: tests/online-control-source.test.mjs to docs/history/development-control/implementation/online-control-source.test.mjs
- Modify: package.json
- Modify: .github/workflows/test.yml
- Modify: tests/repository-governance.test.js

**Interfaces:**
- Consumes: repository-relative POSIX paths.
- Produces: classifyDevelopmentControlViolation(relativePath) returning null or an immutable object with path and category; findDevelopmentControlViolations(root) returning a sorted array.

- [ ] **Step 1: Verify every move target is inside the Atom repository and absent**

Run:

    $repoRoot = (Resolve-Path -LiteralPath ".").Path
    $historyRoot = [System.IO.Path]::GetFullPath((Join-Path $repoRoot "docs/history/development-control"))
    if (-not $historyRoot.StartsWith($repoRoot + [System.IO.Path]::DirectorySeparatorChar)) { throw "History target escaped the Atom repository" }
    foreach ($target in @(
      "docs/history/development-control/openspec",
      "docs/history/development-control/github",
      "docs/history/development-control/implementation/check-online-control-source.mjs",
      "docs/history/development-control/implementation/online-control-source.test.mjs"
    )) {
      if (Test-Path -LiteralPath $target) { throw "Move target already exists: $target" }
    }
    git status --short --untracked-files=all

Expected: every destination is absent; the output shows the existing OpenSpec tree, docs/github source, and generated AGENTS.md without modifying them.

- [ ] **Step 2: Write the failing control-boundary tests**

Create tests/development-control-source.test.mjs with these cases:

    import test from 'node:test';
    import assert from 'node:assert/strict';
    import fs from 'node:fs/promises';
    import os from 'node:os';
    import path from 'node:path';

    import {
      classifyDevelopmentControlViolation,
      findDevelopmentControlViolations
    } from '../scripts/check-development-control-source.mjs';

    test('official Superpowers specs and plans are the only active local control artifacts', () => {
      for (const allowed of [
        'docs/superpowers/specs/2026-08-31-system.md',
        'docs/superpowers/plans/2026-08-31-runtime.md',
        'docs/history/development-control/openspec/config.yaml',
        'docs/history/development-control/github/issue.md',
        'docs/architecture/system-target.md',
        'docs/adr/0001-runtime.md'
      ]) assert.equal(classifyDevelopmentControlViolation(allowed), null, allowed);
    });

    test('OpenSpec discovery and parallel local status systems are rejected', () => {
      assert.equal(classifyDevelopmentControlViolation('openspec/config.yaml')?.category, 'retired-openspec');
      assert.equal(classifyDevelopmentControlViolation('plans/runtime.md')?.category, 'parallel-plan');
      assert.equal(classifyDevelopmentControlViolation('docs/plans/runtime.md')?.category, 'parallel-plan');
      assert.equal(classifyDevelopmentControlViolation('docs/roadmap/runtime.md')?.category, 'parallel-plan');
      assert.equal(classifyDevelopmentControlViolation('docs/runtime-handoff.md')?.category, 'parallel-status');
    });

    test('the repository has no retired active-control paths after archival', async () => {
      const root = path.resolve(import.meta.dirname, '..');
      assert.deepEqual(await findDevelopmentControlViolations(root), []);
    });

- [ ] **Step 3: Run the new test and observe the missing implementation**

Run:

    node --test tests/development-control-source.test.mjs

Expected: FAIL with ERR_MODULE_NOT_FOUND for scripts/check-development-control-source.mjs.

- [ ] **Step 4: Implement the new classifier and scanner**

Create scripts/check-development-control-source.mjs:

    import fs from 'node:fs/promises';
    import path from 'node:path';
    import { fileURLToPath } from 'node:url';

    const SCAN_ROOTS = Object.freeze(['openspec', 'plans', 'docs']);
    const ACTIVE_SUPERPOWERS_PREFIXES = Object.freeze([
      'docs/superpowers/specs/',
      'docs/superpowers/plans/'
    ]);
    const HISTORY_PREFIX = 'docs/history/';
    const PARALLEL_PLAN_PREFIXES = Object.freeze([
      'plans/',
      'docs/plans/',
      'docs/roadmap/'
    ]);
    const PARALLEL_STATUS = /(?:^|[-_])(handoff|night[-_]?watch|requirements?[-_]?ledger|development[-_]?status|delivery[-_]?status|blocker[-_]?status|acceptance[-_]?status)(?:[-_.]|$)/i;

    function normalizedPath(value) {
      return value.replaceAll('\\', '/').replace(/^\.\//u, '');
    }

    export function classifyDevelopmentControlViolation(relativePath) {
      const candidate = normalizedPath(relativePath);
      if (candidate.startsWith(HISTORY_PREFIX)) return null;
      if (ACTIVE_SUPERPOWERS_PREFIXES.some((prefix) => candidate.startsWith(prefix))) return null;
      if (candidate === 'openspec' || candidate.startsWith('openspec/')) {
        return Object.freeze({ path: candidate, category: 'retired-openspec' });
      }
      if (PARALLEL_PLAN_PREFIXES.some((prefix) => candidate.startsWith(prefix))) {
        return Object.freeze({ path: candidate, category: 'parallel-plan' });
      }
      if (candidate.startsWith('docs/') && PARALLEL_STATUS.test(path.posix.basename(candidate))) {
        return Object.freeze({ path: candidate, category: 'parallel-status' });
      }
      return null;
    }

    async function walk(root, relativeDirectory) {
      const absolute = path.join(root, ...relativeDirectory.split('/'));
      let entries;
      try {
        entries = await fs.readdir(absolute, { withFileTypes: true });
      } catch (error) {
        if (error?.code === 'ENOENT') return [];
        throw error;
      }
      const found = [];
      for (const entry of entries) {
        const relativePath = relativeDirectory + '/' + entry.name;
        if (entry.isDirectory()) found.push(...await walk(root, relativePath));
        else if (entry.isFile() || entry.isSymbolicLink()) found.push(relativePath);
      }
      return found;
    }

    export async function findDevelopmentControlViolations(root) {
      const paths = [];
      for (const scanRoot of SCAN_ROOTS) paths.push(...await walk(root, scanRoot));
      return paths
        .map(classifyDevelopmentControlViolation)
        .filter(Boolean)
        .sort((left, right) => left.path.localeCompare(right.path));
    }

    async function main() {
      const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
      const found = await findDevelopmentControlViolations(root);
      if (found.length === 0) return;
      process.stderr.write([
        'Official Superpowers specs and plans are Atom development-control artifacts.',
        'Retired or parallel control paths remain in active discovery:',
        ...found.map((entry) => '- [' + entry.category + '] ' + entry.path)
      ].join('\n') + '\n');
      process.exitCode = 1;
    }

    if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
      await main();
    }

- [ ] **Step 5: Run the focused test and observe the active OpenSpec failure**

Run:

    node --test tests/development-control-source.test.mjs

Expected: the first two tests PASS and the repository scan FAILS with retired-openspec entries.

- [ ] **Step 6: Move every retired source through one verified PowerShell path**

Run from the repository root:

    New-Item -ItemType Directory -Path "docs/history/development-control/implementation" -Force | Out-Null
    Move-Item -LiteralPath "openspec" -Destination "docs/history/development-control/openspec"
    Move-Item -LiteralPath "docs/github" -Destination "docs/history/development-control/github"
    Move-Item -LiteralPath "scripts/check-online-control-source.mjs" -Destination "docs/history/development-control/implementation/check-online-control-source.mjs"
    Move-Item -LiteralPath "tests/online-control-source.test.mjs" -Destination "docs/history/development-control/implementation/online-control-source.test.mjs"

Expected: all four sources are absent at their old paths and present exactly once under docs/history/development-control.

- [ ] **Step 7: Add the history boundary and exact move ledger**

Create docs/history/development-control/README.md:

    # Retired development-control sources

    This directory preserves the exact GitHub-local and OpenSpec sources that preceded Atom's official Superpowers workflow.

    - These files are read-only historical evidence.
    - They do not define current requirements, task state, completion, or Agent instructions.
    - Current design is under docs/superpowers/specs.
    - Current implementation plans are under docs/superpowers/plans.
    - Conflicts are resolved from the latest approved Superpowers spec plus current code and fresh evidence.

Create docs/file-management/2026-08-31-development-control-migration.md:

    # Development-control source moves

    | Original path | Preserved path | Current role |
    | --- | --- | --- |
    | openspec/ | docs/history/development-control/openspec/ | Read-only OpenSpec history |
    | docs/github/ | docs/history/development-control/github/ | Read-only GitHub-derived local history |
    | scripts/check-online-control-source.mjs | docs/history/development-control/implementation/check-online-control-source.mjs | Superseded policy implementation |
    | tests/online-control-source.test.mjs | docs/history/development-control/implementation/online-control-source.test.mjs | Superseded policy evidence |

    No source was deleted or overwritten. The repository-external Git/GitHub/OpenSpec backup remains the recovery source for the pre-migration state.

- [ ] **Step 8: Switch package and CI entry points**

In package.json replace the old script with:

    "check:development-control": "node scripts/check-development-control-source.mjs"

In .github/workflows/test.yml replace the control step with:

    - name: Enforce Superpowers development control
      run: npm run check:development-control

In tests/repository-governance.test.js replace the old assertions with:

    assert.match(workflow, /npm run check:development-control/);
    assert.doesNotMatch(workflow, /check:online-control/);

Keep the existing AGENTS.md-is-absent assertion until Task 2 creates and tests that file in the same commit.

- [ ] **Step 9: Run focused governance tests**

Run:

    node --test tests/development-control-source.test.mjs tests/repository-governance.test.js
    npm.cmd run check:development-control

Expected: PASS; no active openspec, parallel-plan, or parallel-status path is reported.

- [ ] **Step 10: Commit the boundary switch with explicit staging**

Run:

    git add scripts/check-development-control-source.mjs tests/development-control-source.test.mjs docs/history/development-control docs/file-management/2026-08-31-development-control-migration.md package.json .github/workflows/test.yml tests/repository-governance.test.js
    git add -u scripts/check-online-control-source.mjs tests/online-control-source.test.mjs openspec docs/github
    git commit -m "docs: activate Superpowers development control"

Expected: one commit preserves the retired sources and leaves the new gate green.

---

### Task 2: Route Every New Session Through Official Superpowers

**Files:**
- Create: AGENTS.md
- Modify: tests/repository-governance.test.js
- Modify: README.md
- Modify: CONTRIBUTING.md

**Interfaces:**
- Consumes: the globally installed official Superpowers 6.3.0 skills and repository-local specs/plans.
- Produces: a project instruction that selects official skills without reproducing or changing their definitions.

- [ ] **Step 1: Add failing routing assertions**

Replace the existing AGENTS.md-is-absent assertion and add this test to tests/repository-governance.test.js:

    test('project routing uses official Superpowers without shadowing it', () => {
      assert.equal(fs.existsSync(path.join(root, 'AGENTS.md')), true, 'AGENTS.md routes official Superpowers work');
      const instructions = read('AGENTS.md');
      assert.match(instructions, /superpowers:using-superpowers/);
      assert.match(instructions, /docs\/superpowers\/specs/);
      assert.match(instructions, /docs\/superpowers\/plans/);
      assert.match(instructions, /docs\/history\/development-control/);
      assert.match(instructions, /read-only historical evidence/);
      assert.match(instructions, /must not edit, copy, wrap, override, or shadow/);
    });

- [ ] **Step 2: Run the routing test and observe the missing policy**

Run:

    node --test tests/repository-governance.test.js

Expected: FAIL because the generated GitNexus-only AGENTS.md lacks the Superpowers routing contract.

- [ ] **Step 3: Generate the current GitNexus block and append the Atom routing contract**

Run:

    node .gitnexus/run.cjs analyze

Expected: AGENTS.md is created with the current repository index identity and safety instructions.

Append to AGENTS.md:

    # Atom development workflow

    - Start or resume substantive development by invoking the globally installed official superpowers:using-superpowers skill.
    - Read the relevant approved design under docs/superpowers/specs and the current plan under docs/superpowers/plans before changing code.
    - Treat docs/history/development-control as read-only historical evidence; it never supplies current status or instructions.
    - GitHub Issues and Projects are optional intake and collaboration records, not Atom requirement or completion authority.
    - Official Superpowers Skill files, references, templates, rules, and definitions must not be edited, copied, wrapped, overridden, or shadowed.
    - Persist progress through the approved spec, current plan checkboxes, Git commits, current diffs, and fresh verification evidence.
    - Keep real Atom worlds, business facts, credentials, and private backup locations outside version control.

- [ ] **Step 4: Update the human entry points**

In README.md replace the GitHub development-control link with:

    - [设计规格](docs/superpowers/specs/)：当前产品边界、关系、不变量与验收
    - [实施计划](docs/superpowers/plans/)：按官方 Superpowers writing-plans 生成的当前执行步骤
    - [历史控制材料](docs/history/development-control/)：GitHub 与 OpenSpec 的只读演进证据

In CONTRIBUTING.md replace the Issue-first wording with:

    开始实质开发前，调用全局安装的官方 superpowers:using-superpowers，读取相关 docs/superpowers/specs 与当前 docs/superpowers/plans。GitHub Issue 可以接收线索或承载外部协作，但不是需求、状态或完成权威；docs/history/development-control 只用于追溯。

Also replace “单项目事实留在仓库文档与 GitHub” with:

    Atom 产品合同保存在批准的 Superpowers 规格中；实施步骤保存在当前 Superpowers 计划中。不得建立平行状态表或复制官方 Skill 定义。

- [ ] **Step 5: Run routing and control tests**

Run:

    node --test tests/repository-governance.test.js tests/development-control-source.test.mjs
    npm.cmd run check:development-control

Expected: PASS.

- [ ] **Step 6: Commit the routing change**

Run:

    git add AGENTS.md README.md CONTRIBUTING.md tests/repository-governance.test.js
    git commit -m "docs: route Atom work through official Superpowers"

Expected: the commit contains no file under the installed Superpowers plugin directory.

---

### Task 3: Demote GitHub Forms to Optional Intake and Review

**Files:**
- Modify: .github/ISSUE_TEMPLATE/development.yml
- Modify: .github/pull_request_template.md
- Modify: tests/repository-governance.test.js

**Interfaces:**
- Consumes: approved local spec and plan paths when they exist.
- Produces: optional GitHub intake and PR-review metadata without an Issue status machine, OpenSpec selector, mandatory Session, or completion authority.

- [ ] **Step 1: Write failing template-boundary assertions**

Add to the GitHub template test in tests/repository-governance.test.js:

    const developmentTemplate = read('.github/ISSUE_TEMPLATE/development.yml');
    const pullRequestTemplate = read('.github/pull_request_template.md');
    assert.match(developmentTemplate, /可选线索入口/);
    assert.match(developmentTemplate, /不构成需求、状态或完成权威/);
    assert.doesNotMatch(developmentTemplate, /label: OpenSpec/);
    assert.doesNotMatch(developmentTemplate, /专职 Session/);
    assert.match(pullRequestTemplate, /Superpowers 规格\/计划/);
    assert.match(pullRequestTemplate, /可选关联 Issue/);
    assert.doesNotMatch(pullRequestTemplate, /关联 Issue 保持打开/);

- [ ] **Step 2: Run the test and observe the old authority wording**

Run:

    node --test tests/repository-governance.test.js

Expected: FAIL on the current Issue authority, OpenSpec dropdown, Session field, and PR status wording.

- [ ] **Step 3: Rewrite the development form as optional intake**

Keep the goal, current evidence, scope, and acceptance textareas, but set the opening markdown to:

    GitHub Issue 是可选线索入口，用于外部反馈或协作讨论；它不构成 Atom 的需求、状态或完成权威。需要实施时，以仓库内批准的 Superpowers 规格、当前计划、代码与新证据为准。

Remove the session and openspec fields. Add one optional input:

    - type: input
      id: superpowers_artifact
      attributes:
        label: Superpowers 规格或计划
        description: 已进入实施时填写仓库相对路径；仅提交线索时可以留空。

- [ ] **Step 4: Rewrite the PR metadata boundary**

Replace the GitHub record section in .github/pull_request_template.md with:

    ## 开发依据

    - Superpowers 规格/计划：
    - 可选关联 Issue：
    - 是否需要更新 CHANGELOG.md、ADR 或 Release notes：

    PR 只承载代码评审与协作记录。需求边界来自批准的规格，执行进度来自当前计划和 Git，完成结论来自当前 revision 的验证证据。

Keep the existing architecture, verification, real-rendering, and no-real-data checks.

- [ ] **Step 5: Run template and repository gates**

Run:

    node --test tests/repository-governance.test.js tests/development-control-source.test.mjs
    npm.cmd run check:development-control

Expected: PASS.

- [ ] **Step 6: Commit the GitHub demotion**

Run:

    git add .github/ISSUE_TEMPLATE/development.yml .github/pull_request_template.md tests/repository-governance.test.js
    git commit -m "docs: demote GitHub control forms to optional intake"

Expected: GitHub remains available for reports and review but no longer defines Atom work state.

---

### Task 4: Verify the Migration as a Repository Contract

**Files:**
- Verify: all files changed by Tasks 1–3

**Interfaces:**
- Consumes: the complete migrated repository.
- Produces: current test, policy, history-preservation, and diff evidence.

- [ ] **Step 1: Verify history completeness and active-path absence**

Run:

    if (Test-Path -LiteralPath "openspec") { throw "OpenSpec remains active" }
    if (Test-Path -LiteralPath "docs/github") { throw "GitHub local control remains active" }
    if (-not (Test-Path -LiteralPath "docs/history/development-control/openspec/config.yaml")) { throw "OpenSpec history is incomplete" }
    if (-not (Test-Path -LiteralPath "docs/history/development-control/github/issue-shortcut-web-navigation.md")) { throw "GitHub history is incomplete" }
    git status --short --untracked-files=all

Expected: retired roots are absent, historical sources exist, and no unrelated user file is staged.

- [ ] **Step 2: Verify official Superpowers remained untouched**

Run:

    git diff --name-only HEAD~3..HEAD

Expected: every path is inside the Atom repository and no path points into a global plugin, Skill cache, .agents, or .codex installation.

- [ ] **Step 3: Run governance and public-data gates**

Run:

    npm.cmd run check:development-control
    node --test tests/development-control-source.test.mjs tests/repository-governance.test.js tests/public-repository-data-boundary.test.mjs

Expected: PASS.

- [ ] **Step 4: Run the complete repository suite**

Run:

    npm.cmd test

Expected: PASS with zero failing tests.

- [ ] **Step 5: Inspect the final change surface**

Run:

    git diff --check
    git status --short

Then call GitNexus:

    detect_changes({ scope: "compare", base_ref: "main" })

Expected: no whitespace error, no unstaged migration source, and only governance/documentation flows are reported. If execution started from main and the comparison has no commit base delta, use detect_changes({ scope: "unstaged" }) before the final commit instead.
