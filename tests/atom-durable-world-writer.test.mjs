import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createCommitCoordinator } from '../src/atom-system/world-runtime/commit-coordinator.mjs';
import { createMemoryTransactionPorts } from '../src/atom-system/world-runtime/memory-transaction-ports.mjs';
import { createDurableWorldWriter } from '../src/atom-system/adapters/durable-world-writer.mjs';
import { createJsonTransactionJournal, createJsonWorldRepository } from '../src/atom-system/adapters/json-world-repository.mjs';
import { sealWorldFactsRevision } from '../src/atom-system/world-runtime/world-revision.mjs';

function command(id, revision) {
  return { contract: 'atom.world-command', version: 1, commandId: id,
    correlationId: id, expectedRevision: revision, name: 'transform', payload: {} };
}

test('worker saves every accepted transition in order, then restart reads the final receipt', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-memory-writer-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const journalFile = path.join(directory, 'transactions.json');
  await fs.writeFile(contextFile, '[]\n', 'utf8');
  const initialFacts = [];
  const initialRevision = sealWorldFactsRevision(initialFacts);
  const records = [];
  const ports = createMemoryTransactionPorts({ initialSnapshot: {
    contract: 'atom.world-snapshot', version: 1, worldId: 'primary',
    revision: initialRevision, facts: initialFacts
  }, onAccepted: (entry) => records.push(entry.record) });
  const coordinator = createCommitCoordinator(ports);
  const first = await coordinator.execute({ command: command('first', initialRevision),
    transition: () => ({ facts: [{ thing: 'A', situation: 'one', slot: [], strut: [] }],
      result: { postCommitEvent: { binding: 'agent', interaction: { id: 'first' } } } }) });
  const outcome = { status: 'pending', attemptId: 'first-attempt' };
  await coordinator.recordProgramExecution({ sourceCommandId: first.commandId, outcome });
  const second = await coordinator.execute({ command: command('second', first.afterRevision),
    transition: () => ({ facts: [{ thing: 'A', situation: 'two', slot: [], strut: [] }] }) });
  const writer = createDurableWorldWriter({ contextFile, journalFile, worldId: 'primary' });
  t.after(() => writer.close());
  const events = [{ kind: 'record', record: records[0] },
    { kind: 'outcome', sourceCommandId: first.commandId, outcome },
    { kind: 'record', record: records[1] }];
  const saved = await writer.save({ events, revision: second.afterRevision });
  assert.equal(saved.revision, second.afterRevision);
  const diskWorld = createJsonWorldRepository({ file: contextFile, worldId: 'primary',
    localCommitFile: path.join(`${journalFile}.d`, 'world-commits.jsonl') });
  const diskJournal = createJsonTransactionJournal({ file: journalFile });
  assert.equal((await diskWorld.read()).facts[0].situation, 'two');
  assert.equal((await diskJournal.findReceipt('first')).afterRevision, first.afterRevision);
  assert.equal((await diskJournal.findReceipt('second')).afterRevision, second.afterRevision);
  assert.equal((await diskJournal.programExecution(first.commandId)).outcome.attemptId, 'first-attempt');
  assert.equal((await writer.save({ events, revision: second.afterRevision })).revision, second.afterRevision,
    'retrying the exact batch must not duplicate committed history');
});
