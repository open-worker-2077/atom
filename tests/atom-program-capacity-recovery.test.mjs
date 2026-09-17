import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createLegacyWorldService } from '../src/atom-system/adapters/legacy-engine-adapter.mjs';
import { createTransactionalWorldPersistence } from '../src/atom-system/adapters/transactional-world-persistence.mjs';
import { sealWorldFactsRevision } from '../src/atom-system/world-runtime/world-revision.mjs';

process.env.ATOM_RUNTIME_BACKUP_REPO = '';
const facts = situation => [{ thing: 'Root', situation, slot: [], strut: [] }];
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(predicate) {
  const deadline = Date.now() + 2000;
  while (!await predicate()) {
    if (Date.now() >= deadline) assert.fail('capacity continuation did not settle');
    await tick();
  }
}
async function fixture(t, { maxEvents = 3, oversized = false, recoveredSeed = null, afterAttempt, rejectFirstAttempt = false } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-program-capacity-'));
  t.diagnostic(`Retained synthetic fixture: ${directory}`);
  const target = { contextFile: path.join(directory, 'atom.json'), projectionFile: path.join(directory, 'graph.json') };
  const initial = recoveredSeed?.initialSnapshot.facts ?? facts('old');
  await fs.writeFile(target.contextFile, JSON.stringify(initial));
  const saved = [];
  const persistence = createTransactionalWorldPersistence({ ...target, runtimeAuthority: 'memory', publishLegacyProjection: false,
    pendingLimits: { maxBytes: 100_000, maxEvents, maxEventBytes: 10_000 },
    saveSchedule: { quietMs: 60000, maxDirtyMs: 60000, retryMs: 60000 },
    writerFactory: () => ({ initialize: async () => recoveredSeed ?? ({ initialSnapshot: { worldId: 'primary', facts: initial,
      revision: sealWorldFactsRevision(initial) }, durableReceipts: [], durableOutcomes: [] }), close: async () => {},
    save: async batch => { saved.push(...batch.events); return { revision: batch.revision }; } }) });
  let sourceReceipt, attempts = 0;
  const service = createLegacyWorldService({ memoryAuthoritative: true, transactionProvider: () => persistence,
    execute: async request => {
      if (request.source === 'read') return { ok: true, changed: false };
      if (!request.programExecution) {
        sourceReceipt = await request.commitWorld({ expectedRevision: request.committedSnapshot.revision,
          nextRevision: sealWorldFactsRevision(facts('source')), facts: facts('source'), changedPaths: ['Root'],
          affectedPathClosureComplete: true, postCommitEvent: { binding: request.interactionBinding,
            interaction: request.interaction, enabled: true } });
        await request.onCommitted({ ok: true, changed: true, messages: [], errors: [], warnings: [],
          subsequentExecution: { status: 'pending' }, revisionAfter: sourceReceipt.afterRevision });
      } else sourceReceipt = request.programExecution.sourceReceipt;
      const result = { ok: true, changed: true, messages: oversized ? ['x'.repeat(20_000)] : ['done'],
        warnings: [], errors: [], subsequentExecution: { status: 'completed' } };
      if (request.programExecution?.childReceipt) return result;
      attempts++;
      try {
        if (rejectFirstAttempt && attempts === 1) throw Object.assign(new Error('Held capacity rejection'), { code: 'WORLD_SAVE_BACKPRESSURE' });
        const before = await request.acquireCommittedSnapshot();
        const receipt = await request.commitWorld({ expectedRevision: before.revision,
          nextRevision: sealWorldFactsRevision(facts('effect')), facts: facts('effect'), changedPaths: ['Root'],
          affectedPathClosureComplete: true, subsequentOf: sourceReceipt.commandId, correlationId: 'child-effect' });
        result.revisionAfter = receipt.afterRevision;
      } catch (error) {
        result.ok = false; result.errors = [{ code: error.code }];
        result.subsequentExecution = { status: 'failed', errors: result.errors };
      }
      await afterAttempt?.(attempts);
      return result;
    } });
  t.after(() => service.closeSaves());
  const request = { ...target, source: 'write', interaction: { id: 'source' }, programScheduler: {} };
  return { service, persistence, saved, request, attempts: () => attempts,
    execution: () => persistence.programExecutionForInteraction('source') };
}

