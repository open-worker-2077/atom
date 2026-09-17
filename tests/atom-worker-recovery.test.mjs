import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Worker } from 'node:worker_threads';

import { createCommitCoordinator } from '../src/atom-system/world-runtime/commit-coordinator.mjs';
import { createMemoryTransactionPorts } from '../src/atom-system/world-runtime/memory-transaction-ports.mjs';
import { revisionOfWorldFacts } from '../src/atom-system/world-runtime/world-revision.mjs';
import { createDurableWorldWriter } from '../src/atom-system/adapters/durable-world-writer.mjs';
import { createTransactionalWorldPersistence } from '../src/atom-system/adapters/transactional-world-persistence.mjs';
import { createJsonTransactionJournal, createJsonWorldRepository } from '../src/atom-system/adapters/json-world-repository.mjs';

const facts = (a = 'old', b = 'old', c = 'old') => ['A', 'B', 'C'].map((thing, i) => ({
  thing, situation: [a, b, c][i], slot: [], strut: []
}));
const command = (id, expectedRevision) => ({ contract: 'atom.world-command', version: 1,
  commandId: id, correlationId: id, expectedRevision, name: 'transform', payload: {} });
const local = (next, changedPath, result = {}) => ({ facts: next, changedPaths: [changedPath],
  result: { affectedPathClosureComplete: true, ...result } });

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-worker-recovery-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const journalFile = path.join(directory, 'transactions.json');
  await fs.writeFile(contextFile, JSON.stringify(facts()));
  const journalRepository = createJsonTransactionJournal({ file: journalFile });
  const worldRepository = createJsonWorldRepository({ file: contextFile, worldId: 'primary',
    localCommitFile: path.join(`${journalFile}.d`, 'world-commits.jsonl') });
  return { contextFile, journalFile, journalRepository, worldRepository,
    coordinator: createCommitCoordinator({ worldRepository, journalRepository }) };
}

async function edit(f, id, next, changedPath, result) {
  const before = await f.worldRepository.read();
  return f.coordinator.execute({ command: command(id, before.revision),
    transition: () => local(next, changedPath, result) });
}

test('worker initializes metadata without historical bodies and keeps complete history on demand', async (t) => {
  const f = await fixture(t);
  await edit(f, 'first', facts('one'), 'A');
  await edit(f, 'second', facts('one', 'two'), 'B');
  const writer = createDurableWorldWriter(f);
  t.after(() => writer.close());
  const initialized = await writer.initialize();
  assert.deepEqual(initialized.initialSnapshot.facts.map((atom) => atom.situation), ['one', 'two', 'old']);
  assert.deepEqual(initialized.durableReceipts.map((entry) => entry.commandId), ['first', 'second']);
  for (const entry of initialized.durableReceipts) {
    assert.deepEqual(Object.keys(entry).sort(), ['commandId', 'historyMode', 'receipt']);
    assert.equal(entry.historyMode, 'local-patch');
  }
  const historical = await writer.findCommitted('first');
  assert.equal(historical.patch.operations[0].before.situation, 'old');
  assert.equal(historical.inversePatch.operations[0].after.situation, 'old');
  assert.equal(await writer.findCommitted('missing'), null);
  assert.deepEqual(await writer.initialize(), initialized, 'initialization is a stable startup result');
});

