import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createProgramRefBindingUpdate,
  rebuildProgramRefBindings
} from '../work-engine/atom-language/program-ref-binding-ledger.mjs';
import { createJsonTransactionJournal } from '../src/atom-system/adapters/json-world-repository.mjs';
import { createJsonWorldRepository } from '../src/atom-system/adapters/json-world-repository.mjs';
import { createTransactionalWorldPersistence } from '../src/atom-system/adapters/transactional-world-persistence.mjs';
import { createCommitCoordinator } from '../src/atom-system/world-runtime/commit-coordinator.mjs';
import { revisionOfWorldFacts } from '../src/atom-system/world-runtime/world-revision.mjs';
import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';
import { parseAtomKey } from '../work-engine/atom-language/key-parser.mjs';
import { executeAtomLanguage } from './helpers/atom-language-test-runtime.mjs';

const hash = (source) => `sha256:${createHash('sha256').update(source).digest('hex')}`;
const site = (targetThingId, fingerprint = 'ref:module.body[0]:0') => ({
  fingerprint,
  role: 'ref',
  targetThingId
});
const replacement = (programThingId, source, targetThingId) => ({
  programThingId,
  sourceHash: hash(source),
  sites: [site(targetThingId)]
});
const receipt = (commandId, programRefBindings, extra = {}) => ({
  commandId,
  beforeRevision: extra.beforeRevision ?? `sha256:${'0'.repeat(64)}`,
  afterRevision: extra.afterRevision ?? `sha256:${'1'.repeat(64)}`,
  ...(extra.rollbackOf ? { rollbackOf: extra.rollbackOf } : {}),
  result: { ...(programRefBindings ? { programRefBindings } : {}) }
});

test('Program create and update emit the normalized source binding in the same central receipt', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-program-binding-engine-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const journalFile = path.join(directory, 'atom.transactions.json');
  const projectionFile = path.join(directory, 'atom.graph.json');
  const targetId = '101';
  await fs.writeFile(contextFile, JSON.stringify([
    { [`thing&id=${targetId}`]: 'World', situation: '', slot: [], strut: [] }
  ]));
  const runtime = { contextFile, projectionFile, programScheduler: createProgramRuntimeScheduler() };
  const rawSource = 'def main():\n    return explore({"thing":ref("World")})';
  const created = await executeAtomLanguage({ ...runtime, source: `transform new ${JSON.stringify({
    'thing@program': 'Program', situation: rawSource, slot: [], strut: []
  })}` });
  assert.equal(created.ok, true, JSON.stringify(created.errors));
  assert.equal(JSON.stringify(created).includes(targetId), false);
  const createdFacts = JSON.parse(await fs.readFile(contextFile, 'utf8'));
  const program = createdFacts.find((entry) => Object.values(entry).includes('Program'));
  const programThingId = parseAtomKey(Object.keys(program).find((key) => key.startsWith('thing'))).identity;
  const firstMetadata = await createJsonTransactionJournal({ file: journalFile }).readMetadataState();
  const firstBinding = firstMetadata.receipts.at(-1).receipt.result.programRefBindings.replacements[0];
  assert.equal(firstBinding.programThingId, programThingId);
  assert.equal(firstBinding.sourceHash, hash(program.situation));
  assert.deepEqual(firstBinding.sites.map(({ role, targetThingId }) => ({ role, targetThingId })),
    [{ role: 'ref', targetThingId: targetId }]);

  const nextSource = `${program.situation}\n# updated`;
  const updated = await executeAtomLanguage({ ...runtime, source: `transform ${JSON.stringify({
    thing: 'Program', [`situation.rep.${nextSource}`]: program.situation
  })}` });
  assert.equal(updated.ok, true, JSON.stringify(updated.errors));
  assert.equal(JSON.stringify(updated).includes(targetId), false);
  const metadata = await createJsonTransactionJournal({ file: journalFile }).readMetadataState();
  const nextBinding = metadata.receipts.at(-1).receipt.result.programRefBindings.replacements[0];
  assert.equal(nextBinding.programThingId, programThingId);
  assert.equal(nextBinding.sourceHash, hash(nextSource));
  assert.equal(nextBinding.sites[0].targetThingId, targetId);
});

