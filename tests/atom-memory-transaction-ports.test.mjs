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