test('metadata-only restart preserves disjoint rebase and historical local rollback', async (t) => {
  const f = await fixture(t);
  const first = await edit(f, 'first', facts('one'), 'A');
  await edit(f, 'second', facts('one', 'two'), 'B');
  const writer = createDurableWorldWriter(f);
  t.after(() => writer.close());
  const seed = await writer.initialize();
  const records = [];
  const ports = createMemoryTransactionPorts({ ...seed,
    durableFindCommitted: (id) => writer.findCommitted(id),
    onAccepted: ({ record }) => records.push(record) });
  const coordinator = createCommitCoordinator(ports);
  const rebased = await coordinator.execute({ command: command('third', first.afterRevision),
    baseFacts: facts('one'), transition: () => local(facts('one', 'old', 'three'), 'C') });
  assert.deepEqual(ports.authority.snapshot().facts.map((atom) => atom.situation), ['one', 'two', 'three']);
  const rolledBack = await coordinator.rollback({ targetCommandId: 'first',
    command: command('undo-first', rebased.afterRevision) });
  assert.deepEqual(ports.authority.snapshot().facts.map((atom) => atom.situation), ['old', 'two', 'three']);
  await writer.save({ records, revision: rolledBack.afterRevision });
  await writer.save({ records, revision: rolledBack.afterRevision });
  assert.equal((await writer.findCommitted('undo-first')).receipt.rollbackOf, 'first');
  await writer.close();
  const restarted = createDurableWorldWriter(f);
  t.after(() => restarted.close());
  const restored = await restarted.initialize();
  assert.deepEqual(restored.initialSnapshot.facts.map((atom) => atom.situation), ['old', 'two', 'three']);
  assert.deepEqual(restored.durableReceipts.map((entry) => entry.commandId),
    ['first', 'second', 'third', 'undo-first']);
});

for (const mismatch of ['missing', 'command', 'receipt-command', 'before', 'after']) {
  test(`historical chain hydration rejects ${mismatch} evidence`, async (t) => {
    const f = await fixture(t);
    const first = await edit(f, 'first', facts('one'), 'A');
    await edit(f, 'second', facts('one', 'two'), 'B');
    const writer = createDurableWorldWriter(f);
    t.after(() => writer.close());
    const seed = await writer.initialize();
    const ports = createMemoryTransactionPorts({ ...seed, durableFindCommitted: async (id) => {
      const record = await writer.findCommitted(id);
      if (mismatch === 'missing') return null;
      if (mismatch === 'command') record.commandId = 'wrong';
      if (mismatch === 'receipt-command') record.receipt.commandId = 'wrong';
      if (mismatch === 'before') record.receipt.beforeRevision = first.beforeRevision;
      if (mismatch === 'after') record.receipt.afterRevision = first.afterRevision;
      return record;
    } });
    await assert.rejects(createCommitCoordinator(ports).execute({
      command: command('third', first.afterRevision), baseFacts: facts('one'),
      transition: () => local(facts('one', 'old', 'three'), 'C') }), { code: 'WORLD_REVISION_CONFLICT' });
    assert.deepEqual(ports.authority.snapshot().facts.map((atom) => atom.situation), ['one', 'two', 'old']);
  });
}

test('worker startup preserves pending, terminal, and child-derived Program outcomes', async (t) => {
  const f = await fixture(t);
  let next = facts();
  for (const id of ['pending-source', 'failed-source', 'completed-source', 'child-source']) {
    next = facts(id);
    await edit(f, id, next, 'A', { postCommitEvent: { binding: 'agent', interaction: { id } } });
    await f.coordinator.recordProgramExecution({ sourceCommandId: id,
      outcome: { status: id.split('-')[0] === 'child' ? 'pending' : id.split('-')[0], attemptId: id } });
  }
  await edit(f, 'child', facts('child'), 'A', { subsequentOf: 'child-source' });
  const writer = createDurableWorldWriter(f);
  t.after(() => writer.close());
  const seed = await writer.initialize();
  const ports = createMemoryTransactionPorts(seed);
  const outcomes = new Map(seed.durableOutcomes);
  assert.equal(outcomes.get('pending-source').status, 'pending');
  assert.equal(outcomes.get('failed-source').status, 'failed');
  assert.equal(outcomes.get('completed-source').status, 'completed');
  assert.equal(outcomes.get('child-source').status, 'completed');
  assert.equal(outcomes.get('child-source').childCommandId, 'child');
  assert.deepEqual((await ports.journalRepository.pendingProgramExecutions())
    .map((entry) => entry.sourceReceipt.commandId), ['pending-source']);
  await writer.save({ revision: seed.initialSnapshot.revision, events: [{ kind: 'outcome',
    sourceCommandId: 'pending-source', outcome: { status: 'completed', attemptId: 'finish' } }] });
  assert.ok((await writer.findCommitted('pending-source')).inversePatch,
    'writing an old source outcome preserves its reversible record');
  await writer.close();
  const restarted = createDurableWorldWriter(f);
  t.after(() => restarted.close());
  const restored = await restarted.initialize();
  assert.equal(new Map(restored.durableOutcomes).get('pending-source').status, 'completed');
  assert.ok((await restarted.findCommitted('pending-source')).inversePatch);
});