for (const [label, clearedSource] of [['empty', ''], ['whitespace-only', ' \t ']]) {
  test(`Program update to ${label} source replaces its prior binding with zero sites`, async (t) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), `atom-program-binding-${label}-`));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const contextFile = path.join(directory, 'atom.json');
    const journalFile = path.join(directory, 'atom.transactions.json');
    const projectionFile = path.join(directory, 'atom.graph.json');
    const targetId = '101';
    await fs.writeFile(contextFile, JSON.stringify([
      { [`thing&id=${targetId}`]: 'World', situation: '', slot: [], strut: [] }
    ]));
    const runtime = { contextFile, projectionFile, programScheduler: createProgramRuntimeScheduler() };
    const initialSource = 'def main():\n    return explore({"thing":ref("World")})';
    const created = await executeAtomLanguage({ ...runtime, source: `transform new ${JSON.stringify({
      'thing@program': 'Program', situation: initialSource, slot: [], strut: []
    })}` });
    assert.equal(created.ok, true, JSON.stringify(created.errors));
    const createdFacts = JSON.parse(await fs.readFile(contextFile, 'utf8'));
    const program = createdFacts.find((entry) => Object.values(entry).includes('Program'));
    const programThingId = parseAtomKey(Object.keys(program).find((key) => key.startsWith('thing'))).identity;

    const cleared = await executeAtomLanguage({ ...runtime, source: `transform ${JSON.stringify({
      thing: 'Program', [`situation.rep.${clearedSource}`]: program.situation
    })}` });
    assert.equal(cleared.ok, true, JSON.stringify(cleared.errors));
    const metadata = await createJsonTransactionJournal({ file: journalFile }).readMetadataState();
    const delta = metadata.receipts.at(-1).receipt.result.programRefBindings;
    assert.deepEqual(delta.removals, []);
    assert.deepEqual(delta.replacements, [{
      programThingId,
      sourceHash: hash(clearedSource),
      sites: []
    }]);
    assert.deepEqual(rebuildProgramRefBindings(metadata.receipts).forProgram(programThingId),
      delta.replacements[0]);
  });
}

test('receipt replay rebuilds immutable Program bindings by identity and applies removals', () => {
  const firstSource = 'explore({"thing":ref("World/Target")})';
  const secondSource = 'explore({"thing":ref("World/Other")})';
  const first = createProgramRefBindingUpdate({
    replacements: [replacement('program-id', firstSource, 'target-id')]
  });
  const second = createProgramRefBindingUpdate({
    replacements: [replacement('program-id', secondSource, 'other-id')]
  });
  const snapshot = rebuildProgramRefBindings([
    { commandId: 'create', receipt: receipt('create', first) },
    { commandId: 'update', receipt: receipt('update', second) }
  ], [{ programThingId: 'program-id', sourceHash: hash(secondSource) }]);

  assert.deepEqual(snapshot.forProgram('program-id'), replacement('program-id', secondSource, 'other-id'));
  assert.deepEqual(snapshot.programIds, ['program-id']);
  assert.throws(() => { snapshot.forProgram('program-id').sites[0].targetThingId = 'corrupt'; }, TypeError);
  assert.throws(() => { snapshot.programIds.push('corrupt'); }, TypeError);

  const deletion = createProgramRefBindingUpdate({ removals: ['program-id'] });
  const deleted = rebuildProgramRefBindings([
    receipt('create', first),
    receipt('delete', deletion)
  ]);
  assert.deepEqual(deletion, { version: 1, replacements: [], removals: ['program-id'] });
  assert.equal(deleted.forProgram('program-id'), null);
});

