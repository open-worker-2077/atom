import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createLegacyWorldService } from '../src/atom-system/adapters/legacy-engine-adapter.mjs';
import { sealWorldFactsRevision } from '../src/atom-system/world-runtime/world-revision.mjs';
import { executeAtomLanguage } from '../work-engine/atom-language/engine.mjs';
import { createAccessController, prepareExploreWorld } from '../work-engine/atom-language/query-capability.mjs';
import * as transformExecutor from '../work-engine/atom-language/transform-executor.mjs';

const atom = (thing, situation = '', slot = [], strut = []) => ({ thing, situation, slot, strut });

test('pure Explore does not prepare Transform selectors or bindings in a sealed COW world', async (t) => {
  const observed = [];
  for (const archiveSize of [16, 128]) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-explore-index-boundary-'));
    t.diagnostic(`retained fixture: ${directory}`);
    const target = { contextFile: path.join(directory, 'atom.json'),
      projectionFile: path.join(directory, 'graph.json') };
    const archived = Array.from({ length: archiveSize }, (_, index) => atom(`Cold-${index}`));
    await fs.writeFile(target.contextFile, `${JSON.stringify([
      atom('Root', 'before'),
      { 'thing@backup@default': 'Backup', situation: '', slot: archived, strut: [] }
    ])}\n`, 'utf8');
    const service = createLegacyWorldService({ memoryAuthoritative: true,
      publishLegacyProjection: false,
      saveSchedule: { quietMs: 60_000, maxDirtyMs: 60_000 },
      execute: (request) => executeAtomLanguage(request) });
    const originalForEach = Array.prototype.forEach;
    const originalEntries = Object.entries;
    const originalMapSet = Map.prototype.set;
    try {
      const before = await service.readCommittedVersion(target);
      const initialExplore = await service.executeLegacy({ ...target,
        source: 'explore {"thing":"Root","situation$full":true}',
        interaction: { id: `explore-index-before-${archiveSize}` } });
      assert.equal(initialExplore.ok, true, JSON.stringify(initialExplore.errors));
      assert.equal(initialExplore.items?.[0]?.matches?.[0]?.situation
        ?? initialExplore.matches?.[0]?.situation, 'before');
      const written = await service.executeLegacy({ ...target,
        source: 'transform {"thing":"Root","situation.rep.after"}',
        interaction: { id: `explore-index-write-${archiveSize}` } });
      assert.equal(written.ok, true, JSON.stringify(written.errors));
      const after = await service.readCommittedVersion(target);
      assert.strictEqual(after.facts[1], before.facts[1]);
      const archiveSlot = after.facts[1].slot;
      const archivedAtoms = new Set(archiveSlot);
      let transformIndexVisits = 0;
      let transformBindingReads = 0;
      let transformSelectorAdds = 0;
      Array.prototype.forEach = function (callback, thisArg) {
        if (this === archiveSlot && new Error().stack?.includes('prepareTransformRelationIndex')) {
          return originalForEach.call(this, (entry, index, array) => {
            transformIndexVisits += 1;
            return callback.call(thisArg, entry, index, array);
          });
        }
        return originalForEach.call(this, callback, thisArg);
      };
      Object.entries = function (value) {
        if (archivedAtoms.has(value) && new Error().stack?.includes('capturePartnerBindings')) {
          transformBindingReads += 1;
        }
        return originalEntries(value);
      };
      Map.prototype.set = function (key, value) {
        if (typeof key === 'string' && key.startsWith('Cold-')
          && new Error().stack?.includes('createExactTransformIndexFromMatches')) {
          transformSelectorAdds += 1;
        }
        return originalMapSet.call(this, key, value);
      };
      transformExecutor.prepareTransformRelationIndex(structuredClone(after.facts), 'atom.json');
      assert.ok(transformSelectorAdds >= archiveSize, 'selector-add counter must observe a real Transform index');
      transformSelectorAdds = 0;
      const explored = await service.executeLegacy({ ...target, source: 'explore {"thing":"Root","situation$full":true}',
        interaction: { id: `explore-index-read-${archiveSize}` } });
      assert.equal(explored.ok, true, JSON.stringify(explored.errors));
      assert.equal(explored.items?.[0]?.matches?.[0]?.situation ?? explored.matches?.[0]?.situation, 'after');
      assert.equal(before.facts[0].situation, 'before');
      t.diagnostic(`archive=${archiveSize} Transform-index child visits=${transformIndexVisits} selector adds=${transformSelectorAdds} binding reads=${transformBindingReads}`);
      observed.push({ archiveSize, transformIndexVisits, transformSelectorAdds, transformBindingReads });
    } finally {
      Array.prototype.forEach = originalForEach;
      Object.entries = originalEntries;
      Map.prototype.set = originalMapSet;
      await service.closeSaves();
    }
  }
  assert.deepEqual(observed.map(({ transformIndexVisits, transformSelectorAdds, transformBindingReads }) => (
    [transformIndexVisits, transformSelectorAdds, transformBindingReads]
  )), [[0, 0, 0], [0, 0, 0]]);
});

