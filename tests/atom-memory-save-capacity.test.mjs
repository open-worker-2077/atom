import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createMemoryTransactionPorts } from '../src/atom-system/world-runtime/memory-transaction-ports.mjs';
import { createCommitCoordinator } from '../src/atom-system/world-runtime/commit-coordinator.mjs';
import { sealWorldFactsRevision } from '../src/atom-system/world-runtime/world-revision.mjs';
import { createTransactionalWorldPersistence } from '../src/atom-system/adapters/transactional-world-persistence.mjs';
import { createDurableWorldWriter } from '../src/atom-system/adapters/durable-world-writer.mjs';

process.env.ATOM_RUNTIME_BACKUP_REPO = '';
const facts = value => [{ thing: 'Root', situation: value, slot: [], strut: [] }];
function memory(pendingLimits, additional = {}) {
  const initial = facts('old');
  const events = [];
  const ports = createMemoryTransactionPorts({ initialSnapshot: { worldId: 'primary', facts: initial,
    revision: sealWorldFactsRevision(initial) }, pendingLimits,
    onAccepted: event => events.push(event), onOutcome: event => events.push(event), ...additional });
  const coordinator = createCommitCoordinator(ports);
  const edit = (id, value, result = {}) => coordinator.execute({ command: { contract: 'atom.world-command',
    version: 1, name: 'test', commandId: id, correlationId: id, expectedRevision: ports.authority.snapshot().revision, payload: {} },
    transition: () => ({ facts: facts(value), changedPaths: ['Root'], result: { affectedPathClosureComplete: true, ...result } }) });
  return { ports, coordinator, events, edit };
}

test('pending event count rejects before publication while accepted facts and reads remain available', async () => {
  const f = memory({ maxBytes: 1_000_000, maxEvents: 1, maxEventBytes: 100_000 });
  const first = await f.edit('one', 'accepted');
  await assert.rejects(f.edit('two', 'rejected'), { code: 'WORLD_SAVE_BACKPRESSURE' });
  assert.equal(f.ports.authority.status().acceptedVersion, 1);
  assert.equal((await f.ports.worldRepository.read()).facts[0].situation, 'accepted');
  assert.equal((await f.ports.journalRepository.latestReceipt()).commandId, 'one');
  assert.deepEqual(await f.ports.journalRepository.listPrepared(), []);
  assert.equal(f.events.length, 1);
  assert.equal(first.afterRevision, f.ports.authority.snapshot().revision);
});

test('pending byte budget and single-event limit reject independently of event count', async () => {
  const f = memory({ maxBytes: 3500, maxEvents: 20, maxEventBytes: 10_000 });
  await f.edit('one', 'x'.repeat(700));
  await assert.rejects(f.edit('two', 'y'.repeat(700)), { code: 'WORLD_SAVE_BACKPRESSURE' });
  const g = memory({ maxBytes: 1_000_000, maxEvents: 20, maxEventBytes: 1500 });
  await assert.rejects(g.edit('too-large', 'z'.repeat(2000)), { code: 'WORLD_SAVE_EVENT_TOO_LARGE' });
  assert.equal(g.ports.authority.status().acceptedVersion, 0);
  assert.deepEqual(await g.ports.journalRepository.listPrepared(), []);
});

test('source admission reserves its first pending and final outcome before accepting the source', async () => {
  const f = memory({ maxBytes: 20_000, maxEvents: 20, maxEventBytes: 10_000 });
  await assert.rejects(f.edit('source', 'source', { postCommitEvent: { binding: 'p', interaction: { id: 'source' } } }),
    { code: 'WORLD_SAVE_BACKPRESSURE' });
  assert.equal(f.ports.authority.status().acceptedVersion, 0);
  assert.deepEqual(await f.ports.journalRepository.pendingProgramExecutions(), []);
});