test('disk transaction stores binding metadata once while every returned receipt stays redacted', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-program-binding-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const journalFile = path.join(directory, 'transactions.json');
  const beforeFacts = [{ 'thing&id=target-id': 'Target', situation: '', slot: [], strut: [] }];
  await fs.writeFile(contextFile, JSON.stringify(beforeFacts));
  const persistence = createTransactionalWorldPersistence({
    contextFile,
    journalFile,
    projectionFile: path.join(directory, 'atom.graph.json'),
    publishLegacyProjection: false
  });
  const source = 'explore({"thing":ref("Target")})';
  const afterFacts = [...beforeFacts, { 'thing@program&id=program-id': 'Program', situation: source, slot: [], strut: [] }];
  const bindings = createProgramRefBindingUpdate({
    replacements: [replacement('program-id', source, 'target-id')]
  });
  const request = {
    correlationId: 'create-program',
    expectedRevision: revisionOfWorldFacts(beforeFacts),
    nextRevision: revisionOfWorldFacts(afterFacts),
    facts: afterFacts,
    beforeFacts,
    source: 'test',
    programRefBindings: bindings
  };

  const returned = await persistence.commit(request);
  const retried = await persistence.commit(request);
  assert.equal(returned.commandId, retried.commandId);
  assert.equal(returned.result.programRefBindings, undefined);
  assert.equal(JSON.stringify([returned, retried]).includes('target-id'), false);

  const metadata = await createJsonTransactionJournal({ file: journalFile }).readMetadataState();
  assert.equal(metadata.receipts.length, 1);
  assert.deepEqual(metadata.receipts[0].receipt.result.programRefBindings, bindings);
  assert.equal((await createJsonTransactionJournal({ file: journalFile }).readState())
    .receipts[0].receipt.result.programRefBindings.replacements[0].sites[0].targetThingId, 'target-id');

  const deleted = await persistence.commit({
    correlationId: 'delete-program',
    expectedRevision: returned.afterRevision,
    nextRevision: revisionOfWorldFacts(beforeFacts),
    facts: beforeFacts,
    beforeFacts: afterFacts,
    source: 'test',
    programRefBindings: createProgramRefBindingUpdate({ removals: ['program-id'] })
  });
  assert.equal(deleted.result.programRefBindings, undefined);
  const afterDelete = await createJsonTransactionJournal({ file: journalFile }).readMetadataState();
  assert.equal(afterDelete.receipts.length, 2);
  assert.deepEqual(afterDelete.receipts.at(-1).receipt.result.programRefBindings,
    { version: 1, replacements: [], removals: ['program-id'] });
  assert.equal(rebuildProgramRefBindings(afterDelete.receipts).forProgram('program-id'), null);
});

test('conflict persists neither candidate Program source nor its binding change', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-program-binding-conflict-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const journalFile = path.join(directory, 'transactions.json');
  const initialFacts = [{ thing: 'Root', situation: 'initial', slot: [], strut: [] }];
  await fs.writeFile(contextFile, JSON.stringify(initialFacts));
  const persistence = createTransactionalWorldPersistence({
    contextFile,
    journalFile,
    projectionFile: path.join(directory, 'atom.graph.json'),
    publishLegacyProjection: false
  });
  const winningFacts = [{ thing: 'Root', situation: 'winner', slot: [], strut: [] }];
  await persistence.commit({ correlationId: 'winner', expectedRevision: revisionOfWorldFacts(initialFacts),
    nextRevision: revisionOfWorldFacts(winningFacts), facts: winningFacts, beforeFacts: initialFacts });
  const losingSource = 'explore({"thing":ref("Target")})';
  const losingFacts = [...initialFacts, { 'thing@program&id=program-id': 'Program', situation: losingSource, slot: [], strut: [] }];
  await assert.rejects(persistence.commit({ correlationId: 'loser', expectedRevision: revisionOfWorldFacts(initialFacts),
    nextRevision: revisionOfWorldFacts(losingFacts), facts: losingFacts, beforeFacts: initialFacts,
    programRefBindings: createProgramRefBindingUpdate({
      replacements: [replacement('program-id', losingSource, 'target-id')]
    }) }), { code: 'WORLD_REVISION_CONFLICT' });

  assert.deepEqual((await persistence.readCommittedSnapshot()).facts, winningFacts);
  const metadata = await createJsonTransactionJournal({ file: journalFile }).readMetadataState();
  assert.equal(metadata.receipts.some(({ receipt: stored }) => (
    stored.result.programRefBindings?.replacements.some(({ programThingId }) => programThingId === 'program-id')
  )), false);
  assert.equal(rebuildProgramRefBindings(metadata.receipts).forProgram('program-id'), null);
});