for (const stage of ['after-prepare', 'after-world-write']) {
  test(`worker initialization completes ${stage} recovery before exposing a snapshot`, async (t) => {
    const f = await fixture(t);
    const interrupted = createCommitCoordinator({ ...f, faultInjector: (point) => {
      if (point === stage) throw Object.assign(new Error('interrupted'), { code: 'INTERRUPTED' });
    } });
    await assert.rejects(interrupted.execute({ command: command('recover-me', revisionOfWorldFacts(facts())),
      transition: () => local(facts('recovered'), 'A') }), { code: 'INTERRUPTED' });
    const writer = createDurableWorldWriter(f);
    t.after(() => writer.close());
    const initialized = await writer.initialize();
    assert.equal(initialized.initialSnapshot.facts[0].situation, 'recovered');
    assert.deepEqual(initialized.durableReceipts.map((entry) => entry.commandId), ['recover-me']);
    await writer.save({ revision: initialized.initialSnapshot.revision });
    assert.equal((await writer.findCommitted('recover-me')).receipt.status, 'committed');
  });
}

test('memory persistence reads durable files exclusively through its worker', async (t) => {
  const f = await fixture(t);
  const first = await edit(f, 'historical', facts('one'), 'A');
  const originalRead = fs.readFile;
  t.mock.method(fs, 'readFile', async (target, ...args) => {
    if (String(target).startsWith(path.dirname(f.contextFile))) {
      throw Object.assign(new Error('main process must not load durable files'), { code: 'MAIN_DISK_READ' });
    }
    return originalRead.call(fs, target, ...args);
  });
  const persistence = createTransactionalWorldPersistence({ ...f, runtimeAuthority: 'memory',
    publishLegacyProjection: false, saveSchedule: { quietMs: 60000, maxDirtyMs: 60000 } });
  t.after(() => persistence.closeSaves());
  assert.equal((await persistence.readCommittedSnapshot()).facts[0].situation, 'one');
  await persistence.rollback({ targetCommandId: 'historical', correlationId: 'restore',
    expectedRevision: first.afterRevision });
  await persistence.commit({ correlationId: 'second-edit', expectedRevision: revisionOfWorldFacts(facts()),
    nextRevision: revisionOfWorldFacts(facts('two')), facts: facts('two') });
  await persistence.flushSaves();
  assert.equal((await persistence.readCommittedSnapshot()).facts[0].situation, 'two');
  assert.equal(persistence.saveStatus.pending, false);
});

test('failed initialization closes the writer and permits a fresh owner for the same world', async (t) => {
  const f = await fixture(t);
  let closed = false;
  const failed = createTransactionalWorldPersistence({ ...f, runtimeAuthority: 'memory',
    publishLegacyProjection: false, writerFactory: () => ({
      initialize: async () => { throw Object.assign(new Error('startup failed'), { code: 'INIT_FAILED' }); },
      findCommitted: async () => null, save: async () => assert.fail('must not save before startup'),
      close: async () => { closed = true; }
    }) });
  await assert.rejects(failed.readCommittedSnapshot(), { code: 'INIT_FAILED' });
  assert.equal(closed, true);
  const restarted = createTransactionalWorldPersistence({ ...f, runtimeAuthority: 'memory',
    publishLegacyProjection: false });
  t.after(() => restarted.closeSaves());
  assert.deepEqual((await restarted.readCommittedSnapshot()).facts, facts());
});