test('capacity-rejected effects stay pending and resume once after a verified save frees capacity', async t => {
  const f = await fixture(t);
  const result = await f.service.executeLegacy(f.request);
  assert.equal(result.subsequentExecution.status, 'pending');
  assert.equal((await f.execution()).outcome.status, 'pending');
  assert.equal((await f.persistence.readCommittedSnapshot()).facts[0].situation, 'source');
  await tick(); await tick();
  assert.equal(f.attempts(), 1, 'full capacity must not busy-retry effects');
  await f.service.flushSaves();
  await until(async () => (await f.execution()).outcome?.status === 'completed');
  assert.equal((await f.persistence.readCommittedSnapshot()).facts[0].situation, 'effect');
  assert.equal(f.attempts(), 2);
  await f.service.flushSaves();
  assert.equal(f.saved.filter(event => event.record?.receipt.result?.subsequentOf).length, 1);
});

test('release during an active capacity-rejected attempt rearms once after that attempt settles', async t => {
  let release;
  const held = new Promise(resolve => { release = resolve; });
  const f = await fixture(t, { maxEvents: 8, rejectFirstAttempt: true,
    afterAttempt: count => count === 1 ? held : undefined });
  const running = f.service.executeLegacy(f.request);
  await until(() => f.attempts() === 1);
  await f.service.flushSaves();
  await tick(); await tick();
  assert.equal(f.attempts(), 1);
  release();
  assert.equal((await running).subsequentExecution.status, 'pending');
  await until(async () => (await f.execution()).outcome?.status === 'completed');
  assert.equal(f.attempts(), 2);
});

test('oversized completed body remains explicitly pending on replay and release without reexecuting its child', async t => {
  const f = await fixture(t, { maxEvents: 8, oversized: true });
  const result = await f.service.executeLegacy(f.request);
  assert.equal(result.subsequentExecution.status, 'pending');
  assert.equal(result.subsequentExecution.capacityBlocked.code, 'WORLD_SAVE_EVENT_TOO_LARGE');
  assert.equal(JSON.stringify(result).includes('x'.repeat(1000)), false);
  await f.service.flushSaves();
  await tick(); await tick();
  const replay = await f.service.executeLegacy(f.request);
  assert.equal(replay.subsequentExecution.status, 'pending');
  assert.equal((await f.execution()).outcome.status, 'pending');
  assert.equal(f.attempts(), 1);
  assert.equal(f.saved.filter(event => event.record?.receipt.result?.subsequentOf).length, 1);
  const source = (await f.execution()).sourceReceipt;
  await f.persistence.recordProgramExecution({ sourceCommandId: source.commandId,
    outcome: { status: 'completed', attemptId: 'explicit-resolution', result: { ok: true, messages: ['explicit resolution'] } } });
  assert.equal((await f.execution()).outcome.result.messages[0], 'explicit resolution');
});

test('close suppresses a release-triggered resume while flushing an already accepted pending source', async t => {
  const f = await fixture(t);
  const result = await f.service.executeLegacy(f.request);
  assert.equal(result.subsequentExecution.status, 'pending');
  await f.service.closeSaves();
  await tick(); await tick();
  assert.equal(f.attempts(), 1);
  assert.equal((await f.execution()).childReceipt, null);
  assert.equal(f.saved.some(event => event.record?.receipt.result?.postCommitEvent), true);
});

test('recovered pending source obtains capacity on demand and keeps its original child idempotency', async t => {
  const old = await fixture(t);
  await old.service.executeLegacy(old.request);
  await old.service.closeSaves();
  const recoveredFacts = facts('source');
  const initialSnapshot = { worldId: 'primary', facts: recoveredFacts, revision: sealWorldFactsRevision(recoveredFacts) };
  const recoveredSeed = { initialSnapshot,
    durableReceipts: old.saved.filter(event => event.kind === 'record').map(event => ({ commandId: event.record.commandId,
      historyMode: event.record.historyMode, receipt: event.record.receipt })),
    durableOutcomes: old.saved.filter(event => event.kind === 'outcome').map(event => [event.sourceCommandId, event.outcome]) };
  const fresh = await fixture(t, { recoveredSeed });
  await fresh.service.executeLegacy({ ...fresh.request, source: 'read', interaction: { id: 'trigger-recovery' } });
  assert.equal((await fresh.execution()).outcome.status, 'completed');
  assert.equal((await fresh.persistence.readCommittedSnapshot()).facts[0].situation, 'effect');
  const replay = await fresh.service.executeLegacy(fresh.request);
  assert.equal(replay.subsequentExecution.status, 'completed');
  assert.equal(fresh.attempts(), 1);
});