test('journal prepare failure persists neither candidate Program source nor binding metadata', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-program-binding-journal-failure-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const journalFile = path.join(directory, 'transactions.json');
  const initialFacts = [{ 'thing&id=target-id': 'Target', situation: '', slot: [], strut: [] }];
  await fs.writeFile(contextFile, JSON.stringify(initialFacts));
  const worldRepository = createJsonWorldRepository({ file: contextFile, worldId: 'primary' });
  const journal = createJsonTransactionJournal({ file: journalFile });
  const journalRepository = Object.freeze({
    ...journal,
    async prepare() {
      throw Object.assign(new Error('simulated journal prepare failure'), { code: 'EIO' });
    }
  });
  const coordinator = createCommitCoordinator({ worldRepository, journalRepository });
  const before = await worldRepository.read();
  const source = 'explore({"thing":ref("Target")})';
  const afterFacts = [...initialFacts,
    { 'thing@program&id=program-id': 'Program', situation: source, slot: [], strut: [] }];
  await assert.rejects(coordinator.execute({
    command: { contract: 'atom.world-command', version: 1, commandId: 'failed-program',
      correlationId: 'failed-program', expectedRevision: before.revision, name: 'test', payload: {} },
    transition: () => ({ facts: afterFacts, result: { programRefBindings: createProgramRefBindingUpdate({
      replacements: [replacement('program-id', source, 'target-id')]
    }) } })
  }), { code: 'EIO' });

  assert.deepEqual((await worldRepository.read()).facts, initialFacts);
  assert.deepEqual((await journal.readMetadataState()).receipts, []);
});

test('rollback emits the inverse binding delta and replay restores the prior generation', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-program-binding-rollback-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const journalFile = path.join(directory, 'transactions.json');
  const firstSource = 'explore({"thing":ref("Target")})';
  const secondSource = 'explore({"thing":ref("Other")})';
  const initialFacts = [{ 'thing&id=target-id': 'Target', situation: '', slot: [], strut: [] },
    { 'thing&id=other-id': 'Other', situation: '', slot: [], strut: [] },
    { 'thing@program&id=program-id': 'Program', situation: firstSource, slot: [], strut: [] }];
  await fs.writeFile(contextFile, JSON.stringify(initialFacts));
  const persistence = createTransactionalWorldPersistence({ contextFile, journalFile,
    projectionFile: path.join(directory, 'atom.graph.json'), publishLegacyProjection: false });

  const seededFacts = structuredClone(initialFacts);
  seededFacts[2].situation = `${firstSource}\n# seeded`;
  const seeded = await persistence.commit({ correlationId: 'seed',
    expectedRevision: revisionOfWorldFacts(initialFacts), nextRevision: revisionOfWorldFacts(seededFacts),
    facts: seededFacts, beforeFacts: initialFacts,
    programRefBindings: createProgramRefBindingUpdate({
      replacements: [replacement('program-id', `${firstSource}\n# seeded`, 'target-id')]
    }) });
  const updatedFacts = structuredClone(seededFacts);
  updatedFacts[2].situation = secondSource;
  const updated = await persistence.commit({ correlationId: 'update',
    expectedRevision: seeded.afterRevision, nextRevision: revisionOfWorldFacts(updatedFacts),
    facts: updatedFacts, beforeFacts: seededFacts,
    programRefBindings: createProgramRefBindingUpdate({
      replacements: [replacement('program-id', secondSource, 'other-id')]
    }) });
  const rolledBack = await persistence.rollback({ targetCommandId: updated.commandId,
    correlationId: 'undo-update', expectedRevision: updated.afterRevision });
  assert.equal(rolledBack.result.programRefBindings, undefined);

  const metadata = await createJsonTransactionJournal({ file: journalFile }).readMetadataState();
  const priorSource = `${firstSource}\n# seeded`;
  const rebuilt = rebuildProgramRefBindings(metadata.receipts, [
    { programThingId: 'program-id', sourceHash: hash(priorSource) }
  ]);
  assert.deepEqual(rebuilt.forProgram('program-id'), replacement('program-id', priorSource, 'target-id'));
  assert.deepEqual(metadata.receipts.at(-1).receipt.result.programRefBindings.replacements,
    [replacement('program-id', priorSource, 'target-id')]);
});
