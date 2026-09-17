import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemoryTransactionPorts } from '../src/atom-system/world-runtime/memory-transaction-ports.mjs';
import { createCommitCoordinator } from '../src/atom-system/world-runtime/commit-coordinator.mjs';
import { sealWorldFactsRevision } from '../src/atom-system/world-runtime/world-revision.mjs';

process.env.ATOM_RUNTIME_BACKUP_REPO = '';
const facts = value => [{ thing: 'Root', situation: value, slot: [], strut: [] }];
function seed(total, pending) {
  const initialFacts = facts('old');
  const initialSnapshot = { worldId: 'primary', facts: initialFacts, revision: sealWorldFactsRevision(initialFacts) };
  let visits = 0;
  const durableReceipts = [], durableOutcomes = [];
  for (let i = 0; i < total; i++) {
    const commandId = `record-${i}`;
    const source = i % 4 === 0;
    const receipt = { commandId, correlationId: commandId, beforeRevision: initialSnapshot.revision,
      afterRevision: initialSnapshot.revision, result: source ? {
        postCommitEvent: { binding: commandId, interaction: { id: commandId }, resultPaths: ['Root'] },
        compatibilityManifest: { payload: 'x'.repeat(8192) }
      } : {} };
    durableReceipts.push({ commandId, get receipt() { visits++; return receipt; } });
    if (source && i >= pending * 4) durableOutcomes.push([commandId,
      { status: 'completed', attemptId: commandId, result: { messages: ['y'.repeat(8192)] } }]);
  }
  return { initialSnapshot, durableReceipts, durableOutcomes, visits: () => visits, reset: () => { visits = 0; } };
}

for (const total of [128, 512]) for (const pending of [0, 2]) {
  test(`pending enumeration depends on P=${pending}, not completed N=${total}/S=${total / 4}`, async t => {
    const input = seed(total, pending);
    const ports = createMemoryTransactionPorts(input);
    assert.ok(input.visits() <= total * 2, 'startup projection must be linear in receipts');
    input.reset();
    const clone = globalThis.structuredClone;
    let clones = 0, bytes = 0;
    t.mock.method(globalThis, 'structuredClone', value => {
      clones++; bytes += Buffer.byteLength(JSON.stringify(value));
      return clone(value);
    });
    const first = await ports.journalRepository.pendingProgramExecutions();
    const second = await ports.journalRepository.pendingProgramExecutions();
    const measured = { total, sources: total / 4, pending, visits: input.visits(), clones, bytes };
    t.diagnostic(JSON.stringify(measured));
    assert.deepEqual(first.map(item => item.sourceReceipt.commandId), pending ? ['record-0', 'record-4'] : []);
    assert.deepEqual(second, first);
    assert.equal(clones, 2 * pending, 'completed executions must not be cloned before filtering');
    assert.ok(input.visits() <= 4 * pending, 'only selected source/child identities may read receipts');
    assert.ok(bytes <= pending * 40_000, 'clone volume must exclude completed result payloads');
  });
}

test('single-source lookup and internal terminal decisions do not scan or clone unrelated history', async t => {
  const input = seed(512, 0);
  input.durableReceipts[509].receipt.result.subsequentOf = 'record-508';
  const ports = createMemoryTransactionPorts(input);
  input.reset();
  const clone = globalThis.structuredClone;
  let executionClones = 0;
  t.mock.method(globalThis, 'structuredClone', value => {
    if (value?.sourceReceipt) executionClones++;
    return clone(value);
  });
  const execution = await ports.journalRepository.programExecution('record-508');
  const byInteraction = await ports.journalRepository.programExecutionForInteraction('record-508');
  await ports.journalRepository.recordProgramExecution({ sourceCommandId: 'record-508',
    outcome: { status: 'completed', attemptId: 'idempotent' } });
  t.diagnostic(JSON.stringify({ visits: input.visits(), executionClones }));
  assert.deepEqual(byInteraction, execution);
  assert.equal(execution.childReceipt.commandId, 'record-509');
  assert.equal(executionClones, 2, 'internal terminal checks need no detached execution copy');
  assert.ok(input.visits() <= 6, 'lookup must resolve IDs rather than scan the receipt list');
});

