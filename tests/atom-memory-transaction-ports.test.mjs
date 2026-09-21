import assert from 'node:assert/strict';
import test from 'node:test';

import { createCommitCoordinator } from '../src/atom-system/world-runtime/commit-coordinator.mjs';
import { sealWorldFactsRevision } from '../src/atom-system/world-runtime/world-revision.mjs';
import { createMemoryTransactionPorts } from '../src/atom-system/world-runtime/memory-transaction-ports.mjs';

function snapshot(facts) {
  return { contract: 'atom.world-snapshot', version: 1, worldId: 'primary',
    revision: sealWorldFactsRevision(facts), facts };
}

function command(id, expectedRevision) {
  return { contract: 'atom.world-command', version: 1, commandId: id,
    correlationId: id, expectedRevision, name: 'transform', payload: {} };
}

test('coordinator accepts into one memory fact/receipt boundary without storage', async () => {
  const before = snapshot([{ thing: 'Root', situation: 'before', slot: [], strut: [] }]);
  const after = [{ thing: 'Root', situation: 'after', slot: [], strut: [] }];
  const accepted = [];
  const ports = createMemoryTransactionPorts({ initialSnapshot: before,
    onAccepted: (entry) => accepted.push(entry) });
  const coordinator = createCommitCoordinator(ports);
  const receipt = await coordinator.execute({ command: command('write-1', before.revision),
    transition: () => ({ facts: after, result: { source: 'test' } }) });

  assert.equal(ports.authority.snapshot().facts[0].situation, 'after');
  assert.equal(ports.authority.status().acceptedVersion, 1);
  assert.equal((await ports.journalRepository.findReceipt('write-1')).commandId, receipt.commandId);
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].version, 1);
  assert.equal(accepted[0].record.receipt.commandId, 'write-1');
  assert.equal(Object.isFrozen(accepted[0].record), true);
  assert.equal(Object.isFrozen(accepted[0].record.after.facts[0]), true);
  assert.equal(accepted[0].snapshot.revision, receipt.afterRevision);
  assert.equal((await coordinator.inspectCommitted((current) => current)).revision, receipt.afterRevision);
});

test('binding metadata shares memory acceptance, retry and interruption recovery with Program facts', async () => {
  const before = snapshot([{ thing: 'Root', situation: 'before', slot: [], strut: [] }]);
  const after = [{ thing: 'Root', situation: 'after', slot: [], strut: [] }];
  const binding = { version: 1, replacements: [{ programThingId: 'program-id',
    sourceHash: `sha256:${'a'.repeat(64)}`, sites: [{ fingerprint: 'ref:module.body[0]:0',
      role: 'ref', targetThingId: 'target-id' }] }], removals: [] };
  let interrupted = false;
  const ports = createMemoryTransactionPorts({ initialSnapshot: before });
  const coordinator = createCommitCoordinator({ ...ports, faultInjector(stage) {
    if (!interrupted && stage === 'after-prepare') {
      interrupted = true;
      throw Object.assign(new Error('journal interrupted'), { code: 'INJECTED_INTERRUPTION' });
    }
  } });
  const request = { command: command('binding-write', before.revision), transition: () => ({
    facts: after, result: { programRefBindings: binding }
  }) };
  await assert.rejects(coordinator.execute(request), { code: 'INJECTED_INTERRUPTION' });
  assert.equal(ports.authority.snapshot().facts[0].situation, 'before');
  assert.deepEqual((await ports.journalRepository.readMetadataState()).receipts, []);

  await coordinator.recover();
  const metadata = await ports.journalRepository.readMetadataState();
  assert.equal(ports.authority.snapshot().facts[0].situation, 'after');
  assert.deepEqual(metadata.receipts[0].receipt.result.programRefBindings, binding);
  const retried = await coordinator.execute(request);
  assert.equal(retried.commandId, 'binding-write');
  assert.equal((await ports.journalRepository.readMetadataState()).receipts.length, 1);
});

