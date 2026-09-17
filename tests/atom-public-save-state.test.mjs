import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createLegacyWorldService } from '../src/atom-system/adapters/legacy-engine-adapter.mjs';
import { createTransactionalWorldPersistence } from '../src/atom-system/adapters/transactional-world-persistence.mjs';
import { createDurableWorldWriter } from '../src/atom-system/adapters/durable-world-writer.mjs';
import { createSpatialServer } from '../cli/lib/server.mjs';
import { revisionOfWorldFacts } from '../src/atom-system/world-runtime/world-revision.mjs';
import { executeAtomLanguage } from '../work-engine/atom-language/engine.mjs';

process.env.ATOM_RUNTIME_BACKUP_REPO = '';
const facts = () => ['A', 'B'].map(thing => ({ thing, situation: 'old', slot: [], strut: [] }));
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-public-save-state-'));
  t.diagnostic(`Retained synthetic fixture: ${directory}`);
  const target = { contextFile: path.join(directory, 'atom.json'), projectionFile: path.join(directory, 'graph.json') };
  await fs.writeFile(target.contextFile, JSON.stringify(facts()));
  return { directory, target };
}

test('public writes and reads capture accepted, failed and saved status without waiting for saving', async (t) => {
  const { target } = await fixture(t);
  let fail = true;
  const service = createLegacyWorldService({ memoryAuthoritative: true, publishLegacyProjection: false,
    saveSchedule: { quietMs: 60000, maxDirtyMs: 60000, retryMs: 60000 },
    writerFactory: configuration => {
      const writer = createDurableWorldWriter(configuration);
      return { initialize: () => writer.initialize(), findCommitted: id => writer.findCommitted(id), close: () => writer.close(),
        save: request => fail ? Promise.reject(Object.assign(new Error('injected'), { code: 'EIO' })) : writer.save(request) };
    } });
  t.after(async () => { fail = false; await service.closeSaves(); });
  assert.equal(await service.saveStatus(target), null, 'status must not create or recover an owner');
  const send = (source, id) => service.executeLegacy({ ...target, source, interaction: { id } });
  const first = await send('transform {"thing":"A","situation.rep.first"}', 'first');
  assert.equal(first.ok, true, JSON.stringify(first.errors));
  assert.equal(first.saveState.pending, true);
  assert.notEqual(first.saveState.acceptedRevision, first.saveState.savedRevision);
  const second = await send('transform {"thing":"B","situation.rep.second"}', 'second');
  assert.equal(second.ok, true, JSON.stringify(second.errors));
  assert.ok(second.saveState.acceptedVersion > first.saveState.acceptedVersion);
  const accepted = await service.readCommittedSnapshot(target);
  assert.deepEqual(accepted.facts.map(item => item.situation), ['first', 'second']);
  await assert.rejects(service.flushSaves(), { code: 'EIO' });
  const read = await send('explore {"thing":"A","situation$full":true}', 'read-failed-save');
  assert.match(JSON.stringify(read), /first/u);
  assert.equal(read.saveState.failure.code, 'EIO');
  assert.equal(read.saveState.pending, true);
  fail = false;
  await service.flushSaves();
  const saved = await send('explore {"thing":"B"}', 'read-saved');
  assert.equal(saved.saveState.pending, false);
  assert.equal(saved.saveState.savedRevision, second.saveState.acceptedRevision);
  assert.equal(saved.saveState.acceptedVersion, saved.saveState.savedVersion);
  assert.equal(Object.hasOwn(saved.saveState, 'facts'), false);
});

test('source, settled and historical Program replies capture fresh state without storing it in outcomes', async (t) => {
  const { target } = await fixture(t);
  let persistence;
  let engineRuns = 0;
  let sourceId;
  const service = createLegacyWorldService({ memoryAuthoritative: true,
    transactionProvider: request => persistence = createTransactionalWorldPersistence({ ...request,
      runtimeAuthority: 'memory', publishLegacyProjection: false,
      saveSchedule: { quietMs: 60000, maxDirtyMs: 60000 } }),
    execute: async request => {
      engineRuns += 1;
      const before = request.committedSnapshot;
      const after = structuredClone(before.facts);
      after[0].situation = 'source';
      const receipt = await request.commitWorld({ expectedRevision: before.revision,
        nextRevision: revisionOfWorldFacts(after), facts: after,
        postCommitEvent: { binding: request.interactionBinding, interaction: request.interaction } });
      sourceId = receipt.commandId;
      const result = { ok: true, changed: true, revisionAfter: receipt.afterRevision,
        subsequentExecution: { status: 'pending' } };
      await request.onCommitted(result);
      await persistence.flushSaves();
      // Only outcome evidence remains unsaved; matching world revisions is not sufficient.
      return { ...result, subsequentExecution: { status: 'completed' } };
    } });
  t.after(() => service.closeSaves());
  let source, settled;
  const request = { ...target, source: 'program-source', interaction: { id: 'program-source' },
    onCommitted: value => { source = value; }, onSubsequentSettled: value => { settled = value; } };
  const final = await service.executeLegacy(request);
  assert.equal(source.saveState.pending, true);
  assert.equal(settled.saveState.pending, true);
  assert.equal(final.saveState.acceptedRevision, final.saveState.savedRevision);
  assert.equal(final.saveState.pending, true);
  assert.equal(Object.hasOwn((await persistence.programExecution(sourceId)).outcome.result, 'saveState'), false);
  await service.flushSaves();
  const replay = await service.executeLegacy(request);
  assert.equal(engineRuns, 1);
  assert.equal(replay.revisionAfter, final.revisionAfter);
  assert.equal(replay.saveState.pending, false);
  assert.equal(final.saveState.pending, true, 'historical response objects must not be mutated');
});

