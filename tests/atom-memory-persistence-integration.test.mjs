import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createTransactionalWorldPersistence } from '../src/atom-system/adapters/transactional-world-persistence.mjs';
import { createLegacyWorldService } from '../src/atom-system/adapters/legacy-engine-adapter.mjs';
import { createJsonTransactionJournal, createJsonWorldRepository } from '../src/atom-system/adapters/json-world-repository.mjs';
import { revisionOfWorldFacts } from '../src/atom-system/world-runtime/world-revision.mjs';
import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';

test('memory persistence accepts and reads a transition before its independent save', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-memory-persistence-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, '[]\n', 'utf8');
  const persistence = createTransactionalWorldPersistence({ contextFile, projectionFile,
    runtimeAuthority: 'memory', publishLegacyProjection: false,
    saveSchedule: { quietMs: 60000, maxDirtyMs: 60000 } });
  t.after(() => persistence.closeSaves());
  const before = await persistence.readCommittedSnapshot();
  const facts = [{ thing: 'Root', situation: 'accepted', slot: [], strut: [] }];
  const receipt = await persistence.commit({ correlationId: 'memory-write-1',
    expectedRevision: before.revision, nextRevision: revisionOfWorldFacts(facts), facts });
  assert.equal((await persistence.readCommittedSnapshot()).facts[0].situation, 'accepted');
  assert.deepEqual(JSON.parse(await fs.readFile(contextFile, 'utf8')), [],
    'disk remains a lagging recovery checkpoint before flush');
  assert.equal(persistence.saveStatus.pending, true);
  await persistence.flushSaves();
  assert.equal(persistence.saveStatus.pending, false);
  assert.equal((await persistence.readCommittedSnapshot()).revision, receipt.afterRevision);
  assert.equal(JSON.parse(await fs.readFile(contextFile, 'utf8'))[0].situation, 'accepted');
  const journal = createJsonTransactionJournal({ file: path.join(directory, 'atom.transactions.json') });
  assert.equal((await journal.latestReceipt()).afterRevision, receipt.afterRevision);
});

test('a backup scheduling error cannot mark an already durable save as failed', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-memory-backup-notification-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  await fs.writeFile(contextFile, '[]\n', 'utf8');
  const persistence = createTransactionalWorldPersistence({ contextFile,
    projectionFile: path.join(directory, 'graph.json'), runtimeAuthority: 'memory',
    publishLegacyProjection: false, saveSchedule: { quietMs: 60000, maxDirtyMs: 60000 },
    onSaved: () => { throw Object.assign(new Error('backup unavailable'), { code: 'BACKUP_UNAVAILABLE' }); } });
  t.after(() => persistence.closeSaves());
  const before = await persistence.readCommittedSnapshot();
  const facts = [{ thing: 'Root', situation: 'accepted', slot: [], strut: [] }];
  await persistence.commit({ correlationId: 'backup-callback-error',
    expectedRevision: before.revision, nextRevision: revisionOfWorldFacts(facts), facts });
  await persistence.flushSaves();
  assert.equal(persistence.saveStatus.pending, false);
  assert.equal(persistence.saveStatus.failure, null);
  assert.equal(persistence.saveStatus.auxiliaryFailure?.code, 'BACKUP_UNAVAILABLE');
});

test('public World Service Explore reads an accepted Transform before the save timer', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-memory-service-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, '[]\n', 'utf8');
  const service = createLegacyWorldService({ memoryAuthoritative: true,
    publishLegacyProjection: false,
    saveSchedule: { quietMs: 60000, maxDirtyMs: 60000 },
    execute: async (request) => {
      if (request.source === 'explore') return { ok: true, facts: request.committedSnapshot.facts };
      const facts = [{ thing: 'Root', situation: 'accepted', slot: [], strut: [] }];
      await request.commitWorld({ expectedRevision: revisionOfWorldFacts([]),
        nextRevision: revisionOfWorldFacts(facts), facts });
      return { ok: true, changed: true };
    } });
  t.after(() => service.closeSaves());
  const target = { contextFile, projectionFile };
  await service.executeLegacy({ ...target, source: 'transform', interaction: { id: 'write' } });
  const read = await service.executeLegacy({ ...target, source: 'explore', interaction: { id: 'read' } });
  assert.equal(read.facts[0].situation, 'accepted');
  assert.deepEqual(JSON.parse(await fs.readFile(contextFile, 'utf8')), []);
});

