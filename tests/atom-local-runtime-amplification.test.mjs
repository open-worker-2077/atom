import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createRuntimeCliExecutor } from '../src/atom-system/adapters/runtime-cli-executor.mjs';
import { createJsonTransactionJournal } from '../src/atom-system/adapters/json-world-repository.mjs';

function atom(thing, situation = '', slot = [], type = '') {
  return { [`thing${type ? `@${type}` : ''}`]: thing, situation, slot, strut: [] };
}

test('TC-PERF-LOCAL-EXPLORE / TC-PERF-LOCAL-TRANSFORM: a 20 MB unrelated sibling set stays local', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-local-runtime-amplification-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const graphFile = path.join(directory, 'graph.json');
  const storeFile = path.join(directory, 'knowledge.json');
  const journalFile = path.join(directory, 'atom.transactions.json');
  const unrelatedDetail = 'x'.repeat(20_000);
  const world = [atom('Root', '', [
    atom('Target', 'before'),
    ...Array.from({ length: 1_000 }, (_, index) => atom(`Unrelated ${index}`, unrelatedDetail))
  ])];
  await fs.writeFile(contextFile, JSON.stringify(world), 'utf8');
  const execute = createRuntimeCliExecutor({ contextFile, graphFile, storeFile });
  await execute({ source: 'atom', interaction: { id: 'perf-prime' } });

  const beforeExplore = await fs.readFile(contextFile, 'utf8');
  const exploreStartedAt = performance.now();
  const explored = await execute({
    source: 'explore {"thing":"Root/Target","situation$full"}',
    interaction: { id: 'perf-local-explore' }
  });
  const exploreElapsedMs = performance.now() - exploreStartedAt;
  assert.equal(explored.ok, true, JSON.stringify(explored.errors));
  assert.equal(explored.items[0].matches[0].path, 'Root/Target');
  assert.ok(exploreElapsedMs < 5_000, `steady exact Explore took ${exploreElapsedMs.toFixed(1)}ms`);
  assert.equal(await fs.readFile(contextFile, 'utf8'), beforeExplore);

  const startedAt = performance.now();
  const result = await execute({
    source: 'transform {"thing":"Root/Target","situation.rep.after"}',
    interaction: { id: 'perf-local-detail' }
  });
  const elapsedMs = performance.now() - startedAt;

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.ok(elapsedMs < 5_000, `local detail Transform took ${elapsedMs.toFixed(1)}ms`);
  assert.deepEqual(result.affectedPaths, ['Root', 'Root/Target']);
  t.diagnostic(`explore=${exploreElapsedMs.toFixed(1)}ms detail=${elapsedMs.toFixed(1)}ms affected=${result.affectedPaths.join(',')}`);
  const journal = await createJsonTransactionJournal({ file: journalFile }).readState();
  const committed = journal.receipts.find((entry) => entry.commandId.includes('legacy-'));
  assert.equal(committed.historyMode, 'local-patch');
  assert.deepEqual(committed.patch.changedPaths, ['Root/Target']);
  await assert.rejects(fs.access(path.join(`${journalFile}.d`, 'objects')), { code: 'ENOENT' });
});

test('TC-PERF-LOCAL-TRANSFORM: structural operations stay local and reversible', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-local-structural-amplification-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const graphFile = path.join(directory, 'graph.json');
  const storeFile = path.join(directory, 'knowledge.json');
  const journalFile = path.join(directory, 'atom.transactions.json');
  const unrelatedDetail = 'x'.repeat(20_000);
  const world = [
    atom('Root', '', [
      atom('Target', 'preserve', [atom('Child', 'preserve child')]),
      atom('Destination'),
      ...Array.from({ length: 1_000 }, (_, index) => atom(`Unrelated ${index}`, unrelatedDetail))
    ]),
    atom('Backup', '', [], 'backup@default')
  ];
  await fs.writeFile(contextFile, JSON.stringify(world), 'utf8');
  const execute = createRuntimeCliExecutor({ contextFile, graphFile, storeFile });
  await execute({ source: 'atom', interaction: { id: 'structural-prime' } });
  const timings = {};
  const run = async (id, source) => {
    const startedAt = performance.now();
    const result = await execute({ source, interaction: { id } });
    timings[id] = performance.now() - startedAt;
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.ok(timings[id] < 5_000, `${id} took ${timings[id].toFixed(1)}ms`);
    assert.equal(result.affectedPaths.some((item) => item.includes('Unrelated')), false);
    return result;
  };

  await run('perf-ren', 'transform {"thing.ren.Renamed":"Root/Target"}');
  await run('perf-mov', 'transform {"thing.mov.Root/Destination":"Root/Renamed"}');
  await run('perf-dsc', 'transform {"thing.dsc.":"Root/Destination/Renamed"}');
  await run('perf-rst', 'transform {"thing.rst.":"Backup/Renamed"}');

  const restored = JSON.parse(await fs.readFile(contextFile, 'utf8'));
  const destination = restored[0].slot.find(({ thing }) => thing === 'Destination');
  assert.equal(destination.slot[0].thing, 'Renamed');
  assert.equal(destination.slot[0].slot[0].thing, 'Child');
  const history = await createJsonTransactionJournal({ file: journalFile }).readState();
  assert.equal(history.receipts.length, 4);
  assert.equal(history.receipts.every((entry) => entry.historyMode === 'local-patch'), true);
  await assert.rejects(fs.access(path.join(`${journalFile}.d`, 'objects')), { code: 'ENOENT' });
  t.diagnostic(Object.entries(timings).map(([id, milliseconds]) => (
    `${id}=${milliseconds.toFixed(1)}ms`
  )).join(' '));
});