test('worker death rejects pending RPCs while accepted memory facts stay readable', async (t) => {
  const f = await fixture(t);
  const originalPost = Worker.prototype.postMessage;
  let stalledWorker;
  let saving;
  const enteredSave = new Promise((resolve) => { saving = resolve; });
  t.mock.method(Worker.prototype, 'postMessage', function (message, ...args) {
    if (message.operation === 'save') { stalledWorker = this; saving(); return; }
    if (message.operation === 'findCommitted' && stalledWorker) return;
    return originalPost.call(this, message, ...args);
  });
  let writer;
  const persistence = createTransactionalWorldPersistence({ ...f, runtimeAuthority: 'memory',
    publishLegacyProjection: false, saveSchedule: { quietMs: 60000, maxDirtyMs: 60000 },
    writerFactory: (configuration) => (writer = createDurableWorldWriter(configuration)) });
  t.after(() => persistence.closeSaves().catch(() => {}));
  const before = await persistence.readCommittedSnapshot();
  await persistence.commit({ correlationId: 'memory-after', expectedRevision: before.revision,
    nextRevision: revisionOfWorldFacts(facts('after')), facts: facts('after') });
  const flushing = persistence.flushSaves();
  await enteredSave;
  const historical = writer.findCommitted('anything');
  const failures = Promise.all([
    assert.rejects(flushing, { code: 'WORLD_SAVE_WORKER_EXITED' }),
    assert.rejects(historical, { code: 'WORLD_SAVE_WORKER_EXITED' })
  ]);
  await stalledWorker.terminate();
  await failures;
  assert.equal((await persistence.readCommittedSnapshot()).facts[0].situation, 'after');
  assert.equal(persistence.saveStatus.pending, true);
  assert.equal(persistence.saveStatus.failure.code, 'WORLD_SAVE_WORKER_EXITED');
});

test('worker death during initialization rejects startup and dependent history lookup', async (t) => {
  const f = await fixture(t);
  const originalPost = Worker.prototype.postMessage;
  let startupWorker;
  let posted;
  const initializePosted = new Promise((resolve) => { posted = resolve; });
  t.mock.method(Worker.prototype, 'postMessage', function (message, ...args) {
    if (message.operation === 'initialize') { startupWorker = this; posted(); return; }
    return originalPost.call(this, message, ...args);
  });
  const writer = createDurableWorldWriter(f);
  t.after(() => writer.close());
  const failures = Promise.all([
    assert.rejects(writer.initialize(), { code: 'WORLD_SAVE_WORKER_EXITED' }),
    assert.rejects(writer.findCommitted('historical'), { code: 'WORLD_SAVE_WORKER_EXITED' })
  ]);
  await initializePosted;
  await startupWorker.terminate();
  await failures;
});

test('corrupt startup closes the real worker before a repaired world can acquire a new owner', async (t) => {
  const f = await fixture(t);
  await fs.writeFile(f.contextFile, '{invalid');
  let writer;
  const failed = createTransactionalWorldPersistence({ ...f, runtimeAuthority: 'memory',
    publishLegacyProjection: false,
    writerFactory: (configuration) => (writer = createDurableWorldWriter(configuration)) });
  await assert.rejects(failed.readCommittedSnapshot(), { code: 'WORLD_READ_FAILED' });
  await assert.rejects(writer.save({ revision: 'unused' }), { code: 'WORLD_SAVE_WORKER_CLOSED' });
  await fs.writeFile(f.contextFile, JSON.stringify(facts('repaired')));
  const repaired = createTransactionalWorldPersistence({ ...f, runtimeAuthority: 'memory',
    publishLegacyProjection: false });
  t.after(() => repaired.closeSaves());
  assert.equal((await repaired.readCommittedSnapshot()).facts[0].situation, 'repaired');
});
