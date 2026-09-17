import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createLegacyWorldService } from '../src/atom-system/adapters/legacy-engine-adapter.mjs';
import { createDurableWorldWriter } from '../src/atom-system/adapters/durable-world-writer.mjs';
import { revisionOfWorldFacts } from '../src/atom-system/world-runtime/world-revision.mjs';

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
