import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  classifyDevelopmentControlViolation,
  findDevelopmentControlViolations
} from '../scripts/check-development-control-source.mjs';

test('approved controls, history, architecture, and product status files are allowed', () => {
  for (const allowed of [
    'docs/superpowers/specs/2026-08-31-system.md',
    'docs/superpowers/plans/2026-08-31-runtime.md',
    'docs/history/development-control/openspec/config.yaml',
    'docs/history/development-control/github/issue.md',
    'docs/architecture/system-target.md',
    'docs/adr/0001-runtime.md',
    'scripts/night-watch-status-graph.mjs',
    'tests/night-watch-status-graph.test.mjs'
  ]) assert.equal(classifyDevelopmentControlViolation(allowed), null, allowed);
});

test('retired, parallel, and shadow control artifacts are classified directly', () => {
  for (const [relativePath, category] of [
    ['.openspec/config.yaml', 'retired-openspec'],
    ['openspec/config.yaml', 'retired-openspec'],
    ['specs/runtime.md', 'parallel-spec'],
    ['docs/specs/runtime.md', 'parallel-spec'],
    ['requirements/runtime.md', 'parallel-spec'],
    ['docs/requirements/runtime.md', 'parallel-spec'],
    ['roadmap/runtime.md', 'parallel-plan'],
    ['docs/roadmap/runtime.md', 'parallel-plan'],
    ['plans/runtime.md', 'parallel-plan'],
    ['docs/plans/runtime.md', 'parallel-plan'],
    ['runtime-handoff.md', 'parallel-status'],
    ['docs/runtime-handoff.md', 'parallel-status'],
    ['.agents/skills/superpowers/using-superpowers/SKILL.md', 'superpowers-shadow'],
    ['.codex/skills/superpowers/test-driven-development/SKILL.md', 'superpowers-shadow'],
    ['skills/superpowers/verification-before-completion/SKILL.md', 'superpowers-shadow']
  ]) {
    assert.deepEqual(
      classifyDevelopmentControlViolation(relativePath),
      { path: relativePath, category },
      relativePath
    );
  }
});

test('the scanner finds exact violations in a non-empty repository fixture', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-development-control-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const fixturePaths = [
    '.agents/skills/superpowers/using-superpowers/SKILL.md',
    '.codex/skills/superpowers/test-driven-development/SKILL.md',
    '.openspec/config.yaml',
    'docs/adr/0001-runtime.md',
    'docs/architecture/system-target.md',
    'docs/history/development-control/openspec/config.yaml',
    'docs/plans/runtime.md',
    'docs/requirements/runtime.md',
    'docs/roadmap/runtime.md',
    'docs/runtime-handoff.md',
    'docs/specs/runtime.md',
    'docs/superpowers/plans/current.md',
    'docs/superpowers/specs/approved.md',
    'openspec/config.yaml',
    'plans/runtime.md',
    'requirements/runtime.md',
    'roadmap/runtime.md',
    'runtime-handoff.md',
    'scripts/night-watch-status-graph.mjs',
    'skills/superpowers/verification-before-completion/SKILL.md',
    'specs/runtime.md',
    'tests/night-watch-status-graph.test.mjs'
  ];
  for (const relativePath of fixturePaths) {
    const absolutePath = path.join(root, ...relativePath.split('/'));
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, 'fixture\n');
  }

  const found = await findDevelopmentControlViolations(root);
  assert.deepEqual(found, [
    { path: '.agents/skills/superpowers/using-superpowers/SKILL.md', category: 'superpowers-shadow' },
    { path: '.codex/skills/superpowers/test-driven-development/SKILL.md', category: 'superpowers-shadow' },
    { path: '.openspec/config.yaml', category: 'retired-openspec' },
    { path: 'docs/plans/runtime.md', category: 'parallel-plan' },
    { path: 'docs/requirements/runtime.md', category: 'parallel-spec' },
    { path: 'docs/roadmap/runtime.md', category: 'parallel-plan' },
    { path: 'docs/runtime-handoff.md', category: 'parallel-status' },
    { path: 'docs/specs/runtime.md', category: 'parallel-spec' },
    { path: 'openspec/config.yaml', category: 'retired-openspec' },
    { path: 'plans/runtime.md', category: 'parallel-plan' },
    { path: 'requirements/runtime.md', category: 'parallel-spec' },
    { path: 'roadmap/runtime.md', category: 'parallel-plan' },
    { path: 'runtime-handoff.md', category: 'parallel-status' },
    { path: 'skills/superpowers/verification-before-completion/SKILL.md', category: 'superpowers-shadow' },
    { path: 'specs/runtime.md', category: 'parallel-spec' }
  ]);
  for (const violation of found) {
    assert.equal(Object.isFrozen(violation), true, violation.path);
  }
});

test('the repository has no retired active-control paths after archival', async () => {
  const root = path.resolve(import.meta.dirname, '..');
  assert.deepEqual(await findDevelopmentControlViolations(root), []);
});
