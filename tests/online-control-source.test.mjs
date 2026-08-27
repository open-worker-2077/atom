import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  classifyRetiredControlPath,
  findRetiredControlFiles
} from '../scripts/check-online-control-source.mjs';

test('whole retired control categories are rejected rather than fixed paths', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-online-control-'));
  const retired = [
    'openspec/changes/new-unlisted-change/proposal.md',
    'docs/plans/future-implementation.md',
    'docs/superpowers/plans/another-plan.md',
    'docs/roadmap/new-feature.md',
    'docs/new-runtime-plan.md',
    'docs/HANDOFF-new-runtime.md',
    'openspec/new-requirements-ledger.md',
    'docs/acceptance-status.md'
  ];
  for (const relativePath of retired) {
    const absolutePath = path.join(root, relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, 'stale local authority', 'utf8');
  }

  const found = await findRetiredControlFiles(root);
  assert.deepEqual(
    found.map(({ path: relativePath }) => relativePath),
    [...retired].sort((left, right) => left.localeCompare(right))
  );
  assert.deepEqual(new Set(found.map(({ category }) => category)), new Set([
    'openspec-change',
    'development-plan-or-roadmap',
    'handoff-watch-ledger-status'
  ]));
});

test('durable docs, code, tests, runtime config and OpenSpec config are not rejected', () => {
  const allowed = [
    'docs/ARCHITECTURE.md',
    'docs/architecture/system-target.md',
    'docs/architecture/product-plan.md',
    'docs/adr/0001-runtime.md',
    'docs/operations/deployment.md',
    'docs/releases/v0.3.0.md',
    'docs/product-design.md',
    'openspec/config.yaml',
    'tests/acceptance-status.test.mjs',
    'scripts/runtime-plan.mjs'
  ];
  for (const relativePath of allowed) assert.equal(classifyRetiredControlPath(relativePath), null, relativePath);
});

test('current repository contains no retired local control sources', async () => {
  const root = path.resolve(import.meta.dirname, '..');
  assert.deepEqual(await findRetiredControlFiles(root), []);
});