test('first correlation and child identities preserve original receipt order and detached readers', async () => {
  const initialFacts = facts('old');
  const revision = sealWorldFactsRevision(initialFacts);
  const entry = (id, result, correlationId = id) => ({ commandId: id, receipt: { commandId: id,
    correlationId, beforeRevision: revision, afterRevision: revision, result } });
  const event = { binding: 'original', interaction: { id: 'same' }, resultPaths: ['Root'] };
  const ports = createMemoryTransactionPorts({ initialSnapshot: { facts: initialFacts, revision }, durableReceipts: [
    entry('early-child', { subsequentOf: 'source' }),
    entry('source', { postCommitEvent: { ...event, effectsCommitted: true } }, 'same'),
    entry('late-child', { subsequentOf: 'source' }),
    entry('other-source', { postCommitEvent: event }, 'same'),
    entry('self-source', { postCommitEvent: { ...event, effectsCommitted: true } }),
    entry('self-late-child', { subsequentOf: 'self-source' })
  ] });
  const reader = await ports.journalRepository.programExecutionForInteraction('same');
  assert.equal(reader.sourceReceipt.commandId, 'source');
  assert.equal(reader.childReceipt.commandId, 'early-child');
  assert.equal((await ports.journalRepository.programExecution('self-source')).childReceipt.commandId, 'self-source');
  reader.event.binding = 'mutated';
  reader.childReceipt.commandId = 'mutated';
  assert.equal((await ports.journalRepository.programExecution('source')).event.binding, 'original');
  assert.deepEqual((await ports.journalRepository.pendingProgramExecutions()).map(item => item.sourceReceipt.commandId), ['other-source']);
});

test('incremental pending order survives child, hard pending, saved demotion and close without changing old readers', async () => {
  const initialFacts = facts('A');
  const accepted = [], hydrated = [];
  const ports = createMemoryTransactionPorts({ initialSnapshot: { worldId: 'primary', facts: initialFacts, revision: sealWorldFactsRevision(initialFacts) },
    onAccepted: event => accepted.push(event), durableFindCommitted: async id => {
      hydrated.push(id); return accepted.find(event => event.record.commandId === id).record;
    } });
  const coordinator = createCommitCoordinator(ports);
  const edit = (id, value, result) => coordinator.execute({ command: { contract: 'atom.world-command', version: 1,
    name: 'test', commandId: id, correlationId: id, expectedRevision: ports.authority.snapshot().revision, payload: {} },
    transition: () => ({ facts: facts(value), changedPaths: ['Root'], result: { affectedPathClosureComplete: true, ...result } }) });
  const source = id => ({ postCommitEvent: { binding: id, interaction: { id } } });
  const a = await edit('a', 'B', source('a'));
  await ports.journalRepository.recordProgramExecution({ sourceCommandId: 'a', outcome: { status: 'pending', attemptId: 'first' } });
  const held = await ports.journalRepository.programExecution('a');
  await edit('b', 'A', source('b'));
  const child = await edit('child', 'C', { subsequentOf: 'a' });
  const ids = async () => (await ports.journalRepository.pendingProgramExecutions()).map(item => item.sourceReceipt.commandId);
  assert.deepEqual(await ids(), ['b']);
  await ports.journalRepository.recordProgramExecution({ sourceCommandId: 'a', outcome: { status: 'pending',
    attemptId: 'oversize', capacityBlocked: { code: 'WORLD_SAVE_EVENT_TOO_LARGE', retryable: false } } });
  assert.deepEqual(await ids(), ['a', 'b'], 're-entering pending retains the original source position');
  assert.throws(() => ports.markSaved({ version: 1, revision: child.afterRevision }), { code: 'UNKNOWN_SAVED_REVISION' });
  ports.markSaved({ version: 1, revision: a.afterRevision });
  await edit('c', 'D', source('c'));
  ports.markSaved({ version: 3, revision: child.afterRevision });
  ports.markSaved({ version: 1, revision: a.afterRevision });
  assert.deepEqual(await ids(), ['a', 'b', 'c']);
  assert.equal(held.outcome.status, 'pending');
  assert.equal(held.childReceipt, null);
  await ports.journalRepository.recordProgramExecution({ sourceCommandId: 'a', outcome: { status: 'completed', attemptId: 'resolved' } });
  assert.deepEqual(await ids(), ['b', 'c']);
  assert.deepEqual(hydrated, []);
  await ports.journalRepository.findCommitted('a');
  assert.deepEqual(hydrated, ['a']);
  ports.beginClose();
  await assert.rejects(ports.journalRepository.recordProgramExecution({ sourceCommandId: 'b',
    outcome: { status: 'completed', attemptId: 'closed' } }), { code: 'WORLD_SAVE_WORKER_CLOSED' });
  assert.deepEqual(await ids(), ['b', 'c']);
});
