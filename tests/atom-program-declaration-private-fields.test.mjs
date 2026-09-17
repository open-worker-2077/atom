import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createLegacyWorldService } from '../src/atom-system/adapters/legacy-engine-adapter.mjs';
import { sealWorldFactsRevision } from '../src/atom-system/world-runtime/world-revision.mjs';
import { executeAtomLanguage } from '../work-engine/atom-language/engine.mjs';
import {
  fieldsByBase,
  oneStoredField,
  readOnlyProgramDeclarationFields,
  walkAtoms
} from '../work-engine/atom-language/query-capability.mjs';

const atom = (thing, situation = '') => ({ thing, situation, slot: [], strut: [] });

test('ordinary Program declaration comparison does not detach archived field metadata', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-program-declaration-fields-'));
  t.diagnostic(`retained fixture: ${directory}`);
  const target = { contextFile: path.join(directory, 'atom.json'),
    projectionFile: path.join(directory, 'graph.json') };
  const archived = Array.from({ length: 96 }, (_, index) => atom(`Cold-${index}`));
  archived.push({ 'thing@program': 'Dormant', situation: 'def main(arguments):\n    return None',
    slot: [], strut: [] });
  await fs.writeFile(target.contextFile, `${JSON.stringify([
    atom('Root', 'before'),
    { 'thing@backup@default': 'Backup', situation: '', slot: archived, strut: [] }
  ])}\n`, 'utf8');
  const service = createLegacyWorldService({ memoryAuthoritative: true,
    publishLegacyProjection: false,
    saveSchedule: { quietMs: 60_000, maxDirtyMs: 60_000 },
    execute: (request) => executeAtomLanguage(request) });
  const originalClone = globalThis.structuredClone;
  let declarationDetachOps = 0;
  let declarationDetachBytes = 0;
  t.mock.method(globalThis, 'structuredClone', (value, ...options) => {
    if (value && typeof value === 'object' && typeof value.rawKey === 'string'
      && Array.isArray(value.types) && Array.isArray(value.actions)
      && new Error().stack?.includes('programDeclarationSurface')) {
      declarationDetachOps += 1;
      declarationDetachBytes += JSON.stringify(value).length;
    }
    return originalClone(value, ...options);
  });
  try {
    const before = await service.readCommittedVersion(target);
    const written = await service.executeLegacy({ ...target,
      source: 'transform {"thing":"Root","situation.rep.after"}',
      interaction: { id: 'program-declaration-private-fields' } });
    assert.equal(written.ok, true, JSON.stringify(written.errors));
    const after = await service.readCommittedVersion(target);
    assert.equal(before.facts[0].situation, 'before');
    assert.equal(after.facts[0].situation, 'after');
    assert.strictEqual(after.facts[1], before.facts[1]);
    t.diagnostic(`Program declaration detached metadata: ${declarationDetachOps} operations, ${declarationDetachBytes} JSON bytes`);
    assert.equal(declarationDetachOps, 0);
    assert.equal(declarationDetachBytes, 0);
  } finally {
    await service.closeSaves();
  }
});

test('internal declaration fields are read-only and isolated from public metadata mutations', () => {
  const beforeAtom = { 'thing@program': 'Worker', situation: 'before', slot: [], strut: [] };
  const before = [beforeAtom];
  sealWorldFactsRevision(before);
  const declaration = readOnlyProgramDeclarationFields(beforeAtom);
  assert.deepEqual(declaration, { thingKey: 'thing@program', situationKey: 'situation',
    situation: 'before' });
  assert.equal(Object.isFrozen(declaration), true);
  assert.throws(() => { declaration.situation = 'forged'; }, TypeError);
  const publicFields = fieldsByBase(beforeAtom);
  publicFields.get('thing')[0].parsed.types[0].raw = 'forged';
  publicFields.set('situation', []);
  oneStoredField(beforeAtom, 'thing').parsed.types.push({ raw: 'forged' });
  assert.equal(readOnlyProgramDeclarationFields(beforeAtom).situation, 'before');
  const afterAtom = { ...beforeAtom, situation: 'after' };
  assert.equal(readOnlyProgramDeclarationFields(afterAtom).situation, 'after');
  sealWorldFactsRevision([afterAtom]);
  assert.equal(readOnlyProgramDeclarationFields(afterAtom).situation, 'after');
  assert.equal(readOnlyProgramDeclarationFields(beforeAtom).situation, 'before');
});

test('a shallow-frozen getter stays fresh and mutable declaration payloads use fallback', () => {
  let source = 'before';
  const atomWithGetter = Object.freeze({ 'thing@program': 'Worker',
    get situation() { return source; }, slot: [], strut: [] });
  assert.equal(readOnlyProgramDeclarationFields(atomWithGetter).situation, 'before');
  source = 'after';
  assert.equal(readOnlyProgramDeclarationFields(atomWithGetter).situation, 'after');
  assert.equal(readOnlyProgramDeclarationFields({ 'thing@program': 'Worker',
    situation: { mutable: true }, slot: [], strut: [] }), undefined);
});

test('cold and sealed COW reads retain complete active and archived Program declaration order', () => {
  const active = { 'thing@program': 'Active', situation: 'active source', slot: [], strut: [] };
  const archive = { 'thing@backup@default': 'Backup', situation: '', slot: [
    { 'thing@program': 'Dormant', situation: 'archived source', slot: [], strut: [] },
    { thing: 'Folder', situation: '', slot: [
      { 'thing@program': 'Nested', situation: 'nested source', slot: [], strut: [] }
    ], strut: [] }
  ], strut: [] };
  const cold = [active, archive];
  const declarations = (facts) => walkAtoms(facts).flatMap((match) => {
    const fields = readOnlyProgramDeclarationFields(match.atom);
    return fields ? [{ path: match.path.join('/'), ...fields }] : [];
  });
  assert.deepEqual(declarations(cold), [
    { path: 'Active', thingKey: 'thing@program', situationKey: 'situation', situation: 'active source' },
    { path: 'Backup/Dormant', thingKey: 'thing@program', situationKey: 'situation', situation: 'archived source' },
    { path: 'Backup/Folder/Nested', thingKey: 'thing@program', situationKey: 'situation', situation: 'nested source' }
  ]);
  sealWorldFactsRevision(cold);
  const changed = [{ ...active, situation: 'changed source' }, archive];
  sealWorldFactsRevision(changed);
  assert.deepEqual(declarations(changed), [
    { path: 'Active', thingKey: 'thing@program', situationKey: 'situation', situation: 'changed source' },
    { path: 'Backup/Dormant', thingKey: 'thing@program', situationKey: 'situation', situation: 'archived source' },
    { path: 'Backup/Folder/Nested', thingKey: 'thing@program', situationKey: 'situation', situation: 'nested source' }
  ]);
  assert.equal(declarations(cold)[0].situation, 'active source');
});
