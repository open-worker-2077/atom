import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createLegacyWorldService } from '../src/atom-system/adapters/legacy-engine-adapter.mjs';
import { createDurableWorldWriter } from '../src/atom-system/adapters/durable-world-writer.mjs';
import { revisionOfWorldFacts } from '../src/atom-system/world-runtime/world-revision.mjs';
import { readAtomContext } from '../work-engine/atom-language/context-store.mjs';

test('real engine reuses an accepted memory version and preserves old readers through save', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-owned-real-memory-'));
  t.diagnostic(`retained fixture: ${directory}`);
  const target = { contextFile: path.join(directory, 'atom.json'),
    projectionFile: path.join(directory, 'graph.json') };
  await fs.writeFile(target.contextFile,
    `${JSON.stringify([{ thing: 'Root', situation: 'before', slot: [], strut: [] }])}\n`, 'utf8');
  const service = createLegacyWorldService({ memoryAuthoritative: true,
    publishLegacyProjection: false,
    saveSchedule: { quietMs: 60_000, maxDirtyMs: 60_000 } });
  let closed = false;
  try {
    const before = await service.readCommittedVersion(target);
    const oldContext = await readAtomContext(target.contextFile, { committedVersion: before });
    for (const id of ['owned-memory-read-1', 'owned-memory-read-2']) {
      const read = await service.executeLegacy({ ...target,
        source: 'explore {"thing":"Root"}', interaction: { id } });
      assert.equal(read.ok, true, JSON.stringify(read.errors));
      assert.strictEqual(await service.readCommittedVersion(target), before);
    }
    const write = await service.executeLegacy({ ...target,
      source: 'transform {"thing":"Root","situation.rep.changed"}',
      interaction: { id: 'owned-memory-write' } });
    assert.equal(write.ok, true, JSON.stringify(write.errors));
    const after = await service.readCommittedVersion(target);
    assert.notStrictEqual(after, before);
    assert.equal(oldContext[0].situation, 'before');
    assert.equal((await readAtomContext(target.contextFile, { committedVersion: after }))[0].situation,
      'changed');
    const latest = await service.executeLegacy({ ...target,
      source: 'explore {"thing":"Root"}', interaction: { id: 'owned-memory-read-3' } });
    assert.equal(latest.ok, true, JSON.stringify(latest.errors));
    assert.equal(JSON.parse(await fs.readFile(target.contextFile, 'utf8'))[0].situation,
      'before', 'the independent saver has not written the accepted version yet');
    await service.closeSaves();
    closed = true;
    assert.equal(JSON.parse(await fs.readFile(target.contextFile, 'utf8'))[0].situation,
      'before', 'the baseline file remains unchanged beneath the durable local commit');
    const coldWriter = createDurableWorldWriter({ contextFile: target.contextFile,
      journalFile: path.join(directory, 'atom.transactions.json') });
    try {
      const recovered = await coldWriter.initialize();
      assert.equal(recovered.initialSnapshot.revision, after.revision);
      assert.equal(recovered.initialSnapshot.facts[0].situation, 'changed');
    } finally {
      await coldWriter.close();
    }
  } finally {
    if (!closed) await service.closeSaves().catch(() => {});
  }
});

test('accepted memory write is readable while independent saving is blocked', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-memory-blocked-save-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let releaseSave;
  const saveGate = new Promise((resolve) => { releaseSave = resolve; });
  let enteredSave;
  const saveEntered = new Promise((resolve) => { enteredSave = resolve; });
  const before = [{ thing: 'Root', situation: 'before', slot: [], strut: [] }];
  const after = [{ thing: 'Root', situation: 'after', slot: [], strut: [] }];
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, `${JSON.stringify(before)}\n`, 'utf8');
  const service = createLegacyWorldService({
    memoryAuthoritative: true,
    publishLegacyProjection: false,
    saveSchedule: { quietMs: 0, maxDirtyMs: 0 },
    writerFactory: (configuration) => {
      const writer = createDurableWorldWriter(configuration);
      return { initialize: () => writer.initialize(), findCommitted: (id) => writer.findCommitted(id),
        close: () => writer.close(), async save(request) {
        enteredSave();
        await saveGate;
        return writer.save(request);
      } };
    },
    execute: async (request) => {
      if (request.source === 'explore') {
        return { ok: true, facts: request.committedSnapshot?.facts };
      }
      await request.commitWorld({ expectedRevision: revisionOfWorldFacts(before),
        nextRevision: revisionOfWorldFacts(after), facts: after });
      return { ok: true, changed: true, revisionAfter: revisionOfWorldFacts(after) };
    }
  });
  t.after(async () => { releaseSave(); await service.closeSaves(); });
  const target = { contextFile, projectionFile };
  const writing = service.executeLegacy({ ...target, source: 'transform', interaction: { id: 'write-1' } });
  await saveEntered;
  try {
    const [read, acknowledged] = await Promise.all([
      service.executeLegacy({ ...target, source: 'explore', interaction: { id: 'read-1' } }),
      Promise.race([
        writing.then(() => true),
        new Promise((resolve) => setTimeout(() => resolve(false), 100))
      ])
    ]);
    assert.equal(read.facts[0].situation, 'after', 'Explore must see the accepted memory version');
    assert.equal(acknowledged, true, 'write acknowledgement must not await saving');
    assert.equal((await service.saveStatus(target)).pending, true);
  } finally {
    releaseSave();
    await writing;
  }
  await service.flushSaves();
  assert.equal((await service.saveStatus(target)).pending, false);
});

