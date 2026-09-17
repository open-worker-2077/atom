import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createMemoryTransactionPorts } from '../src/atom-system/world-runtime/memory-transaction-ports.mjs';
import { createCommitCoordinator } from '../src/atom-system/world-runtime/commit-coordinator.mjs';
import { revisionOfWorldFacts, sealWorldFactsRevision } from '../src/atom-system/world-runtime/world-revision.mjs';
import { createTransactionalWorldPersistence } from '../src/atom-system/adapters/transactional-world-persistence.mjs';
import { createDurableWorldWriter } from '../src/atom-system/adapters/durable-world-writer.mjs';

process.env.ATOM_RUNTIME_BACKUP_REPO = '';
const facts = (a = 'old', b = 'old', c = 'old') => ['A', 'B', 'C'].map((thing, i) => ({
  thing, situation: [a, b, c][i], slot: [], strut: []
}));
const command = (id, expectedRevision) => ({ contract: 'atom.world-command', version: 1,
  commandId: id, correlationId: id, name: 'test', expectedRevision, payload: {} });
const metadataKeys = ['commandId', 'historyMode', 'receipt'];
function memory() {
  const initialFacts = facts();
  const records = new Map();
  const hydrated = [];
  const ports = createMemoryTransactionPorts({ initialSnapshot: { contract: 'atom.world-snapshot',
    version: 1, worldId: 'primary', facts: initialFacts, revision: sealWorldFactsRevision(initialFacts) },
    onAccepted: ({ record }) => records.set(record.commandId, record),
    durableFindCommitted: async (id) => { hydrated.push(id); return records.get(id); } });
  const coordinator = createCommitCoordinator(ports);
  const edit = (id, next, changedPath, result = {}) => coordinator.execute({
    command: command(id, ports.authority.snapshot().revision),
    transition: () => ({ facts: next, ...(changedPath ? { changedPaths: [changedPath] } : {}),
      result: { affectedPathClosureComplete: true, ...result } }) });
  return { ports, coordinator, records, hydrated, edit,
    markSaved: (watermark) => (ports.markSaved ?? ports.authority.markSaved)(watermark) };
}

test('verified saved prefix releases bodies without changing later accepted records or in-flight readers', async () => {
  const f = memory();
  await f.edit('first', facts('one'), 'A');
  const second = await f.edit('second', facts('one', 'two'), 'B');
  await f.edit('unsaved-full', facts('one', 'two', 'three'));
  const heldReader = f.records.get('first');
  const current = f.ports.authority.snapshot();
  f.markSaved({ version: 2, revision: second.afterRevision });
  const state = await f.ports.journalRepository.readState();
  assert.deepEqual(state.receipts.map(({ commandId }) => commandId), ['first', 'second', 'unsaved-full']);
  for (const entry of state.receipts.slice(0, 2)) assert.deepEqual(Object.keys(entry).sort(), metadataKeys);
  assert.ok(state.receipts[2].before.facts);
  assert.ok(state.receipts[2].after.facts);
  assert.equal(f.ports.authority.snapshot(), current);
  assert.equal(heldReader.patch.operations[0].before.situation, 'old');
  assert.equal(Object.isFrozen(heldReader.patch), true);
  assert.equal((await f.ports.journalRepository.findCommitted('first')).patch.operations[0].after.situation, 'one');
  await f.ports.journalRepository.findCommitted('unsaved-full');
  assert.deepEqual(f.hydrated, ['first'], 'saved body hydrates; unsaved body remains local');
  assert.equal((await f.ports.journalRepository.latestReceipt()).commandId, 'unsaved-full');
  assert.equal((await f.coordinator.execute({ command: command('first', current.revision),
    transition: () => assert.fail('idempotency must not replay a demoted command') })).commandId, 'first');
  assert.ok(await f.ports.worldRepository.durableCommitEvidence({ commandId: 'first',
    beforeRevision: heldReader.receipt.beforeRevision, afterRevision: heldReader.receipt.afterRevision }));
});

