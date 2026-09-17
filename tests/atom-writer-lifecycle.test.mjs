import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Worker } from 'node:worker_threads';
import { createDurableWorldWriter } from '../src/atom-system/adapters/durable-world-writer.mjs';
import { createTransactionalWorldPersistence } from '../src/atom-system/adapters/transactional-world-persistence.mjs';
import { revisionOfWorldFacts } from '../src/atom-system/world-runtime/world-revision.mjs';

process.env.ATOM_RUNTIME_BACKUP_REPO = '';
const failure = (code) => Object.assign(new Error(code), { code });
const facts = (a = 'zero', b = 'zero') => ['A', 'B'].map((thing, i) => ({
  thing, situation: [a, b][i], slot: [], strut: []
}));
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function fixture(t, hooks = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-writer-lifecycle-'));
  t.diagnostic(`Retained synthetic fixture: ${directory}`);
  const contextFile = path.join(directory, 'atom.json');
  const journalFile = path.join(directory, 'transactions.json');
  await fs.writeFile(contextFile, JSON.stringify(facts()));
  const writers = [];
  const order = [];
  const configuration = { contextFile, journalFile };
  const writerFactory = (options) => {
    const number = writers.length + 1;
    assert.ok(writers.every((writer) => writer.closed), 'old writer closes before replacement is created');
    const raw = createDurableWorldWriter(options);
    let dead = null;
    const control = { number, raw, closed: false, initializations: 0, batches: [], histories: [],
      async kill() { dead = failure('WORLD_SAVE_WORKER_EXITED'); await raw.close(); } };
    writers.push(control);
    order.push(`create:${number}`);
    return {
      get lifecycle() { return { closed: control.closed, terminalFailure: dead ?? raw.lifecycle?.terminalFailure ?? null }; },
      async initialize() {
        control.initializations += 1;
        await hooks.beforeInitialize?.(control);
        if (dead) throw dead;
        return raw.initialize();
      },
      async save(batch) {
        if (dead) throw dead;
        control.batches.push(structuredClone(batch));
        order.push(`save:${number}`);
        const override = await hooks.beforeSave?.(control, batch);
        if (override) return override;
        const result = await raw.save(batch);
        await hooks.afterSave?.(control, batch);
        return result;
      },
      async findCommitted(id) {
        if (dead) throw dead;
        control.histories.push(id);
        order.push(`history:${number}`);
        return raw.findCommitted(id);
      },
      async close() {
        await raw.close();
        if (!control.closed) order.push(`close:${number}`);
        control.closed = true;
      }
    };
  };
  const createPersistence = () => createTransactionalWorldPersistence({ ...configuration,
    runtimeAuthority: 'memory', publishLegacyProjection: false, writerFactory,
    onSaved: hooks.onSaved,
    saveSchedule: { quietMs: 60000, maxDirtyMs: 60000, retryMs: 60000, ...hooks.saveSchedule } });
  const persistence = createPersistence();
  t.after(async () => {
    await persistence.closeSaves().catch(() => {});
    for (const writer of writers) await writer.raw.close();
  });
  async function commit(id, next, extra = {}, target = persistence) {
    const current = await target.readCommittedSnapshot();
    return target.commit({ correlationId: id, expectedRevision: current.revision,
      nextRevision: revisionOfWorldFacts(next), facts: next, ...extra });
  }
  return { ...configuration, directory, persistence, writers, order, commit, createPersistence };
}

test('dead writer is replaced without reseeding newer accepted memory during recovery', async (t) => {
  const entered = deferred();
  const release = deferred();
  t.after(() => release.resolve());
  const f = await fixture(t, { beforeInitialize: async ({ number }) => {
    if (number === 2) { entered.resolve(); await release.promise; }
  } });
  await f.commit('one', facts('one'));
  await f.writers[0].kill();
  assert.equal((await f.persistence.readCommittedSnapshot()).facts[0].situation, 'one');
  const flushing = f.persistence.flushSaves();
  // Before replacement support the save rejects immediately; include that
  // result in the race so RED fails promptly instead of hanging on the gate.
  await Promise.race([entered.promise, flushing]);
  const newer = await f.commit('two', facts('two'));
  assert.equal(f.persistence.saveStatus.acceptedRevision, newer.afterRevision);
  release.resolve();
  await flushing;
  assert.equal(f.writers.length, 2);
  assert.equal(f.writers[1].initializations, 1);
  assert.deepEqual(f.writers[1].batches.map(({ events }) => events.map(({ record }) => record.correlationId)),
    [['one'], ['two']]);
  assert.equal((await f.persistence.readCommittedSnapshot()).facts[0].situation, 'two');
  assert.equal(f.persistence.saveStatus.pending, false);
  await f.persistence.closeSaves();
  const restarted = createDurableWorldWriter(f);
  t.after(() => restarted.close());
  assert.equal((await restarted.initialize()).initialSnapshot.revision, newer.afterRevision);
});

