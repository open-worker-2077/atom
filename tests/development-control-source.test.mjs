import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
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
