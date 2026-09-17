import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createLegacyWorldService } from '../src/atom-system/adapters/legacy-engine-adapter.mjs';
import { sealWorldFactsRevision } from '../src/atom-system/world-runtime/world-revision.mjs';
import {
  collectDefaultBackupBoundary,
  hasValidatedDefaultBackupArchiveAt
} from '../work-engine/atom-language/default-backup-boundary.mjs';
import { executeAtomLanguage } from '../work-engine/atom-language/engine.mjs';
import {
  isStoredTypedDefaultBackupAtom,
  walkAtoms
} from '../work-engine/atom-language/query-capability.mjs';

const atom = (thing, situation = '', slot = []) => ({ thing, situation, slot, strut: [] });

test('ordinary COW comparison does not revisit a proven archive declaration subtree', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-program-archive-summary-'));
  t.diagnostic(`retained fixture: ${directory}`);
  const target = { contextFile: path.join(directory, 'atom.json'),
    projectionFile: path.join(directory, 'graph.json') };
  const archived = Array.from({ length: 300 }, (_, index) => atom(`Cold-${index}`));
  archived.push({ 'thing@program': 'Dormant', situation: 'def main(arguments):\n    return None',
    slot: [], strut: [] });
  archived.push(atom('Folder', '', [{ 'thing@program': 'Nested',
    situation: 'def main(arguments):\n    return None', slot: [], strut: [] }]));
  archived.push({ thing: 'Duplicate', 'thing@program': 'Ignored', situation: 'source',
    slot: [], strut: [] });
  archived.push({ note: 'Missing thing', situation: '', slot: [
    { 'thing@program': 'Deep', situation: 'def main(arguments):\n    return None', slot: [], strut: [] }
  ], strut: [] });
  await fs.writeFile(target.contextFile, `${JSON.stringify([
    atom('Root', 'before'),
    { 'thing@backup@default@program': 'Backup',
      situation: 'def main(arguments):\n    return None', slot: archived, strut: [] }
  ])}\n`, 'utf8');
  const service = createLegacyWorldService({ memoryAuthoritative: true,
    publishLegacyProjection: false,
    saveSchedule: { quietMs: 60_000, maxDirtyMs: 60_000 },
    execute: (request) => executeAtomLanguage(request) });
  const originalForEach = Array.prototype.forEach;
  const originalClone = globalThis.structuredClone;
  const originalStringify = JSON.stringify;
  let declarationArchiveVisits = 0;
  let declarationDetachedFields = 0;
  const comparedDeclarations = [];
  try {
    const before = await service.readCommittedVersion(target);
    collectDefaultBackupBoundary(before.facts);
    const archiveSlot = before.facts[1].slot;
    const warmed = await service.executeLegacy({ ...target,
      source: 'transform {"thing":"Root","situation.rep.middle"}',
      interaction: { id: 'program-archive-summary-warm' } });
    assert.equal(warmed.ok, true, JSON.stringify(warmed.errors));
    const middle = await service.readCommittedVersion(target);
    assert.strictEqual(middle.facts[1], before.facts[1]);
    Array.prototype.forEach = function (callback, thisArg) {
      if (this === archiveSlot && new Error().stack?.includes('programDeclarationSurface')) {
        return originalForEach.call(this, (entry, index, array) => {
          declarationArchiveVisits += 1;
          return callback.call(thisArg, entry, index, array);
        });
      }
      return originalForEach.call(this, callback, thisArg);
    };
    globalThis.structuredClone = function (value, ...options) {
      if (value && typeof value === 'object' && typeof value.rawKey === 'string'
        && Array.isArray(value.types) && Array.isArray(value.actions)
        && new Error().stack?.includes('programDeclarationSurface')) declarationDetachedFields += 1;
      return originalClone(value, ...options);
    };
    JSON.stringify = function (value, ...options) {
      if (Array.isArray(value) && value.some((item) => item?.thingKey)
        && new Error().stack?.includes('validateAgentProgramDelegation')) {
        comparedDeclarations.push(JSON.parse(originalStringify(value)));
      }
      return originalStringify(value, ...options);
    };
    const written = await service.executeLegacy({ ...target,
      source: 'transform {"thing":"Root","situation.rep.after"}',
      interaction: { id: 'program-archive-summary' } });
    assert.equal(written.ok, true, JSON.stringify(written.errors));
    const after = await service.readCommittedVersion(target);
    assert.equal(before.facts[0].situation, 'before');
    assert.equal(middle.facts[0].situation, 'middle');
    assert.equal(after.facts[0].situation, 'after');
    assert.strictEqual(after.facts[1], before.facts[1]);
    t.diagnostic(`Program declaration archive visits: ${declarationArchiveVisits}`);
    t.diagnostic(`Program declaration detached fields: ${declarationDetachedFields}`);
    assert.equal(declarationArchiveVisits, 0);
    assert.equal(declarationDetachedFields, 0);
    assert.ok(comparedDeclarations.length >= 2);
    for (const declarations of comparedDeclarations) {
      assert.deepEqual(declarations, [
        { path: 'Backup', thingKey: 'thing@backup@default@program', situationKey: 'situation',
          situation: 'def main(arguments):\n    return None' },
        { path: 'Backup/Dormant', thingKey: 'thing@program', situationKey: 'situation',
          situation: 'def main(arguments):\n    return None' },
        { path: 'Backup/Folder/Nested', thingKey: 'thing@program', situationKey: 'situation',
          situation: 'def main(arguments):\n    return None' },
        { path: 'Backup/[303]/Deep', thingKey: 'thing@program', situationKey: 'situation',
          situation: 'def main(arguments):\n    return None' }
      ]);
    }
  } finally {
    Array.prototype.forEach = originalForEach;
    globalThis.structuredClone = originalClone;
    JSON.stringify = originalStringify;
    await service.closeSaves();
  }
});