test('only exact saved event tokens release capacity across old acknowledgment and A to B to A', async () => {
  const f = memory({ maxBytes: 100_000, maxEvents: 2, maxEventBytes: 10_000 });
  const first = await f.edit('to-B', 'B');
  const second = await f.edit('to-A', 'old');
  assert.equal(f.ports.pendingStatus().events, 2);
  assert.throws(() => f.ports.markSaved({ version: 1, revision: second.afterRevision }, [f.events[0].reservation]),
    { code: 'UNKNOWN_SAVED_REVISION' });
  assert.equal(f.ports.pendingStatus().events, 2);
  f.ports.markSaved({ version: 1, revision: first.afterRevision }, [f.events[0].reservation]);
  assert.equal(f.ports.pendingStatus().events, 1);
  await f.edit('newer', 'newer');
  f.ports.markSaved({ version: 1, revision: first.afterRevision }, [f.events[0].reservation]);
  assert.equal(f.ports.pendingStatus().events, 2);
  await assert.rejects(f.edit('full', 'no'), { code: 'WORLD_SAVE_BACKPRESSURE' });
});

test('saved source keeps final reservation and can finalize while ordinary event admission is full', async () => {
  const f = memory({ maxBytes: 100_000, maxEvents: 4, maxEventBytes: 10_000 });
  const source = await f.edit('source', 'source', { postCommitEvent: { binding: 'p', interaction: { id: 'source' } } });
  const outcome = value => f.coordinator.recordProgramExecution({ sourceCommandId: 'source', outcome: value });
  await outcome({ status: 'pending', attemptId: 'first' });
  assert.equal(f.ports.pendingStatus().reservedEvents, 1);
  f.ports.markSaved({ version: 1, revision: source.afterRevision }, f.events.map(event => event.reservation));
  assert.equal(f.ports.pendingStatus().events, 1);
  await f.edit('ordinary-1', 'one');
  await f.edit('ordinary-2', 'two');
  await f.edit('ordinary-3', 'three');
  await assert.rejects(outcome({ status: 'pending', attemptId: 'repeated' }), { code: 'WORLD_SAVE_BACKPRESSURE' });
  const completed = await outcome({ status: 'completed', attemptId: 'final', result: { ok: true } });
  assert.equal(completed.status, 'completed');
  assert.equal(f.ports.pendingStatus().events, 4);
  assert.equal(f.ports.pendingStatus().reservedEvents, 0);
});

test('oversized outcome becomes a counted hard pending reason even after child commit, without retaining its body', async () => {
  const f = memory({ maxBytes: 100_000, maxEvents: 8, maxEventBytes: 10_000 });
  await f.edit('source', 'source', { postCommitEvent: { binding: 'p', interaction: { id: 'source' } } });
  await f.edit('child', 'child', { subsequentOf: 'source' });
  const outcome = await f.coordinator.recordProgramExecution({ sourceCommandId: 'source', outcome: {
    status: 'completed', attemptId: 'big', result: { messages: ['x'.repeat(20_000)] }
  } });
  assert.equal(outcome.status, 'pending');
  assert.equal(outcome.capacityBlocked.code, 'WORLD_SAVE_EVENT_TOO_LARGE');
  assert.equal(outcome.result, undefined);
  const execution = await f.ports.journalRepository.programExecution('source');
  assert.equal(execution.outcome.status, 'pending');
  assert.equal(execution.childReceipt.commandId, 'child');
  assert.ok(f.ports.pendingStatus().bytes < 10_000);
  assert.equal(f.events.at(-1).outcome.result, undefined);
});

async function diskFixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-save-capacity-'));
  t.diagnostic(`Retained synthetic fixture: ${directory}`);
  const contextFile = path.join(directory, 'atom.json'), journalFile = path.join(directory, 'transactions.json');
  await fs.writeFile(contextFile, JSON.stringify(facts('old')));
  return { contextFile, journalFile, worldId: 'primary' };
}