test('a save failure reports dirty state but does not undo an accepted read', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-memory-save-failure-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const before = [{ thing: 'Root', situation: 'before', slot: [], strut: [] }];
  const after = [{ thing: 'Root', situation: 'after', slot: [], strut: [] }];
  const target = { contextFile: path.join(directory, 'atom.json'),
    projectionFile: path.join(directory, 'graph.json') };
  await fs.writeFile(target.contextFile, `${JSON.stringify(before)}\n`, 'utf8');
  let failedOnce = false;
  let failObserved;
  const firstSaveFailed = new Promise((resolve) => { failObserved = resolve; });
  const service = createLegacyWorldService({ memoryAuthoritative: true,
    publishLegacyProjection: false,
    saveSchedule: { quietMs: 0, maxDirtyMs: 0, retryMs: 60000 },
    writerFactory: (configuration) => {
      const writer = createDurableWorldWriter(configuration);
      return { initialize: () => writer.initialize(), findCommitted: (id) => writer.findCommitted(id),
        close: () => writer.close(), save(request) {
        if (!failedOnce) {
          failedOnce = true;
          failObserved();
          return Promise.reject(Object.assign(new Error('injected save failure'), { code: 'EIO' }));
        }
        return writer.save(request);
      } };
    },
    execute: async (request) => {
      if (request.source === 'explore') return { ok: true, facts: request.committedSnapshot.facts };
      await request.commitWorld({ expectedRevision: revisionOfWorldFacts(before),
        nextRevision: revisionOfWorldFacts(after), facts: after });
      return { ok: true, changed: true };
    } });
  t.after(() => service.closeSaves());
  await service.executeLegacy({ ...target, source: 'transform', interaction: { id: 'write-failed-save' } });
  await firstSaveFailed;
  const read = await service.executeLegacy({ ...target, source: 'explore', interaction: { id: 'read-after-failure' } });
  assert.equal(read.facts[0].situation, 'after');
  const status = await service.saveStatus(target);
  assert.equal(status.pending, true);
  assert.equal(status.failure?.code, 'EIO');
  await service.flushSaves();
  assert.equal((await service.saveStatus(target)).pending, false);
});

test('closing a failed saver releases its writer even when flush rejects', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-memory-close-failure-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const before = [{ thing: 'Root', situation: 'before', slot: [], strut: [] }];
  const after = [{ thing: 'Root', situation: 'after', slot: [], strut: [] }];
  const target = { contextFile: path.join(directory, 'atom.json'),
    projectionFile: path.join(directory, 'graph.json') };
  await fs.writeFile(target.contextFile, `${JSON.stringify(before)}\n`, 'utf8');
  let writerClosed = false;
  const service = createLegacyWorldService({ memoryAuthoritative: true,
    publishLegacyProjection: false,
    saveSchedule: { quietMs: 60000, maxDirtyMs: 60000 },
    writerFactory: (configuration) => {
      const writer = createDurableWorldWriter(configuration);
      return { initialize: () => writer.initialize(), findCommitted: (id) => writer.findCommitted(id),
        save: async () => { throw Object.assign(new Error('injected save failure'), { code: 'EIO' }); },
        close: async () => { writerClosed = true; await writer.close(); } };
    },
    execute: async (request) => {
      await request.commitWorld({ expectedRevision: revisionOfWorldFacts(before),
        nextRevision: revisionOfWorldFacts(after), facts: after });
      return { ok: true, changed: true };
    } });
  await service.executeLegacy({ ...target, source: 'transform', interaction: { id: 'close-failure' } });
  await assert.rejects(service.closeSaves(), { code: 'EIO' });
  assert.equal(writerClosed, true);
});