test('lightweight access matches retain Transform paths where Explore has virtual and placeholder differences', async () => {
  const world = [
    { 'thing@program': '世界之外', situation: 'agent({"labels":[],"functions":{"names":["explore"]}})',
      slot: [atom('Target')], strut: [] },
    { note: 'missing thing', situation: '', slot: [
      { 'thing@program': 'NestedAgent', situation: '', slot: [], strut: [] }
    ], strut: [] }
  ];
  sealWorldFactsRevision(world);
  const full = transformExecutor.prepareTransformRelationIndex(world, 'atom.json').matches;
  const explore = prepareExploreWorld(world).allMatches;
  assert.equal(explore[0].virtual, true);
  assert.equal(explore.find((match) => match.path.join('/') === '世界之外')?.virtual, true);
  assert.equal(full.find((match) => match.path.join('/') === '世界之外')?.atom, world[0]);
  assert.equal(explore.some((match) => match.path.join('/') === '[1]/NestedAgent'), true);
  assert.equal(full.some((match) => match.path.join('/') === '/NestedAgent'), true);
  assert.equal(typeof transformExecutor.prepareTransformAccessMatches, 'function');
  const lightweight = transformExecutor.prepareTransformAccessMatches(world);
  assert.deepEqual(lightweight.map((match) => ({ atom: match.atom, path: match.path,
    parentAtom: match.parent?.atom ?? null, index: match.index })),
  full.map((match) => ({ atom: match.atom, path: match.path,
    parentAtom: match.parent?.atom ?? null, index: match.index })));
  const source = { targetScope: 'exact', readFields: new Set(['thing']),
    writeFields: new Set(), allowedWindowTypes: { all: ['program'] } };
  const programLockIndex = { byPath: new Map([['世界之外/Target', { sources: [source] }]]) };
  const options = { agentPath: '世界之外', agentSecurity: { labels: [] }, programLockIndex };
  const target = lightweight.find((match) => match.atom === world[0].slot[0]);
  const authorized = await createAccessController(world, {
    ...options, preparedAccessMatches: lightweight
  }).authorize(target, 'read', 'thing');
  assert.equal(authorized.decision, 'allow');
  const wrongVirtual = await createAccessController(world, {
    ...options, preparedAccessMatches: explore
  }).authorize(target, 'read', 'thing');
  assert.equal(wrongVirtual.decision, 'truncate');
});

test('sealed access matches reuse only the match list and a later Transform completes bindings', () => {
  const source = atom('Source', '', [], [{ 'if@current': true, then: [{ thing: 'Root/Target' }] }]);
  const world = [atom('Root', '', [source, atom('Target')])];
  sealWorldFactsRevision(world);
  const first = transformExecutor.prepareTransformAccessMatches(world);
  const originalEntries = Object.entries;
  let subsequentFieldReads = 0;
  Object.entries = function (value) {
    if (value === source) subsequentFieldReads += 1;
    return originalEntries(value);
  };
  try {
    assert.strictEqual(transformExecutor.prepareTransformAccessMatches(world), first);
    assert.equal(subsequentFieldReads, 0);
  } finally {
    Object.entries = originalEntries;
  }
  const withoutRoot = transformExecutor.prepareTransformRelationIndex(world);
  assert.strictEqual(withoutRoot.matches, first);
  assert.equal(withoutRoot.bindings.length, 1,
    'a matches-only cache entry cannot masquerade as completed bindings');
  assert.equal(withoutRoot.exactIndex.get('Target')?.length, 1);
  const withRoot = transformExecutor.prepareTransformRelationIndex(world, 'atom.json');
  assert.strictEqual(withRoot.matches, first);
  assert.equal(withRoot.bindings.length, 1);
  assert.strictEqual(transformExecutor.prepareTransformRelationIndex(world, 'atom.json'), withRoot);
  assert.strictEqual(transformExecutor.prepareTransformAccessMatches(world), first);
  assert.strictEqual(transformExecutor.prepareTransformRelationIndex(world, 'atom.json'), withRoot,
    'access reads must not overwrite an already completed relation index');

  const provisional = [atom('Before')];
  assert.equal(transformExecutor.prepareTransformAccessMatches(provisional)[0].path.join('/'), 'Before');
  provisional[0].thing = 'After';
  assert.equal(transformExecutor.prepareTransformAccessMatches(provisional)[0].path.join('/'), 'After');

  let accessorName = 'Before';
  const shallow = Object.freeze([Object.freeze({ get thing() { return accessorName; },
    situation: '', slot: Object.freeze([]), strut: Object.freeze([]) })]);
  assert.equal(transformExecutor.prepareTransformAccessMatches(shallow)[0].path.join('/'), 'Before');
  accessorName = 'After';
  assert.equal(transformExecutor.prepareTransformAccessMatches(shallow)[0].path.join('/'), 'After');
  sealWorldFactsRevision(provisional);
  assert.equal(transformExecutor.prepareTransformAccessMatches(provisional)[0].path.join('/'), 'After');

  const cow = [atom('Changed', '', world[0].slot)];
  sealWorldFactsRevision(cow);
  assert.notStrictEqual(transformExecutor.prepareTransformAccessMatches(cow), first);
  assert.equal(transformExecutor.prepareTransformAccessMatches(cow)[0].path.join('/'), 'Changed');
  assert.equal(first[0].path.join('/'), 'Root');
});