test('saved-body demotion uses version order when facts cycle A to B to A', async () => {
  const f = memory();
  const first = await f.edit('to-B', facts('B'));
  const second = await f.edit('to-A', facts());
  await assert.rejects(async () => f.markSaved({ version: 1, revision: second.afterRevision }),
    { code: 'UNKNOWN_SAVED_REVISION' });
  assert.ok((await f.ports.journalRepository.readState()).receipts.every(({ after }) => after?.facts));
  f.markSaved({ version: 1, revision: first.afterRevision });
  let state = await f.ports.journalRepository.readState();
  assert.deepEqual(Object.keys(state.receipts[0]).sort(), metadataKeys);
  assert.ok(state.receipts[1].after.facts);
  f.markSaved({ version: 2, revision: second.afterRevision });
  f.markSaved({ version: 1, revision: first.afterRevision });
  state = await f.ports.journalRepository.readState();
  assert.equal(state.receipts.length, 2);
  for (const entry of state.receipts) assert.deepEqual(Object.keys(entry).sort(), metadataKeys);
  assert.deepEqual(f.ports.authority.snapshot().facts, facts());
  assert.equal(f.ports.authority.status().savedVersion, 2);
  assert.equal((await f.ports.journalRepository.latestReceipt()).commandId, 'to-A');
  assert.deepEqual((await f.ports.journalRepository.findCommitted('to-A')).before.facts, facts('B'));
  await f.coordinator.rollback({ targetCommandId: 'to-A', command: command('undo-full', second.afterRevision) });
  assert.deepEqual(f.ports.authority.snapshot().facts, facts('B'), 'saved full-record rollback hydrates its complete snapshot');
});

test('metadata demotion preserves pending, child-derived and terminal Program lookups', async () => {
  const f = memory();
  const source = await f.edit('source', facts('source'), 'A', {
    postCommitEvent: { binding: 'program', interaction: { id: 'source' } },
    transformLogRecord: { id: 'source-log' }
  });
  await f.coordinator.recordProgramExecution({ sourceCommandId: source.commandId,
    outcome: { status: 'pending', attemptId: 'attempt' } });
  f.markSaved({ version: 1, revision: source.afterRevision });
  assert.equal((await f.ports.journalRepository.programExecutionForInteraction('source')).outcome.status, 'pending');
  assert.deepEqual((await f.ports.journalRepository.pendingProgramExecutions()).map(({ sourceReceipt }) => sourceReceipt.commandId), ['source']);
  const child = await f.edit('child', facts('source', 'child'), 'B', { subsequentOf: 'source' });
  await f.coordinator.recordProgramExecution({ sourceCommandId: 'source',
    outcome: { status: 'completed', attemptId: 'attempt', result: { ok: true } } });
  f.markSaved({ version: 2, revision: child.afterRevision });
  const execution = await f.ports.journalRepository.programExecution('source');
  assert.equal(execution.childReceipt.commandId, 'child');
  assert.equal(execution.outcome.status, 'completed');
  assert.deepEqual(execution.outcome.result, { ok: true });
  assert.deepEqual(await f.ports.journalRepository.pendingProgramExecutions(), []);
  assert.deepEqual(await f.ports.journalRepository.transformLogRecords(), [{ id: 'source-log' }]);
  assert.deepEqual(f.hydrated, [], 'metadata-only Program and log queries do not hydrate bodies');
});

