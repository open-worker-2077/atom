import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createCommitCoordinator } from '../src/atom-system/world-runtime/commit-coordinator.mjs';
import {
  createJsonTransactionJournal,
  createJsonWorldRepository,
  writeJsonAtomically
} from '../src/atom-system/adapters/json-world-repository.mjs';

function revisionOf(facts) {
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(facts)).digest('hex')}`;
}

function command(id, expectedRevision) {
  return {
    contract: 'atom.world-command',
    version: 1,
    commandId: id,
    correlationId: `interaction-${id}`,
    expectedRevision,
    name: 'append-fact',
    payload: {}
  };
}

async function fixture(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-world-transaction-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const worldFile = path.join(directory, 'atom.json');
  const journalFile = path.join(directory, 'transactions.json');
  await fs.writeFile(worldFile, '[]\n', 'utf8');
  const worldRepository = createJsonWorldRepository({ file: worldFile, worldId: 'primary' });
  const journalRepository = createJsonTransactionJournal({ file: journalFile });
  const coordinator = createCommitCoordinator({
    worldRepository,
    journalRepository,
    faultInjector: options.faultInjector
  });
  return { coordinator, worldRepository, journalRepository, worldFile, journalFile };
}

test('concurrent commands with one expected revision serialize and cannot lose updates', async (t) => {
  const { coordinator, worldRepository, journalRepository } = await fixture(t);
  const initial = await worldRepository.read();

  const outcomes = await Promise.allSettled([
    coordinator.execute({
      command: command('cmd-a', initial.revision),
      transition: ({ facts }) => ({ facts: [...facts, { name: 'A' }], result: { added: 'A' } })
    }),
    coordinator.execute({
      command: command('cmd-b', initial.revision),
      transition: ({ facts }) => ({ facts: [...facts, { name: 'B' }], result: { added: 'B' } })
    })
  ]);

  assert.equal(outcomes.filter(({ status }) => status === 'fulfilled').length, 1);
  const rejection = outcomes.find(({ status }) => status === 'rejected').reason;
  assert.equal(rejection.code, 'WORLD_REVISION_CONFLICT');
  assert.equal((await worldRepository.read()).facts.length, 1);
  assert.equal((await journalRepository.readState()).receipts.length, 1);
});

test('a repeated command id is idempotent and returns the original receipt', async (t) => {
  const { coordinator, worldRepository, journalRepository } = await fixture(t);
  const initial = await worldRepository.read();
  let transitions = 0;
  const request = {
    command: command('cmd-repeat', initial.revision),
    transition: ({ facts }) => {
      transitions += 1;
      return { facts: [...facts, { name: 'once' }], result: { transitions } };
    }
  };

  const first = await coordinator.execute(request);
  const repeated = await coordinator.execute(request);

  assert.deepEqual(repeated, first);
  assert.equal(transitions, 1);
  assert.equal((await worldRepository.read()).facts.length, 1);
  assert.equal((await journalRepository.readState()).receipts.length, 1);
});

test('transaction history appends compact events and content-addressed snapshots without rewriting legacy history', async (t) => {
  const { coordinator, worldRepository, journalRepository, journalFile } = await fixture(t);
  const initial = await worldRepository.read();
  const first = await coordinator.execute({
    command: command('cmd-first-compact', initial.revision),
    transition: ({ facts }) => ({ facts: [...facts, { name: 'first' }] })
  });
  const eventFile = path.join(`${journalFile}.d`, 'events.jsonl');
  const eventsAfterFirst = await fs.readFile(eventFile, 'utf8');
  await coordinator.execute({
    command: command('cmd-second-compact', first.afterRevision),
    transition: ({ facts }) => ({ facts: [...facts, { name: 'second' }] })
  });

  const history = await journalRepository.readState();
  assert.equal(history.receipts.length, 2);
  const eventsAfterSecond = await fs.readFile(eventFile, 'utf8');
  assert.equal(eventsAfterSecond.startsWith(eventsAfterFirst), true);
  assert.equal(eventsAfterSecond.length - eventsAfterFirst.length < 10_000, true);
  const objects = await fs.readdir(path.join(`${journalFile}.d`, 'objects'));
  assert.equal(objects.length, 3);
  assert.equal(objects.every((name) => name.endsWith('.json.gz')), true);
  await assert.rejects(fs.access(journalFile), { code: 'ENOENT' });
});

test('local transaction records exact patch history without complete-world snapshot objects', async (t) => {
  const { coordinator, worldRepository, journalRepository, journalFile } = await fixture(t);
  const initialFacts = [{ thing: 'Root', situation: '', contain: [
    { thing: 'Target', situation: 'before', contain: [], support: [] },
    { thing: 'Unrelated', situation: 'unchanged', contain: [], support: [] }
  ], support: [] }];
  await writeJsonAtomically(worldRepository.file, initialFacts);
  const initial = await worldRepository.read();
  const nextFacts = structuredClone(initialFacts);
  nextFacts[0].contain[0].situation = 'after';

  const receipt = await coordinator.execute({
    command: command('cmd-local-patch', initial.revision),
    transition: () => ({
      facts: nextFacts,
      changedPaths: ['Root/Target'],
      result: { affectedAtoms: [{ path: 'Root/Target', axes: ['situation'] }] }
    })
  });

  assert.deepEqual(receipt.affectedAtoms, [
    { path: 'Root', axes: [] },
    { path: 'Root/Target', axes: ['situation'] }
  ]);
  const committed = await journalRepository.findCommitted('cmd-local-patch');
  assert.equal(committed.historyMode, 'local-patch');
  assert.equal(committed.before, undefined);
  assert.equal(committed.after, undefined);
  assert.deepEqual(committed.patch.changedPaths, ['Root/Target']);
  assert.deepEqual(committed.inversePatch.changedPaths, ['Root/Target']);
  await assert.rejects(fs.access(path.join(`${journalFile}.d`, 'objects')), { code: 'ENOENT' });
});

test('rollback applies the inverse local patch without restoring an unrelated world snapshot', async (t) => {
  const { coordinator, worldRepository } = await fixture(t);
  const initialFacts = [{ thing: 'Root', situation: '', contain: [
    { thing: 'Target', situation: 'before', contain: [], support: [] },
    { thing: 'Unrelated', situation: 'keep', contain: [], support: [] }
  ], support: [] }];
  await writeJsonAtomically(worldRepository.file, initialFacts);
  const initial = await worldRepository.read();
  const nextFacts = structuredClone(initialFacts);
  nextFacts[0].contain[0].situation = 'after';
  const committed = await coordinator.execute({
    command: command('cmd-local-change', initial.revision),
    transition: () => ({
      facts: nextFacts,
      changedPaths: ['Root/Target'],
      result: { affectedAtoms: [{ path: 'Root/Target', axes: ['situation'] }] }
    })
  });

  const externalFacts = structuredClone((await worldRepository.read()).facts);
  externalFacts[0].contain[1].situation = 'still keep';
  await writeJsonAtomically(worldRepository.file, externalFacts);
  const external = await worldRepository.read();
  await assert.rejects(
    coordinator.rollback({
      targetCommandId: 'cmd-local-change',
      command: command('cmd-local-rollback-stale', external.revision)
    }),
    (error) => error.code === 'ROLLBACK_WORLD_DIVERGED'
  );
  assert.equal((await worldRepository.read()).facts[0].contain[1].situation, 'still keep');

  await writeJsonAtomically(worldRepository.file, nextFacts);
  await coordinator.rollback({
    targetCommandId: 'cmd-local-change',
    command: command('cmd-local-rollback', committed.afterRevision)
  });
  const restored = await worldRepository.read();
  assert.equal(restored.facts[0].contain[0].situation, 'before');
  assert.equal(restored.facts[0].contain[1].situation, 'keep');
});

test('relation and shortcut side effects share the structural patch and inverse rollback', async (t) => {
  const { coordinator, worldRepository, journalRepository } = await fixture(t);
  const initialFacts = [
    { thing: 'Source', situation: '', contain: [], support: [
      { 'if@current': true, then: [{ thing: 'Tree/Target' }] }
    ] },
    { thing: 'Tree', situation: '', contain: [
      { thing: 'Target', situation: 'before', contain: [], support: [] }
    ], support: [] },
    { 'thing@shortcut': 'Entry', situation: JSON.stringify({
      contract: 'atom.shortcut', version: 1, referenceId: 'local-reference',
      target: { state: 'linked', path: 'Tree/Target' }
    }), contain: [], support: [] }
  ];
  const nextFacts = structuredClone(initialFacts);
  nextFacts[0].support[0].then[0].thing = 'Target';
  nextFacts[1].contain[0].thing = 'Renamed';
  const shortcutRecord = JSON.parse(nextFacts[2].situation);
  shortcutRecord.target.path = 'Tree/Renamed';
  nextFacts[2].situation = JSON.stringify(shortcutRecord);
  await writeJsonAtomically(worldRepository.file, initialFacts);
  const initial = await worldRepository.read();

  const committed = await coordinator.execute({
    command: command('cmd-local-relation-shortcut', initial.revision),
    transition: () => ({
      facts: nextFacts,
      changedPaths: ['Tree/Target', 'Tree/Renamed', 'Source', 'Entry']
    })
  });
  const history = await journalRepository.findCommitted('cmd-local-relation-shortcut');
  assert.deepEqual(history.patch.changedPaths, ['Entry', 'Source', 'Tree/Renamed', 'Tree/Target']);
  assert.equal(history.patch.operations.some((operation) => operation.path === 'Source'), true);
  assert.equal(history.patch.operations.some((operation) => operation.path === 'Entry'), true);

  await coordinator.rollback({
    targetCommandId: committed.commandId,
    command: command('cmd-local-relation-shortcut-rollback', committed.afterRevision)
  });
  assert.deepEqual((await worldRepository.read()).facts, initialFacts);
});

test('incremental history reads legacy receipts without modifying the legacy journal', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-legacy-journal-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const journalFile = path.join(directory, 'transactions.json');
  const before = { contract: 'atom.world-snapshot', version: 1, worldId: 'primary', revision: revisionOf([]), facts: [] };
  const afterFacts = [{ name: 'legacy' }];
  const after = { contract: 'atom.world-snapshot', version: 1, worldId: 'primary', revision: revisionOf(afterFacts), facts: afterFacts };
  const receipt = {
    contract: 'atom.world-receipt', version: 1, commandId: 'legacy-command',
    correlationId: 'legacy-correlation', beforeRevision: before.revision,
    afterRevision: after.revision, status: 'committed', committedAt: new Date(0).toISOString(),
    source: 'legacy', affectedAtoms: [], result: null
  };
  const legacy = {
    schemaVersion: 1, historyMode: 'latest-rollback-snapshot', prepared: [],
    receipts: [{ commandId: 'legacy-command', correlationId: 'legacy-correlation', command: command('legacy-command', before.revision), before, after, receipt }]
  };
  const original = `${JSON.stringify(legacy, null, 2)}\n`;
  await fs.writeFile(journalFile, original, 'utf8');
  const repository = createJsonTransactionJournal({ file: journalFile });

  assert.deepEqual(await repository.findReceipt('legacy-command'), receipt);
  assert.deepEqual((await repository.findCommitted('legacy-command')).before.facts, []);
  assert.equal(await fs.readFile(journalFile, 'utf8'), original);
});

test('atomic JSON replacement retries a transient Windows rename refusal', async () => {
  let renameAttempts = 0;
  const fileSystem = {
    mkdir: async () => {},
    writeFile: async () => {},
    rename: async () => {
      renameAttempts += 1;
      if (renameAttempts < 3) throw Object.assign(new Error('busy'), { code: 'EPERM' });
    },
    rm: async () => {}
  };

  await writeJsonAtomically('C:\\tmp\\world.json', [], {
    fileSystem,
    retryDelaysMs: [0, 0, 0]
  });

  assert.equal(renameAttempts, 3);
});

test('recovery completes a prepared transaction interrupted before the world write', async (t) => {
  let interrupted = true;
  const files = await fixture(t, {
    faultInjector: async (point) => {
      if (point === 'after-prepare' && interrupted) {
        interrupted = false;
        throw Object.assign(new Error('simulated interruption'), { code: 'SIMULATED_INTERRUPTION' });
      }
    }
  });
  const initial = await files.worldRepository.read();

  await assert.rejects(
    files.coordinator.execute({
      command: command('cmd-recover-before', initial.revision),
      transition: ({ facts }) => ({ facts: [...facts, { name: 'recovered' }], result: {} })
    }),
    (error) => error.code === 'SIMULATED_INTERRUPTION'
  );
  assert.equal((await files.worldRepository.read()).revision, initial.revision);

  const restarted = createCommitCoordinator({
    worldRepository: files.worldRepository,
    journalRepository: files.journalRepository
  });
  assert.deepEqual(await restarted.recover(), { recovered: 1 });
  assert.equal((await files.worldRepository.read()).facts[0].name, 'recovered');
  assert.equal((await files.journalRepository.readState()).prepared.length, 0);
  assert.equal((await files.journalRepository.readState()).receipts.length, 1);
});

test('local patch recovery completes an interrupted prepare without snapshot objects', async (t) => {
  let interrupted = true;
  const files = await fixture(t, {
    faultInjector: async (point) => {
      if (point === 'after-prepare' && interrupted) {
        interrupted = false;
        throw Object.assign(new Error('simulated interruption'), { code: 'SIMULATED_INTERRUPTION' });
      }
    }
  });
  const initialFacts = [{ thing: 'Root', situation: '', contain: [
    { thing: 'Target', situation: 'before', contain: [], support: [] }
  ], support: [] }];
  await writeJsonAtomically(files.worldFile, initialFacts);
  const initial = await files.worldRepository.read();
  const nextFacts = structuredClone(initialFacts);
  nextFacts[0].contain[0].situation = 'after';

  await assert.rejects(files.coordinator.execute({
    command: command('cmd-local-recover-before', initial.revision),
    transition: () => ({
      facts: nextFacts,
      changedPaths: ['Root/Target'],
      result: {
        affectedAtoms: [{ path: 'Root/Target', axes: ['situation'] }],
        affectedAtomsComplete: true
      }
    })
  }), (error) => error.code === 'SIMULATED_INTERRUPTION');

  const restarted = createCommitCoordinator({
    worldRepository: files.worldRepository,
    journalRepository: files.journalRepository
  });
  assert.deepEqual(await restarted.recover(), { recovered: 1 });
  assert.equal((await files.worldRepository.read()).facts[0].contain[0].situation, 'after');
  const committed = await files.journalRepository.findCommitted('cmd-local-recover-before');
  assert.equal(committed.historyMode, 'local-patch');
  await assert.rejects(fs.access(path.join(`${files.journalFile}.d`, 'objects')), { code: 'ENOENT' });
});

test('recovery finalizes history interrupted after the world write without applying twice', async (t) => {
  let interrupted = true;
  const files = await fixture(t, {
    faultInjector: async (point) => {
      if (point === 'after-world-write' && interrupted) {
        interrupted = false;
        throw Object.assign(new Error('simulated interruption'), { code: 'SIMULATED_INTERRUPTION' });
      }
    }
  });
  const initial = await files.worldRepository.read();

  await assert.rejects(
    files.coordinator.execute({
      command: command('cmd-recover-after', initial.revision),
      transition: ({ facts }) => ({ facts: [...facts, { name: 'one-write' }], result: {} })
    }),
    (error) => error.code === 'SIMULATED_INTERRUPTION'
  );
  assert.equal((await files.worldRepository.read()).facts.length, 1);

  const restarted = createCommitCoordinator({
    worldRepository: files.worldRepository,
    journalRepository: files.journalRepository
  });
  assert.deepEqual(await restarted.recover(), { recovered: 1 });
  assert.equal((await files.worldRepository.read()).facts.length, 1);
  assert.equal((await files.journalRepository.readState()).receipts.length, 1);
});

test('local patch recovery finalizes an interrupted committed world without applying twice', async (t) => {
  let interrupted = true;
  const files = await fixture(t, {
    faultInjector: async (point) => {
      if (point === 'after-world-write' && interrupted) {
        interrupted = false;
        throw Object.assign(new Error('simulated interruption'), { code: 'SIMULATED_INTERRUPTION' });
      }
    }
  });
  const initialFacts = [{ thing: 'Root', situation: '', contain: [
    { thing: 'Target', situation: 'before', contain: [], support: [] }
  ], support: [] }];
  await writeJsonAtomically(files.worldFile, initialFacts);
  const initial = await files.worldRepository.read();
  const nextFacts = structuredClone(initialFacts);
  nextFacts[0].contain[0].situation = 'after';

  await assert.rejects(files.coordinator.execute({
    command: command('cmd-local-recover-after', initial.revision),
    transition: () => ({
      facts: nextFacts,
      changedPaths: ['Root/Target'],
      result: {
        affectedAtoms: [{ path: 'Root/Target', axes: ['situation'] }],
        affectedAtomsComplete: true
      }
    })
  }), (error) => error.code === 'SIMULATED_INTERRUPTION');

  const restarted = createCommitCoordinator({
    worldRepository: files.worldRepository,
    journalRepository: files.journalRepository
  });
  assert.deepEqual(await restarted.recover(), { recovered: 1 });
  assert.equal((await files.worldRepository.read()).facts[0].contain[0].situation, 'after');
  assert.equal((await files.journalRepository.readState()).receipts.length, 1);
});

test('invalid or no-change transitions leave world and history untouched', async (t) => {
  const { coordinator, worldRepository, journalRepository } = await fixture(t);
  const initial = await worldRepository.read();

  await assert.rejects(
    coordinator.execute({
      command: command('cmd-invalid', initial.revision),
      transition: () => ({ facts: 'not-an-array' })
    }),
    (error) => error.code === 'INVALID_WORLD_TRANSITION'
  );
  await assert.rejects(
    coordinator.execute({
      command: command('cmd-no-change', initial.revision),
      transition: ({ facts }) => ({ facts })
    }),
    (error) => error.code === 'WORLD_TRANSITION_NO_CHANGE'
  );

  assert.equal((await worldRepository.read()).revision, revisionOf([]));
  assert.deepEqual(await journalRepository.readState(), { prepared: [], receipts: [] });
});

test('rollback restores the exact before snapshot as a new audited commit', async (t) => {
  const { coordinator, worldRepository, journalRepository } = await fixture(t);
  const initial = await worldRepository.read();
  const committed = await coordinator.execute({
    command: command('cmd-change', initial.revision),
    transition: ({ facts }) => ({ facts: [...facts, { name: 'temporary' }], result: {} })
  });

  const rolledBack = await coordinator.rollback({
    targetCommandId: 'cmd-change',
    command: command('cmd-rollback', committed.afterRevision)
  });

  assert.deepEqual((await worldRepository.read()).facts, []);
  assert.equal(rolledBack.beforeRevision, committed.afterRevision);
  assert.equal(rolledBack.afterRevision, initial.revision);
  const history = await journalRepository.readState();
  assert.equal(history.receipts.length, 2);
  assert.equal(history.receipts[1].commandId, 'cmd-rollback');
  assert.equal(history.receipts[1].receipt.result.restoredCommandId, 'cmd-change');
});

test('rollback refuses to erase a later committed world revision', async (t) => {
  const { coordinator, worldRepository } = await fixture(t);
  const initial = await worldRepository.read();
  const first = await coordinator.execute({
    command: command('cmd-first', initial.revision),
    transition: ({ facts }) => ({ facts: [...facts, { name: 'first' }] })
  });
  const second = await coordinator.execute({
    command: command('cmd-second', first.afterRevision),
    transition: ({ facts }) => ({ facts: [...facts, { name: 'second' }] })
  });

  await assert.rejects(
    coordinator.rollback({
      targetCommandId: 'cmd-first',
      command: command('cmd-unsafe-rollback', second.afterRevision)
    }),
    (error) => error.code === 'ROLLBACK_WORLD_DIVERGED'
  );
  assert.deepEqual((await worldRepository.read()).facts.map(({ name }) => name), ['first', 'second']);
});
