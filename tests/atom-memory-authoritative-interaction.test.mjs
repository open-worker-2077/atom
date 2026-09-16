import assert from 'node:assert/strict';
import test from 'node:test';

import { createLegacyWorldService } from '../src/atom-system/adapters/legacy-engine-adapter.mjs';

test('accepted memory write is readable while independent saving is blocked', async () => {
  let releaseSave;
  const saveGate = new Promise((resolve) => { releaseSave = resolve; });
  let enteredSave;
  const saveEntered = new Promise((resolve) => { enteredSave = resolve; });
  const before = [{ thing: 'Root', situation: 'before', slot: [], strut: [] }];
  const after = [{ thing: 'Root', situation: 'after', slot: [], strut: [] }];
  let persisted = before;
  const persistence = {
    compatibilityGeneration: 0,
    recover: async () => ({ recovered: 0 }),
    readCommittedSnapshot: async () => ({ facts: persisted, revision: persisted === before ? 'sha256:before' : 'sha256:after', compatibilityManifest: null }),
    commit: async () => {
      enteredSave();
      await saveGate;
      persisted = after;
      return { commandId: 'write-1', beforeRevision: 'sha256:before', afterRevision: 'sha256:after' };
    }
  };
  const service = createLegacyWorldService({
    transactionProvider: () => persistence,
    execute: async (request) => {
      if (request.source === 'explore') {
        return { ok: true, facts: request.committedSnapshot?.facts };
      }
      await request.commitWorld({ expectedRevision: 'sha256:before', nextRevision: 'sha256:after', facts: after });
      return { ok: true, changed: true, revisionAfter: 'after' };
    }
  });
  const path = { contextFile: 'atom.json', projectionFile: 'graph.json' };
  const writing = service.executeLegacy({ ...path, source: 'transform', interaction: { id: 'write-1' } });
  await saveEntered;
  try {
    const [read, acknowledged] = await Promise.all([
      service.executeLegacy({ ...path, source: 'explore', interaction: { id: 'read-1' } }),
      Promise.race([
        writing.then(() => true),
        new Promise((resolve) => setTimeout(() => resolve(false), 100))
      ])
    ]);
    assert.equal(read.facts[0].situation, 'after', 'Explore must see the accepted memory version');
    assert.equal(acknowledged, true, 'write acknowledgement must not await saving');
  } finally {
    releaseSave();
    await writing;
  }
});