test('archive proof requires the same sealed root and complete topology, not joined path text', () => {
  const archive = { 'thing@backup@default': 'Backup', situation: '', slot: [
    { 'thing@program': 'Dormant', situation: 'source', slot: [], strut: [] }
  ], strut: [] };
  const original = [atom('A/B', '', [archive])];
  sealWorldFactsRevision(original);
  collectDefaultBackupBoundary(original);
  assert.equal(hasValidatedDefaultBackupArchiveAt(archive, ['A/B', 'Backup']), true);
  assert.equal(hasValidatedDefaultBackupArchiveAt(archive, ['A', 'B', 'Backup']), false);
  assert.equal(hasValidatedDefaultBackupArchiveAt(archive, ['Backup']), false);
  const changedArchive = { ...archive, slot: [...archive.slot, atom('Changed')] };
  assert.equal(hasValidatedDefaultBackupArchiveAt(changedArchive, ['A/B', 'Backup']), false);
  let name = 'Backup';
  const getter = Object.freeze({ 'thing@backup@default': 'Backup',
    get situation() { return name; }, slot: Object.freeze([]), strut: Object.freeze([]) });
  assert.equal(hasValidatedDefaultBackupArchiveAt(getter, ['A/B', 'Backup']), false);
  name = 'Changed';
  assert.equal(hasValidatedDefaultBackupArchiveAt(getter, ['A/B', 'Backup']), false);
});

test('a second typed backup with duplicate thing fields invalidates archive reuse', () => {
  const archive = { 'thing@backup@default': 'Backup', situation: '', slot: [], strut: [] };
  const before = [archive];
  sealWorldFactsRevision(before);
  collectDefaultBackupBoundary(before);
  const duplicate = { 'thing@backup@default': 'Other', thing: 'Alias',
    situation: '', slot: [], strut: [] };
  const candidate = [archive, duplicate];
  assert.equal(hasValidatedDefaultBackupArchiveAt(archive, ['Backup']), true);
  assert.throws(() => collectDefaultBackupBoundary(candidate), { code: 'AMBIGUOUS_DEFAULT_BACKUP' });
  assert.equal(isStoredTypedDefaultBackupAtom(duplicate), true,
    'declaration reuse must fall back whenever boundary sees another typed root');
});

test('walk semantics retain nested Program order, duplicate and missing thing fields, and index placeholders', () => {
  const archive = { 'thing@backup@default': 'Backup', situation: '', slot: [
    { 'thing@program': 'First', situation: 'first', slot: [], strut: [] },
    { thing: 'Duplicate', 'thing@program': 'Second', situation: 'second', slot: [], strut: [] },
    { note: 'Missing thing', situation: 'invalid', slot: [
      { 'thing@program': 'Nested', situation: 'nested', slot: [], strut: [] }
    ], strut: [] }
  ], strut: [] };
  const world = [archive];
  sealWorldFactsRevision(world);
  collectDefaultBackupBoundary(world);
  assert.equal(hasValidatedDefaultBackupArchiveAt(archive, ['Backup']), true);
  const paths = walkAtoms(world).map((match) => match.path.join('/'));
  assert.deepEqual(paths, ['Backup', 'Backup/First', 'Backup/[1]', 'Backup/[2]',
    'Backup/[2]/Nested']);
});
