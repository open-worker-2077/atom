import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createMemoryTransactionPorts } from '../src/atom-system/world-runtime/memory-transaction-ports.mjs';
import { createCommitCoordinator } from '../src/atom-system/world-runtime/commit-coordinator.mjs';
import { createTransactionalWorldPersistence } from '../src/atom-system/adapters/transactional-world-persistence.mjs';
import { sealWorldFactsRevision, revisionOfWorldFacts } from '../src/atom-system/world-runtime/world-revision.mjs';
import { withinWorldShutdown } from '../src/atom-system/world-runtime/world-shutdown.mjs';

process.env.ATOM_RUNTIME_BACKUP_REPO = '';
const facts = (situation = 'old') => [{ thing: 'Root', situation, slot: [], strut: [] }];
const command = (id, expectedRevision) => ({ contract: 'atom.world-command', version: 1,
  commandId: id, correlationId: id, name: 'transform', payload: {}, expectedRevision });
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
function seed() {
  const initial = facts();
  return { initialSnapshot: { worldId: 'primary', facts: initial, revision: sealWorldFactsRevision(initial) },
    durableReceipts: [], durableOutcomes: [] };
}
async function guarded(promise) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error('test close did not settle'), { code: 'TEST_DEADLINE' })), 400);
    })]);
  } finally { clearTimeout(timer); }
}

for (const stage of ['calculation', 'after-prepare', 'after-world-write']) {
  test(`close rejects ${stage} candidate before memory publication and clears recovery residue`, async () => {
    const entered = deferred();
    const release = deferred();
    let accepted = 0;
    const ports = createMemoryTransactionPorts({ ...seed(), onAccepted: () => { accepted += 1; } });
    const candidate = ports.claimCandidate(facts('new'));
    const coordinator = createCommitCoordinator({ ...ports, faultInjector: async (point) => {
      if (point === stage) { entered.resolve(); await release.promise; }
    } });
    const running = coordinator.execute({ command: command('late', ports.authority.snapshot().revision),
      transition: async () => {
        if (stage === 'calculation') { entered.resolve(); await release.promise; }
        return { facts: candidate };
      } });
    await entered.promise;
    // Fallback lets the old implementation demonstrate actual late acceptance.
    ports.beginClose?.();
    release.resolve();
    await assert.rejects(running, { code: 'WORLD_SAVE_WORKER_CLOSED' });
    assert.equal(accepted, 0);
    assert.deepEqual((await coordinator.inspectCommitted()).facts, facts());
    assert.deepEqual(await ports.journalRepository.listPrepared(), []);
    assert.throws(() => ports.claimCandidate(facts('later')), { code: 'WORLD_SAVE_WORKER_CLOSED' });
  });
}

test('close gates new outcomes but keeps existing source and final outcome readable', async () => {
  let outcomes = 0;
  const ports = createMemoryTransactionPorts({ ...seed(), onOutcome: () => { outcomes += 1; } });
  const coordinator = createCommitCoordinator(ports);
  const source = await coordinator.execute({ command: command('source', ports.authority.snapshot().revision),
    transition: () => ({ facts: facts('source'), result: { postCommitEvent: { binding: 'p', interaction: { id: 'source' } } } }) });
  ports.beginClose?.();
  await assert.rejects(coordinator.recordProgramExecution({ sourceCommandId: 'source',
    outcome: { status: 'completed', attemptId: 'late' } }), { code: 'WORLD_SAVE_WORKER_CLOSED' });
  assert.equal(outcomes, 0);
  assert.equal((await ports.journalRepository.findReceipt('source')).afterRevision, source.afterRevision);
  assert.equal((await ports.journalRepository.programExecution('source')).outcome, null);
});

async function fixture(t, { hangClose = false, hangInitialize = false, hangHistory = false } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-world-shutdown-'));
  t.diagnostic(`Retained synthetic fixture: ${directory}`);
  const contextFile = path.join(directory, 'atom.json');
  await fs.writeFile(contextFile, JSON.stringify(facts()));
  const saveGate = deferred();
  const closeGate = deferred();
  const initializeGate = deferred();
  const saving = deferred();
  const historyGate = deferred();
  const historyEntered = deferred();
  const controls = [];
  const configuration = { contextFile, projectionFile: path.join(directory, 'graph.json'),
    runtimeAuthority: 'memory', publishLegacyProjection: false, shutdownTimeoutMs: 20,
    saveSchedule: { quietMs: 60000, maxDirtyMs: 60000, retryMs: 5 },
    writerFactory: () => {
      const control = { saves: 0, closes: 0, revision: null };
      controls.push(control);
      return { initialize: async () => { if (hangInitialize) await initializeGate.promise; return seed(); },
        findCommitted: async () => { historyEntered.resolve(); if (hangHistory) await historyGate.promise; return null; },
        save: async ({ revision }) => {
          control.saves += 1; control.revision = revision; saving.resolve();
          await saveGate.promise;
          return { revision };
        },
        close: async () => { control.closes += 1; if (hangClose) await closeGate.promise; } };
    } };
  const persistence = createTransactionalWorldPersistence(configuration);
  t.after(async () => {
    saveGate.resolve(); closeGate.resolve(); initializeGate.resolve(); historyGate.resolve();
    await persistence.closeSaves({ timeoutMs: 100 }).catch(() => {});
  });
  return { persistence, controls, configuration, saveGate, closeGate, initializeGate, saving, historyEntered,
    async commit() {
      const before = await persistence.readCommittedSnapshot();
      return persistence.commit({ correlationId: 'write', expectedRevision: before.revision,
        nextRevision: revisionOfWorldFacts(facts('accepted')), facts: facts('accepted') });
    } };
}

