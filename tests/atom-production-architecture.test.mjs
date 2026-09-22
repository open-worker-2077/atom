import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  auditProductionArchitecture
} from '../src/atom-system/operations/production-architecture-audit.mjs';

async function productionSources(root) {
  const files = [];
  async function visit(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (/\.(?:js|mjs|cjs)$/u.test(entry.name)) files.push(absolute);
    }
  }
  for (const directory of ['work-engine', 'src']) await visit(path.join(root, directory));
  return Promise.all(files.map(async absolute => ({
    file: path.relative(root, absolute).replaceAll('\\', '/'),
    source: await fs.readFile(absolute, 'utf8')
  })));
}

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

test('Web editing has one text command entry and no server-side UI translation', async () => {
  const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
  for (const file of [
    'cli/lib/server.mjs', 'work-engine/atom-language/graph-server.mjs',
    'src/atom-system/adapters/legacy-runtime-composition.mjs',
    'src/atom-system/public/interaction-runtime.mjs'
  ]) {
    const source = await fs.readFile(path.join(root, file), 'utf8');
    assert.doesNotMatch(source, /atomWorkspaceEdit|atomHumanStatus|createLegacyHuman(?:Workspace|Status)Translator|updateHuman(?:Workspace|Status)/, file);
    assert.doesNotMatch(source, /operation\??\.kind|humanGraphDocument|graphNodesByPath/, file);
  }
});

test('short Thing identity has one allocator and confines legacy parsing to cold migration', async () => {
  const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
  const sources = await productionSources(root);
  const matchingFiles = (pattern) => sources
    .filter(({ source }) => pattern.test(source))
    .map(({ file }) => file)
    .sort();

  assert.deepEqual(matchingFiles(/randomBytes\(16\)/u), []);
  assert.deepEqual(matchingFiles(/identityAlias/u), []);
  assert.deepEqual(matchingFiles(/\{22\}/u), [
    'work-engine/atom-language/key-parser.mjs',
    'work-engine/atom-language/short-thing-id-migration.mjs',
    'work-engine/atom-language/shortcut-runtime.mjs'
  ]);
  assert.deepEqual(matchingFiles(/legacy-22-migration/u), [
    'work-engine/atom-language/key-parser.mjs',
    'work-engine/atom-language/short-thing-id-migration.mjs'
  ]);
  assert.deepEqual(matchingFiles(/export function thingIdForOrdinal/u), [
    'work-engine/atom-language/thing-id-allocator.mjs'
  ]);
});