test('hard pending survives real save and restart instead of child-derived completion', async (t) => {
  const configuration = await diskFixture(t);
  const f = memory({ maxBytes: 100_000, maxEvents: 8, maxEventBytes: 10_000 });
  await f.edit('source', 'source', { postCommitEvent: { binding: 'p', interaction: { id: 'source' } } });
  const child = await f.edit('child', 'child', { subsequentOf: 'source' });
  await f.coordinator.recordProgramExecution({ sourceCommandId: 'source', outcome: {
    status: 'completed', attemptId: 'big', result: { messages: ['x'.repeat(20_000)] }
  } });
  const writer = createDurableWorldWriter(configuration);
  t.after(() => writer.close());
  await writer.save({ events: f.events.map(event => event.record ? { kind: 'record', record: event.record }
    : { kind: 'outcome', sourceCommandId: event.sourceCommandId, outcome: event.outcome }), revision: child.afterRevision });
  await writer.close();
  const reopened = createDurableWorldWriter(configuration);
  t.after(() => reopened.close());
  const recovered = await reopened.initialize();
  const outcome = new Map(recovered.durableOutcomes).get('source');
  assert.equal(outcome.status, 'pending');
  assert.equal(outcome.capacityBlocked.code, 'WORLD_SAVE_EVENT_TOO_LARGE');
  assert.equal(outcome.result, undefined);
  assert.equal((await reopened.findCommitted('child')).receipt.commandId, 'child');
});

test('owner retains capacity through failed and wrong saves, releasing only a verified prefix', async (t) => {
  const configuration = await diskFixture(t);
  let mode = 'failed', savedEvents;
  const initial = facts('old');
  const persistence = createTransactionalWorldPersistence({ ...configuration, runtimeAuthority: 'memory',
    publishLegacyProjection: false, pendingLimits: { maxBytes: 100_000, maxEvents: 1, maxEventBytes: 10_000 },
    saveSchedule: { quietMs: 60000, maxDirtyMs: 60000, retryMs: 60000 },
    writerFactory: () => ({ initialize: async () => ({ initialSnapshot: { worldId: 'primary', facts: initial,
      revision: sealWorldFactsRevision(initial) }, durableReceipts: [], durableOutcomes: [] }), close: async () => {},
    save: async batch => {
      savedEvents = batch.events;
      if (mode === 'failed') throw Object.assign(new Error('held disk failure'), { code: 'ENOSPC' });
      return { revision: mode === 'wrong' ? 'wrong' : batch.revision };
    } }) });
  t.after(async () => { mode = 'ok'; await persistence.closeSaves(); });
  const edit = async (id, value) => {
    const before = await persistence.readCommittedSnapshot();
    return persistence.commit({ correlationId: id, expectedRevision: before.revision,
      facts: facts(value), nextRevision: sealWorldFactsRevision(facts(value)), changedPaths: ['Root'],
      affectedPathClosureComplete: true });
  };
  await edit('one', 'accepted');
  await assert.rejects(edit('two', 'reject'), { code: 'WORLD_SAVE_BACKPRESSURE' });
  await assert.rejects(persistence.flushSaves(), { code: 'ENOSPC' });
  assert.equal(persistence.saveStatus.capacity.events, 1);
  mode = 'wrong';
  await assert.rejects(persistence.flushSaves(), { code: 'WORLD_SAVE_REVISION_MISMATCH' });
  assert.equal(persistence.saveStatus.capacity.events, 1);
  mode = 'ok';
  await persistence.flushSaves();
  assert.equal(persistence.saveStatus.capacity.events, 0);
  assert.equal(savedEvents.length, 1);
  await edit('three', 'allowed');
  assert.equal(persistence.saveStatus.capacity.events, 1);
});

