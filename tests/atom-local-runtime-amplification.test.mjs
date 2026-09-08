import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createRuntimeCliExecutor } from '../src/atom-system/adapters/runtime-cli-executor.mjs';
import {
  createJsonTransactionJournal,
  createJsonWorldRepository
} from '../src/atom-system/adapters/json-world-repository.mjs';
import { createCommitCoordinator } from '../src/atom-system/world-runtime/commit-coordinator.mjs';

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

test('TC-PERF-LOCAL-CREATE: a plain leaf create stays local beside a 20 MB sibling set', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-local-create-amplification-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const graphFile = path.join(directory, 'graph.json');
  const storeFile = path.join(directory, 'knowledge.json');
  const journalFile = path.join(directory, 'atom.transactions.json');
  const unrelatedDetail = 'x'.repeat(20_000);
  const world = [atom('Root', '', [
    ...Array.from({ length: 1_000 }, (_, index) => atom(`Unrelated ${index}`, unrelatedDetail))
  ])];
  const baseline = JSON.stringify(world);
  await fs.writeFile(contextFile, baseline, 'utf8');
  const execute = createRuntimeCliExecutor({ contextFile, graphFile, storeFile });
  await execute({ source: 'atom', interaction: { id: 'perf-create-prime' } });

  const startedAt = performance.now();
  const result = await execute({
    source: 'transform new {"thing":"Root/New","situation":"small","slot":[],"strut":[]}',
    interaction: { id: 'perf-local-create' }
  });
  const elapsedMs = performance.now() - startedAt;

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.ok(elapsedMs < 5_000, `local leaf create took ${elapsedMs.toFixed(1)}ms`);
  assert.equal((await fs.readFile(contextFile, 'utf8')) === baseline, true,
    'plain leaf create rewrote the complete baseline before acknowledgment');
  const journal = await createJsonTransactionJournal({ file: journalFile }).readState();
  const committed = journal.receipts.find((entry) => entry.correlationId === 'perf-local-create');
  assert.equal(committed.historyMode, 'local-patch');
  assert.deepEqual(committed.patch.changedPaths, ['Root/New']);
  t.diagnostic(`plain-leaf-create=${elapsedMs.toFixed(1)}ms`);
});

test('TC-PERF-CONSERVATIVE-CREATE: a nested create keeps the complete-world safety path', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-nested-create-amplification-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const graphFile = path.join(directory, 'graph.json');
  const storeFile = path.join(directory, 'knowledge.json');
  const journalFile = path.join(directory, 'atom.transactions.json');
  await fs.writeFile(contextFile, JSON.stringify([atom('Root')]), 'utf8');
  const execute = createRuntimeCliExecutor({ contextFile, graphFile, storeFile });
  await execute({ source: 'atom', interaction: { id: 'nested-create-prime' } });

  const result = await execute({
    source: `transform new ${JSON.stringify(atom('Root/Branch', '', [atom('Child')]))}`,
    interaction: { id: 'conservative-nested-create' }
  });

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const journal = await createJsonTransactionJournal({ file: journalFile }).readState();
  const committed = journal.receipts.find((entry) => entry.correlationId === 'conservative-nested-create');
  assert.notEqual(committed.historyMode, 'local-patch');
});

test('TC-PERF-CONSERVATIVE-TRANSFORM: structural operations stay whole-world and reversible', async (t) => {
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
  assert.equal(history.receipts.every((entry) => entry.historyMode !== 'local-patch'), true);
  await fs.access(path.join(`${journalFile}.d`, 'objects'));
  t.diagnostic(Object.entries(timings).map(([id, milliseconds]) => (
    `${id}=${milliseconds.toFixed(1)}ms`
  )).join(' '));
});

test('TC-PERF-LOCAL-COMMIT: acknowledgment appends one bounded record without writing the baseline', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-local-commit-amplification-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const worldFile = path.join(directory, 'atom.json');
  const localCommitFile = path.join(directory, 'world-commits.jsonl');
  const journalFile = path.join(directory, 'transactions.json');
  const unrelated = 'x'.repeat(20_000);
  const beforeFacts = [atom('Root', '', [
    atom('Target', 'before'),
    ...Array.from({ length: 1_000 }, (_, index) => atom(`Unrelated ${index}`, unrelated))
  ])];
  const afterFacts = structuredClone(beforeFacts);
  afterFacts[0].slot[0].situation = 'after';
  const baselineText = `${JSON.stringify(beforeFacts)}\n`;
  await fs.writeFile(worldFile, baselineText, 'utf8');
  const writes = [];
  const instrumentedFileSystem = {
    ...fs,
    async open(target, flags, ...rest) {
      const handle = await fs.open(target, flags, ...rest);
      return {
        truncate: (...args) => handle.truncate(...args),
        async write(value, ...args) {
          writes.push({ target: path.resolve(target), bytes: Buffer.byteLength(value) });
          return handle.write(value, ...args);
        },
        async writeFile(value, ...args) {
          writes.push({ target: path.resolve(target), bytes: Buffer.byteLength(value) });
          return handle.writeFile(value, ...args);
        },
        sync: (...args) => handle.sync(...args),
        close: (...args) => handle.close(...args)
      };
    }
  };
  const repository = createJsonWorldRepository({
    file: worldFile,
    worldId: 'primary',
    localCommitFile,
    fileSystem: instrumentedFileSystem
  });
  const coordinator = createCommitCoordinator({
    worldRepository: repository,
    journalRepository: createJsonTransactionJournal({ file: journalFile })
  });
  const initial = await repository.read();
  const receipt = await coordinator.execute({
    command: {
      contract: 'atom.world-command',
      version: 1,
      commandId: 'bounded-one-axis',
      correlationId: 'bounded-one-axis',
      expectedRevision: initial.revision,
      name: 'bounded-one-axis',
      payload: {}
    },
    transition: () => ({
      facts: afterFacts,
      changedPaths: ['Root/Target'],
      result: {
        affectedPathClosureComplete: true,
        relationEndpoints: [],
        lockPaths: [],
        shortcutPaths: [],
        referencePaths: []
      }
    })
  });

  assert.equal(receipt.status, 'committed');
  assert.equal(await fs.readFile(worldFile, 'utf8'), baselineText);
  assert.equal(writes.some(({ target }) => target === path.resolve(worldFile)), false);
  const recordWrites = writes.filter(({ target }) => target === path.resolve(localCommitFile));
  assert.equal(recordWrites.length, 2, 'one local record and its publication proof are appended');
  const appendedBytes = recordWrites.reduce((sum, { bytes }) => sum + bytes, 0);
  assert.ok(appendedBytes < Buffer.byteLength(baselineText) / 100,
    `local record frame ${appendedBytes} bytes must stay bounded against ${Buffer.byteLength(baselineText)}`);
});