async function fixture(t, { firstSaveFailure = null } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-memory-history-retention-'));
  t.diagnostic(`Retained synthetic fixture: ${directory}`);
  const contextFile = path.join(directory, 'atom.json');
  const journalFile = path.join(directory, 'transactions.json');
  await fs.writeFile(contextFile, JSON.stringify(facts()));
  const hydrated = [];
  let first = true;
  const persistence = createTransactionalWorldPersistence({ contextFile, journalFile,
    runtimeAuthority: 'memory', publishLegacyProjection: false,
    saveSchedule: { quietMs: 60000, maxDirtyMs: 60000, retryMs: 60000 },
    writerFactory: (configuration) => {
      const writer = createDurableWorldWriter(configuration);
      return { get lifecycle() { return writer.lifecycle; }, initialize: () => writer.initialize(),
        close: () => writer.close(),
        findCommitted(id) { hydrated.push(id); return writer.findCommitted(id); },
        async save(batch) {
          if (first && firstSaveFailure) {
            first = false;
            if (firstSaveFailure === 'wrong') return { revision: 'wrong' };
            throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
          }
          return writer.save(batch);
        } };
    } });
  t.after(() => persistence.closeSaves().catch(() => {}));
  async function edit(id, next, changedPath, base = null) {
    const before = base ?? await persistence.readCommittedSnapshot();
    return persistence.commit({ correlationId: id, expectedRevision: before.revision,
      nextRevision: revisionOfWorldFacts(next), facts: next, beforeFacts: before.facts,
      changedPaths: [changedPath], affectedPathClosureComplete: true,
      relationEndpoints: [], lockPaths: [], shortcutPaths: [], referencePaths: [] });
  }
  return { contextFile, journalFile, persistence, hydrated, edit };
}

test('saved live history hydrates for disjoint rebase and rollback through the durable lane', async (t) => {
  const f = await fixture(t);
  const first = await f.edit('first', facts('one'), 'A');
  const base = await f.persistence.readCommittedSnapshot();
  const second = await f.edit('second', facts('one', 'two'), 'B');
  await f.persistence.flushSaves();
  const third = await f.edit('late-third', facts('one', 'old', 'three'), 'C', base);
  assert.ok(f.hydrated.includes(second.commandId), 'demoted intervening patch must hydrate during rebase');
  assert.deepEqual((await f.persistence.readCommittedSnapshot()).facts, facts('one', 'two', 'three'));
  const undone = await f.persistence.rollback({ targetCommandId: first.commandId,
    correlationId: 'undo-first', expectedRevision: third.afterRevision });
  assert.ok(f.hydrated.includes(first.commandId), 'saved target must hydrate during rollback');
  assert.deepEqual((await f.persistence.readCommittedSnapshot()).facts, facts('old', 'two', 'three'));
  await f.persistence.flushSaves();
  await f.persistence.closeSaves();
  const restarted = createDurableWorldWriter(f);
  t.after(() => restarted.close());
  const seed = await restarted.initialize();
  assert.equal(seed.initialSnapshot.revision, undone.afterRevision);
  assert.equal(seed.durableReceipts.length, 4);
});

for (const firstSaveFailure of ['wrong', 'ENOSPC']) {
  test(`${firstSaveFailure} save retains unsaved rollback evidence until verified retry`, async (t) => {
    const f = await fixture(t, { firstSaveFailure });
    const first = await f.edit('first', facts('one'), 'A');
    await assert.rejects(f.persistence.flushSaves(), {
      code: firstSaveFailure === 'wrong' ? 'WORLD_SAVE_REVISION_MISMATCH' : firstSaveFailure
    });
    const undone = await f.persistence.rollback({ targetCommandId: first.commandId,
      correlationId: 'undo', expectedRevision: first.afterRevision });
    assert.deepEqual(f.hydrated, [], 'failed save must leave complete rollback evidence in memory');
    await f.persistence.flushSaves();
    await assert.rejects(f.persistence.rollback({ targetCommandId: first.commandId,
      correlationId: 'undo-again', expectedRevision: undone.afterRevision }));
    assert.ok(f.hydrated.includes(first.commandId), 'only verified retry releases the historical body');
    assert.deepEqual((await f.persistence.readCommittedSnapshot()).facts, facts());
  });
}