test('hung save closes only its owner within the deadline and ignores its late acknowledgment', async (t) => {
  const f = await fixture(t);
  const other = await fixture(t);
  const receipt = await f.commit();
  await other.commit();
  const flushing = f.persistence.flushSaves();
  flushing.catch(() => {});
  await f.saving.promise;
  await assert.rejects(guarded(f.persistence.closeSaves()), { code: 'WORLD_SAVE_CLOSE_TIMEOUT' });
  await assert.rejects(flushing, { code: 'WORLD_SAVE_CLOSE_TIMEOUT' });
  assert.equal(f.controls[0].closes, 1);
  assert.equal(other.controls[0].closes, 0);
  assert.equal(f.persistence.saveStatus.pending, true);
  assert.equal(f.persistence.saveStatus.failure.code, 'WORLD_SAVE_CLOSE_TIMEOUT');
  await assert.rejects(f.persistence.commit({ correlationId: 'late', expectedRevision: receipt.afterRevision,
    nextRevision: revisionOfWorldFacts(facts('late')), facts: facts('late') }), { code: 'WORLD_SAVE_WORKER_CLOSED' });
  f.saveGate.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.persistence.saveStatus.savedVersion, 0);
  assert.equal((await f.persistence.readCommittedSnapshot()).facts[0].situation, 'accepted');
  other.saveGate.resolve();
  await other.persistence.flushSaves();
  assert.equal(other.persistence.saveStatus.pending, false);
});

test('unconfirmed termination quarantines the world until actual close confirmation', async (t) => {
  const f = await fixture(t, { hangClose: true });
  await f.commit();
  await assert.rejects(guarded(f.persistence.closeSaves()), { code: 'WORLD_SAVE_CLOSE_TIMEOUT' });
  assert.throws(() => createTransactionalWorldPersistence(f.configuration), { code: 'WORLD_SAVE_WORKER_QUARANTINED' });
  assert.equal(f.controls.length, 1);
  f.closeGate.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  const reopened = createTransactionalWorldPersistence(f.configuration);
  t.after(() => reopened.closeSaves().catch(() => {}));
  assert.deepEqual((await reopened.readCommittedSnapshot()).facts, facts());
  assert.equal(f.controls.length, 2);
  f.persistence.beginClose();
  assert.doesNotThrow(() => createTransactionalWorldPersistence(f.configuration),
    're-closing an old facade must not quarantine the replacement owner');
  f.saveGate.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.persistence.saveStatus.savedVersion, 0);
});

test('startup waits are cancelled by close without later constructing an accepting memory owner', async (t) => {
  const f = await fixture(t, { hangInitialize: true });
  const reading = f.persistence.readCommittedSnapshot();
  reading.catch(() => {});
  await assert.rejects(guarded(f.persistence.closeSaves()), { code: 'WORLD_SAVE_CLOSE_TIMEOUT' });
  await assert.rejects(reading, { code: 'WORLD_SAVE_CLOSE_TIMEOUT' });
  f.initializeGate.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.controls[0].closes, 1);
});

test('unconfirmed memory termination cannot be bypassed by a disk-mode writer for the same world', async (t) => {
  const f = await fixture(t, { hangClose: true });
  await f.commit();
  await assert.rejects(guarded(f.persistence.closeSaves()), { code: 'WORLD_SAVE_CLOSE_TIMEOUT' });
  await assert.rejects(async () => {
    const disk = createTransactionalWorldPersistence({ ...f.configuration, runtimeAuthority: 'disk' });
    const before = await disk.readCommittedSnapshot();
    return disk.commit({ correlationId: 'quarantine-bypass', expectedRevision: before.revision,
      nextRevision: revisionOfWorldFacts(facts('bypass')), facts: facts('bypass') });
  }, { code: 'WORLD_SAVE_WORKER_QUARANTINED' });
});

test('close flushes a newer accepted version after an older in-flight save without admitting later writes', async (t) => {
  const f = await fixture(t);
  const first = await f.commit();
  const flushing = f.persistence.flushSaves();
  await f.saving.promise;
  const latest = await f.persistence.commit({ correlationId: 'newer', expectedRevision: first.afterRevision,
    nextRevision: revisionOfWorldFacts(facts('newer')), facts: facts('newer') });
  const closing = f.persistence.closeSaves({ timeoutMs: 100 });
  f.saveGate.resolve();
  await Promise.all([flushing, closing]);
  assert.equal(f.controls[0].saves, 2);
  assert.equal(f.persistence.saveStatus.savedVersion, 2);
  assert.equal(f.persistence.saveStatus.savedRevision, latest.afterRevision);
  assert.equal(f.persistence.saveStatus.pending, false);
  await assert.rejects(f.persistence.claimCandidate(facts('late')), { code: 'WORLD_SAVE_WORKER_CLOSED' });
});

test('an already expired shared deadline cannot succeed in a microtask before its timer callback', async () => {
  await assert.rejects(withinWorldShutdown(Promise.resolve('late'), Date.now() - 1), { code: 'WORLD_SAVE_CLOSE_TIMEOUT' });
});

test('a clean successful close cancels in-flight and queued history waits without awaiting the history lane', async (t) => {
  const f = await fixture(t, { hangHistory: true });
  const before = await f.persistence.readCommittedSnapshot();
  const lookup = id => f.persistence.rollback({ targetCommandId: 'historical',
    correlationId: id, expectedRevision: before.revision });
  const first = lookup('first');
  const second = lookup('second');
  first.catch(() => {}); second.catch(() => {});
  await f.historyEntered.promise;
  await guarded(f.persistence.closeSaves({ timeoutMs: 100 }));
  await assert.rejects(guarded(first), { code: 'WORLD_SAVE_WORKER_CLOSED' });
  await assert.rejects(guarded(second), { code: 'WORLD_SAVE_WORKER_CLOSED' });
});