test('real Atom Transform is readable from memory before the old disk checkpoint advances', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-memory-engine-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, `${JSON.stringify([
    { thing: 'Root', situation: 'old', slot: [], strut: [] }
  ])}\n`, 'utf8');
  const service = createLegacyWorldService({ memoryAuthoritative: true,
    publishLegacyProjection: true,
    saveSchedule: { quietMs: 60000, maxDirtyMs: 60000 } });
  t.after(() => service.closeSaves());
  const result = await service.executeLegacy({ contextFile, projectionFile,
    source: 'transform {"thing":"Root","situation.rep.new"}',
    interaction: { id: 'real-transform' } });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal((await service.readCommittedSnapshot({ contextFile, projectionFile })).facts[0].situation,
    'new');
  const pending = await service.saveStatus({ contextFile, projectionFile });
  assert.equal(pending.pending, true);
  assert.equal(pending.acceptedRevision, `sha256:${result.revisionAfter}`);
  assert.notEqual(pending.savedRevision, pending.acceptedRevision);
  assert.equal(JSON.parse(await fs.readFile(contextFile, 'utf8'))[0].situation, 'old');
  await service.flushSaves();
  assert.equal((await service.saveStatus({ contextFile, projectionFile })).pending, false);
  const durable = createJsonWorldRepository({ file: contextFile, worldId: 'primary',
    localCommitFile: path.join(`${path.join(directory, 'atom.transactions.json')}.d`, 'world-commits.jsonl') });
  assert.equal((await durable.read()).facts[0].situation, 'new');
  assert.ok(JSON.parse(await fs.readFile(projectionFile, 'utf8')).graph);
});

test('Program source and subsequent facts both execute against accepted memory before save', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-memory-program-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, JSON.stringify([
    { thing: 'test', situation: '', slot: [], strut: [] },
    { thing: 'Trigger', situation: 'wait', slot: [], strut: [] },
    { 'thing@program': 'Create Then Update', situation: [
      "trigger = explore({'thing': 'Trigger', 'situation$full': None})[0]",
      "if trigger.situation == 'go':",
      "    transform({'thing': 'test/Created', 'situation': 'created', 'slot': [], 'strut': []})",
      "    transform({'thing': 'test/Created', 'situation.rep.final': None})"
    ].join('\n'), slot: [], strut: [] }
  ]));
  const service = createLegacyWorldService({ memoryAuthoritative: true,
    publishLegacyProjection: false,
    saveSchedule: { quietMs: 60000, maxDirtyMs: 60000 } });
  t.after(() => service.closeSaves());
  const result = await service.executeLegacy({ contextFile, projectionFile,
    source: 'transform {"thing":"Trigger","situation.rep.go"}',
    programMode: 'reconcile', programScheduler: createProgramRuntimeScheduler(),
    interaction: { id: 'program-before-save' } });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.subsequentExecution.status, 'completed');
  const memory = await service.readCommittedSnapshot({ contextFile, projectionFile });
  assert.equal(memory.facts[0].slot[0].situation, 'final');
  assert.equal(JSON.parse(await fs.readFile(contextFile, 'utf8'))[0].slot.length, 0);
  await service.flushSaves();
  const durable = createJsonWorldRepository({ file: contextFile, worldId: 'primary',
    localCommitFile: path.join(`${path.join(directory, 'atom.transactions.json')}.d`, 'world-commits.jsonl') });
  assert.equal((await durable.read()).facts[0].slot[0].situation, 'final');
});