test('lost acknowledgment replays source, child and outcome without duplicating durable history', async (t) => {
  let lost = false;
  const f = await fixture(t, { afterSave: async (writer) => {
    if (!lost) { lost = true; await writer.kill(); throw failure('WORLD_SAVE_WORKER_EXITED'); }
  } });
  const source = await f.commit('source', facts('source'), {
    postCommitEvent: { binding: 'test-program', interaction: { id: 'source' } }
  });
  await f.persistence.recordProgramExecution({ sourceCommandId: source.commandId,
    outcome: { status: 'pending', attemptId: 'attempt' } });
  const child = await f.commit('child', facts('child'), { subsequentOf: source.commandId });
  await f.persistence.recordProgramExecution({ sourceCommandId: source.commandId,
    outcome: { status: 'completed', attemptId: 'attempt', revisionAfter: child.afterRevision } });
  await assert.rejects(f.persistence.flushSaves(), { code: 'WORLD_SAVE_WORKER_EXITED' });
  assert.equal(f.persistence.saveStatus.dirty, true);
  const eventFile = path.join(`${f.journalFile}.d`, 'events.jsonl');
  const beforeReplay = await fs.readFile(eventFile, 'utf8');
  await f.persistence.flushSaves();
  assert.equal(await fs.readFile(eventFile, 'utf8'), beforeReplay,
    'retry must not append duplicate receipts or Program outcomes');
  assert.equal(f.writers.length, 2);
  assert.equal(f.persistence.saveStatus.dirty, false);
  await f.persistence.closeSaves();
  const restarted = createDurableWorldWriter(f);
  t.after(() => restarted.close());
  const seed = await restarted.initialize();
  assert.equal(seed.initialSnapshot.revision, child.afterRevision);
  assert.deepEqual(seed.durableReceipts.map(({ commandId }) => commandId), [source.commandId, child.commandId]);
  assert.equal(new Map(seed.durableOutcomes).get(source.commandId).status, 'completed');
});

test('wrong save watermark retains every event until a verified retry', async (t) => {
  let wrong = true;
  const f = await fixture(t, { beforeSave: () => {
    if (wrong) { wrong = false; return { revision: 'wrong-watermark' }; }
  } });
  const receipt = await f.commit('must-retry', facts('accepted'));
  await assert.rejects(f.persistence.flushSaves(), { code: 'WORLD_SAVE_REVISION_MISMATCH' });
  assert.equal(f.persistence.saveStatus.dirty, true);
  await f.persistence.flushSaves();
  assert.deepEqual(f.writers[0].batches.map(({ events }) => events.length), [1, 1]);
  assert.equal(f.persistence.saveStatus.savedRevision, receipt.afterRevision);
  assert.equal(f.writers.length, 1, 'bad RPC acknowledgment does not imply process death');
});

test('ordinary save errors retry on the same writer', async (t) => {
  let full = true;
  const f = await fixture(t, { beforeSave: () => {
    if (full) { full = false; throw failure('ENOSPC'); }
  } });
  await f.commit('retry', facts('retry'));
  await assert.rejects(f.persistence.flushSaves(), { code: 'ENOSPC' });
  await f.persistence.flushSaves();
  assert.equal(f.writers.length, 1);
  assert.equal(f.persistence.saveStatus.failure, null);
});

test('corrupt replacement initialization stays failed without repeatedly creating workers', async (t) => {
  const f = await fixture(t, { beforeInitialize: ({ number }) => {
    if (number === 2) throw failure('WORLD_READ_FAILED');
  } });
  await f.commit('memory-survives', facts('accepted'));
  await f.writers[0].kill();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await assert.rejects(f.persistence.flushSaves(), { code: 'WORLD_READ_FAILED' });
  }
  assert.equal(f.writers.length, 2);
  assert.equal(f.writers[1].initializations, 1);
  assert.equal((await f.persistence.readCommittedSnapshot()).facts[0].situation, 'accepted');
  assert.equal(f.persistence.saveStatus.pending, true);
});

test('historical rollback after death shares the replacement lane with saving', async (t) => {
  const entered = deferred();
  const release = deferred();
  t.after(() => release.resolve());
  let hold = false;
  const f = await fixture(t, { beforeSave: async () => {
    if (hold) { hold = false; entered.resolve(); await release.promise; }
  } });
  const historical = await f.commit('historical', facts('one'), {
    changedPaths: ['A'], affectedPathClosureComplete: true
  });
  await f.persistence.closeSaves();
  const active = f.createPersistence();
  t.after(() => active.closeSaves().catch(() => {}));
  await active.readCommittedSnapshot();
  await f.writers[1].kill();
  const undo = await active.rollback({ targetCommandId: historical.commandId,
    correlationId: 'undo-historical', expectedRevision: historical.afterRevision });
  assert.deepEqual((await active.readCommittedSnapshot()).facts, facts());
  assert.equal(f.writers.length, 3);
  assert.ok(f.writers[2].histories.includes(historical.commandId));
  hold = true;
  const flushing = active.flushSaves();
  await entered.promise;
  const secondUndo = active.rollback({ targetCommandId: historical.commandId,
    correlationId: 'invalid-second-undo', expectedRevision: undo.afterRevision });
  const rejected = assert.rejects(secondUndo);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.writers[2].histories.length, 1, 'history lookup must not overtake the in-flight save');
  release.resolve();
  await flushing;
  await rejected;
  assert.ok(f.writers[2].histories.length > 1);
  assert.equal(f.writers.length, 3);
});