for (const overlap of [false, true]) {
  test(`public stale ${overlap ? 'overlapping' : 'disjoint'} edits preserve the existing conflict rule while save is held`, async (t) => {
    const { target } = await fixture(t);
    const gates = new Map();
    function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
    for (const id of ['first', 'second']) gates.set(id, { entered: deferred(), release: deferred() });
    const service = createLegacyWorldService({ memoryAuthoritative: true, publishLegacyProjection: false,
      saveSchedule: { quietMs: 60000, maxDirtyMs: 60000 },
      execute: request => executeAtomLanguage({ ...request, commitWorld: async transition => {
        const gate = gates.get(request.interaction.id);
        gate?.entered.resolve();
        await gate?.release.promise;
        return request.commitWorld(transition);
      } }) });
    t.after(async () => { for (const gate of gates.values()) gate.release.resolve(); await service.closeSaves(); });
    const first = service.executeLegacy({ ...target, source: 'transform {"thing":"A","situation.rep.first"}', interaction: { id: 'first' } });
    const second = service.executeLegacy({ ...target, source: `transform {"thing":"${overlap ? 'A' : 'B'}","situation.rep.second"}`,
      interaction: { id: 'second' } });
    await Promise.all([...gates.values()].map(gate => gate.entered.promise));
    gates.get('first').release.resolve();
    const firstResult = await first;
    gates.get('second').release.resolve();
    assert.equal(firstResult.ok, true, JSON.stringify(firstResult.errors));
    if (overlap) await assert.rejects(second, { code: 'WORLD_REVISION_CONFLICT' });
    else {
      const secondResult = await second;
      assert.equal(secondResult.ok, true, JSON.stringify(secondResult.errors));
      assert.equal(secondResult.saveState.pending, true);
    }
    assert.deepEqual((await service.readCommittedSnapshot(target)).facts.map(item => item.situation),
      overlap ? ['first', 'old'] : ['first', 'second']);
    const read = await service.executeLegacy({ ...target, source: 'explore {"thing":"A","situation$full":true}', interaction: { id: 'read' } });
    assert.match(JSON.stringify(read), /first/u);
    assert.equal(read.saveState.pending, true);
  });
}

test('disk-mode replies preserve their shape', async (t) => {
  const { target } = await fixture(t);
  const service = createLegacyWorldService({ publishLegacyProjection: false });
  const read = await service.executeLegacy({ ...target, source: 'explore {"thing":"A"}' });
  assert.equal(read.ok, true);
  assert.equal(Object.hasOwn(read, 'saveState'), false);
});

test('HTTP cached receipts receive a fresh status at each emission without mutating the cached result', async (t) => {
  const { directory } = await fixture(t);
  let calls = 0;
  let state = { acceptedVersion: 1, savedVersion: 0, pending: true };
  const original = { ok: true, changed: false, revisionAfter: 'historical' };
  const instance = await createSpatialServer({ storeFile: path.join(directory, 'knowledge.json'),
    atomCommand: async () => { calls += 1; return original; }, atomSaveState: () => structuredClone(state) });
  await new Promise(resolve => instance.server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => instance.server.close(resolve)));
  const url = `http://127.0.0.1:${instance.server.address().port}/__atom/api/command`;
  const send = () => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ source: 'explore {}', interaction: { id: 'cached' } }) }).then(response => response.json());
  const first = await send();
  assert.equal(first.result.saveState.pending, true);
  state = { acceptedVersion: 1, savedVersion: 1, pending: false };
  const replay = await send();
  assert.equal(replay.result.saveState.pending, false);
  assert.equal(replay.result.revisionAfter, 'historical');
  assert.equal(calls, 1);
  assert.equal(Object.hasOwn(original, 'saveState'), false);
});
