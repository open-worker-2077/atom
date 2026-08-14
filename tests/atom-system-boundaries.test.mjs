import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  auditAtomSystemDependencies,
  auditDependencyRecords
} from '../src/atom-system/operations/dependency-audit.mjs';

test('the current Atom target architecture has no forbidden inward dependency', async () => {
  const root = path.resolve(fileURLToPath(new URL('../src/atom-system', import.meta.url)));
  const audit = await auditAtomSystemDependencies(root);

  assert.deepEqual(audit.violations, []);
  assert.ok(audit.files >= 15);
  assert.ok(audit.dependencies >= 10);
});

test('dependency audit rejects domain code importing an adapter', () => {
  const audit = auditDependencyRecords([
    {
      file: 'world-runtime/bad.mjs',
      imports: ['../adapters/json-world-repository.mjs']
    },
    {
      file: 'adapters/valid.mjs',
      imports: ['../world-runtime/world-revision.mjs']
    }
  ]);

  assert.deepEqual(audit.violations, [{
    file: 'world-runtime/bad.mjs',
    from: 'world-runtime',
    dependency: '../adapters/json-world-repository.mjs',
    to: 'adapters'
  }]);
});