test('closing a dead owner does not replace its worker or permit later save retries', async (t) => {
  const f = await fixture(t);
  await f.commit('pending-close', facts('accepted'));
  await f.writers[0].kill();
  await assert.rejects(f.persistence.closeSaves());
  await assert.rejects(f.persistence.flushSaves(), { code: 'WORLD_SAVE_WORKER_CLOSED' });
  assert.equal(f.writers.length, 1);
  assert.equal(f.writers[0].closed, true);
  assert.equal((await f.persistence.readCommittedSnapshot()).facts[0].situation, 'accepted');
});

test('actual transport death exposes lifecycle state and rejects every pending RPC', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-writer-transport-'));
  t.diagnostic(`Retained synthetic fixture: ${directory}`);
  const contextFile = path.join(directory, 'atom.json');
  await fs.writeFile(contextFile, JSON.stringify(facts()));
  const rawPost = Worker.prototype.postMessage;
  let worker;
  let stall = false;
  const posted = deferred();
  t.mock.method(Worker.prototype, 'postMessage', function (message, ...args) {
    worker = this;
    if (stall) { posted.resolve(); return; }
    return rawPost.call(this, message, ...args);
  });
  const writer = createDurableWorldWriter({ contextFile, journalFile: path.join(directory, 'transactions.json') });
  t.after(() => writer.close());
  const seed = await writer.initialize();
  stall = true;
  const pending = Promise.all([
    assert.rejects(writer.save({ revision: seed.initialSnapshot.revision }), { code: 'WORLD_SAVE_WORKER_EXITED' }),
    assert.rejects(writer.findCommitted('missing'), { code: 'WORLD_SAVE_WORKER_EXITED' })
  ]);
  await posted.promise;
  await worker.terminate();
  await pending;
  assert.equal(writer.lifecycle?.terminalFailure?.code, 'WORLD_SAVE_WORKER_EXITED');
  assert.equal(writer.lifecycle.closed, false);
  await writer.close();
  assert.equal(writer.lifecycle.closed, true);
});

test('configured retry replaces an actually terminated worker and saves the accepted revision', { timeout: 5000 }, async (t) => {
  const rawPost = Worker.prototype.postMessage;
  const entered = deferred();
  const saved = deferred();
  let doomed;
  let stall = true;
  t.mock.method(Worker.prototype, 'postMessage', function (message, ...args) {
    if (stall && message.operation === 'save') { doomed = this; entered.resolve(); return; }
    return rawPost.call(this, message, ...args);
  });
  const f = await fixture(t, { saveSchedule: { retryMs: 5 }, onSaved: () => saved.resolve() });
  const receipt = await f.commit('real-death-retry', facts('accepted'));
  const flushing = assert.rejects(f.persistence.flushSaves(), { code: 'WORLD_SAVE_WORKER_EXITED' });
  await entered.promise;
  stall = false;
  await doomed.terminate();
  await flushing;
  await saved.promise;
  await f.persistence.flushSaves();
  assert.equal(f.writers.length, 2);
  assert.equal(f.persistence.saveStatus.savedRevision, receipt.afterRevision);
  assert.equal(f.persistence.saveStatus.pending, false);
});

test('close during replacement initialization never resumes saving or creates another writer', async (t) => {
  const entered = deferred();
  const release = deferred();
  t.after(() => release.resolve());
  const f = await fixture(t, { beforeInitialize: async ({ number }) => {
    if (number === 2) { entered.resolve(); await release.promise; }
  } });
  await f.commit('close-during-recovery', facts('accepted'));
  await f.writers[0].kill();
  const flushing = f.persistence.flushSaves();
  const flushRejected = assert.rejects(flushing, { code: 'WORLD_SAVE_WORKER_CLOSED' });
  await entered.promise;
  const closing = assert.rejects(f.persistence.closeSaves(), { code: 'WORLD_SAVE_WORKER_CLOSED' });
  release.resolve();
  await Promise.all([flushRejected, closing]);
  assert.equal(f.writers.length, 2);
  assert.equal(f.writers[1].closed, true);
  assert.equal(f.writers[1].batches.length, 0);
  assert.equal(f.persistence.saveStatus.pending, true);
});

test('worker data errors do not advertise transport death', async (t) => {
  const f = await fixture(t);
  await f.persistence.readCommittedSnapshot();
  const writer = f.writers[0].raw;
  await assert.rejects(writer.save({ revision: 'not-the-durable-revision' }), { code: 'WORLD_SAVE_REVISION_MISMATCH' });
  assert.equal(writer.lifecycle.terminalFailure, null);
  assert.equal(writer.lifecycle.closed, false);
  assert.equal((await writer.save({ revision: revisionOfWorldFacts(facts()) })).revision,
    revisionOfWorldFacts(facts()));
});
