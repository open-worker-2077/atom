import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  auditProductionArchitecture
} from '../src/atom-system/operations/production-architecture-audit.mjs';

async function fixture(t, files) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-architecture-audit-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const [file, source] of Object.entries(files)) {
    const target = path.join(root, file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, source, 'utf8');
  }
  return root;
}

test('production audit rejects an unregistered entry importing the legacy engine', async (t) => {
  const root = await fixture(t, {
    'work-engine/atom-language/engine.mjs': 'export function executeAtomLanguage() {}\n',
    'work-engine/atom-language/new-entry.mjs': [
      '#!/usr/bin/env node',
      "import { executeAtomLanguage } from './engine.mjs';",
      'executeAtomLanguage();'
    ].join('\n')
  });

  const audit = await auditProductionArchitecture(root);

  assert.deepEqual(audit.violations.map(({ code, file }) => ({ code, file })), [
    { code: 'LEGACY_ENGINE_IMPORT_BYPASS', file: 'work-engine/atom-language/new-entry.mjs' },
    { code: 'UNREGISTERED_PRODUCTION_ENTRY', file: 'work-engine/atom-language/new-entry.mjs' }
  ]);
});

test('production audit rejects direct world-fact persistence outside an approved port', async (t) => {
  const root = await fixture(t, {
    'src/atom-system/world-kernel/bad-writer.mjs': [
      'export async function save(writeAtomContext, facts) {',
      "  await writeAtomContext('atom.json', facts);",
      '}'
    ].join('\n')
  });

  const audit = await auditProductionArchitecture(root);

  assert.deepEqual(audit.violations.map(({ code, file }) => ({ code, file })), [
    { code: 'WORLD_FACT_WRITE_BYPASS', file: 'src/atom-system/world-kernel/bad-writer.mjs' }
  ]);
});

test('current production topology has no unregistered violations or temporary debt', async () => {
  const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
  const audit = await auditProductionArchitecture(root);

  assert.deepEqual(audit.violations, []);
  assert.ok(audit.files > 20);
  assert.deepEqual(
    audit.debt.map(({ code, file }) => ({ code, file })),
    []
  );
});