test('only a privately claimed plain candidate transfers identity to memory acceptance', async () => {
  const before = snapshot([{ thing: 'Root', situation: 'before', slot: [], strut: [] }]);
  const ports = createMemoryTransactionPorts({ initialSnapshot: before });
  const coordinator = createCommitCoordinator(ports);
  const first = [{ thing: 'Root', situation: 'first', slot: [], strut: [] }];
  ports.claimCandidate(first);
  await coordinator.execute({ command: command('owned-1', before.revision),
    transitionInputMode: 'trusted-readonly', transition: () => ({ facts: first,
      revision: sealWorldFactsRevision(first) }) });
  assert.strictEqual(ports.authority.snapshot().facts, first);
  const second = [{ thing: 'Root', situation: 'second', slot: [], strut: [] }];
  await coordinator.execute({ command: command('unclaimed-2', ports.authority.snapshot().revision),
    transitionInputMode: 'trusted-readonly', transition: () => ({ facts: second,
      revision: sealWorldFactsRevision(second) }) });
  assert.notStrictEqual(ports.authority.snapshot().facts, second);
  assert.equal(ports.authority.snapshot().facts[0].situation, 'second');
  const returned = [{ thing: 'Root', situation: 'before', slot: [], strut: [] }];
  ports.claimCandidate(returned);
  await coordinator.execute({ command: command('owned-3', ports.authority.snapshot().revision),
    transitionInputMode: 'trusted-readonly', transition: () => ({ facts: returned,
      revision: sealWorldFactsRevision(returned) }) });
  assert.strictEqual(ports.authority.snapshot().facts, returned);
  assert.equal(ports.authority.snapshot().revision, before.revision);
  assert.equal(ports.authority.status().acceptedVersion, 3);
  assert.equal(first[0].situation, 'first');
});

test('recovery records seed memory history but never replay a persisted write as a new acceptance', async () => {
  const before = snapshot([]);
  const durable = { receipt: { commandId: 'prior', correlationId: 'prior',
    beforeRevision: before.revision, afterRevision: before.revision,
    result: { source: 'prior' } }, commandId: 'prior' };
  const ports = createMemoryTransactionPorts({ initialSnapshot: before,
    durableReceipts: [durable], durableFindCommitted: async () => durable });
  assert.equal((await ports.journalRepository.findReceipt('prior')).commandId, 'prior');
  assert.equal((await ports.journalRepository.findCommitted('prior')).commandId, 'prior');
  assert.equal(ports.authority.status().acceptedVersion, 0);
  assert.equal((await ports.journalRepository.readState()).receipts.length, 1);
});

test('restart seeds durable Program outcome instead of rerunning a completed source', async () => {
  const before = snapshot([]);
  const event = { binding: 'agent', interaction: { id: 'source' } };
  const durable = { commandId: 'source', receipt: { commandId: 'source', correlationId: 'source',
    beforeRevision: before.revision, afterRevision: before.revision,
    result: { postCommitEvent: event } } };
  const outcome = { status: 'completed', attemptId: 'attempt', result: { ok: true } };
  const ports = createMemoryTransactionPorts({ initialSnapshot: before,
    durableReceipts: [durable], durableOutcomes: [['source', outcome]] });
  assert.equal((await ports.journalRepository.programExecutionForInteraction('source')).outcome.status,
    'completed');
  assert.equal((await ports.journalRepository.pendingProgramExecutions()).length, 0);
});

test('accepted Program source and outcome are visible before a save', async () => {
  const before = snapshot([]);
  const ports = createMemoryTransactionPorts({ initialSnapshot: before });
  const coordinator = createCommitCoordinator(ports);
  const source = await coordinator.execute({ command: command('source', before.revision),
    transition: () => ({ facts: [{ thing: 'Source', situation: '', slot: [], strut: [] }],
      result: { postCommitEvent: { binding: 'agent', interaction: { id: 'source' }, sourceChanged: true } } }) });
  const execution = await ports.journalRepository.programExecutionForInteraction('source');
  assert.equal(execution.sourceReceipt.commandId, source.commandId);
  assert.equal((await ports.journalRepository.pendingProgramExecutions()).length, 1);
  await coordinator.recordProgramExecution({ sourceCommandId: source.commandId,
    outcome: { status: 'pending', attemptId: 'attempt-1' } });
  assert.equal((await ports.journalRepository.programExecution(source.commandId)).outcome.attemptId, 'attempt-1');
});

for (const interruptedAt of ['after-prepare', 'after-world-write']) {
  test(`memory recovery finishes an interrupted ${interruptedAt} decision exactly once`, async () => {
    const before = snapshot([]);
    const accepted = [];
    const ports = createMemoryTransactionPorts({ initialSnapshot: before,
      onAccepted: (entry) => accepted.push(entry) });
    let interrupted = false;
    const coordinator = createCommitCoordinator({ ...ports,
      faultInjector: (stage) => {
        if (!interrupted && stage === interruptedAt) {
          interrupted = true;
          throw Object.assign(new Error('injected interruption'), { code: 'INJECTED_INTERRUPTION' });
        }
      } });
    await assert.rejects(coordinator.execute({ command: command('interrupted', before.revision),
      transition: () => ({ facts: [{ thing: 'After', situation: '', slot: [], strut: [] }] }) }),
    { code: 'INJECTED_INTERRUPTION' });
    await coordinator.recover();
    await coordinator.recover();
    assert.equal(ports.authority.snapshot().facts[0].thing, 'After');
    assert.equal(accepted.length, 1);
    assert.equal((await ports.journalRepository.findReceipt('interrupted')).commandId, 'interrupted');
  });
}