test('parallel source prepares reserve atomically and abort or close releases only unaccepted evidence', async () => {
  const f = memory({ maxBytes: 25_000, maxEvents: 8, maxEventBytes: 10_000 });
  const record = id => ({ commandId: id, before: { facts: facts('old') }, after: { facts: facts('next') },
    receipt: { result: { postCommitEvent: { interaction: { id } } } } });
  const results = await Promise.allSettled(['a', 'b'].map(id => f.ports.journalRepository.prepare(record(id))));
  assert.deepEqual(results.map(result => result.status), ['fulfilled', 'rejected']);
  assert.equal(results[1].reason.code, 'WORLD_SAVE_BACKPRESSURE');
  assert.equal(f.ports.pendingStatus().events, 3);
  await f.ports.journalRepository.abort('a');
  assert.equal(f.ports.pendingStatus().events, 0);
  await f.ports.journalRepository.prepare(record('c'));
  f.ports.beginClose();
  assert.equal(f.ports.pendingStatus().events, 0);
  assert.deepEqual((await f.ports.worldRepository.read()).facts, facts('old'));
  await assert.rejects(f.ports.journalRepository.prepare(record('late')), { code: 'WORLD_SAVE_WORKER_CLOSED' });
});

test('full-record accounting reuses sealed serialization and local accounting never serializes the whole world', async t => {
  const f = memory({ maxBytes: 100_000, maxEvents: 8, maxEventBytes: 20_000 });
  const beforeFacts = facts('é'.repeat(1000)), afterFacts = facts('漢'.repeat(1000));
  sealWorldFactsRevision(beforeFacts); sealWorldFactsRevision(afterFacts);
  const record = { commandId: 'full', before: { facts: beforeFacts }, after: { facts: afterFacts }, receipt: {} };
  const expectedBytes = Buffer.byteLength(JSON.stringify({ kind: 'record', record }), 'utf8');
  const stringify = JSON.stringify;
  t.mock.method(JSON, 'stringify', (value, ...args) => {
    assert.notEqual(value, beforeFacts, 'already sealed before facts must not be reserialized');
    assert.notEqual(value, afterFacts, 'already sealed after facts must not be reserialized');
    return stringify(value, ...args);
  });
  await f.ports.journalRepository.prepare(record);
  assert.equal(f.ports.pendingStatus().bytes, expectedBytes);
  await f.ports.journalRepository.abort('full');
  const local = { historyMode: 'local-patch', commandId: 'local', patch: { operations: [] }, inversePatch: {}, receipt: {} };
  await f.ports.journalRepository.prepare(local);
  assert.equal(f.ports.pendingStatus().bytes, Buffer.byteLength(stringify({ kind: 'record', record: local }), 'utf8'));
});

test('historical pending reserves incrementally without charging all recovered sources at startup', async () => {
  const durableReceipts = ['old-a', 'old-b'].map(commandId => ({ commandId, receipt: { commandId,
    correlationId: commandId, result: { postCommitEvent: { interaction: { id: commandId } } } } }));
  const f = memory({ maxBytes: 25_000, maxEvents: 5, maxEventBytes: 10_000 }, { durableReceipts });
  assert.equal(f.ports.pendingStatus().events, 0);
  f.ports.reserveProgramExecution('old-a');
  assert.throws(() => f.ports.reserveProgramExecution('old-b'), { code: 'WORLD_SAVE_BACKPRESSURE' });
  assert.equal((await f.ports.journalRepository.pendingProgramExecutions()).length, 2);
  await f.coordinator.recordProgramExecution({ sourceCommandId: 'old-a', outcome: { status: 'completed', attemptId: 'done' } });
  f.ports.markSaved({ version: 0, revision: f.ports.authority.snapshot().revision }, f.events.map(event => event.reservation));
  f.ports.reserveProgramExecution('old-b');
  assert.equal(f.ports.pendingStatus().reservedEvents, 2);
});

test('close cancels unused future outcome reservations without discarding accepted source evidence', async () => {
  const f = memory({ maxBytes: 100_000, maxEvents: 8, maxEventBytes: 10_000 });
  await f.edit('source', 'source', { postCommitEvent: { binding: 'p', interaction: { id: 'source' } } });
  f.ports.beginClose();
  assert.equal(f.ports.pendingStatus().events, 1);
  assert.equal(f.ports.pendingStatus().reservedEvents, 0);
  assert.equal((await f.ports.journalRepository.findReceipt('source')).commandId, 'source');
  assert.equal(f.ports.authority.snapshot().facts[0].situation, 'source');
});
