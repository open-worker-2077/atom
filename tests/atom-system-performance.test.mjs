import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createEntityIndex } from '../src/atom-system/spatial-experience/entity-index.mjs';
import { createSceneSnapshot } from '../src/atom-system/spatial-experience/scene-snapshot.mjs';
import { createBrowserCommandMapper } from '../src/atom-system/browser-command-mapper.mjs';
import { createAtomLanguageReceiver } from '../work-engine/atom-language/receiver.mjs';
import { createLegacyWorldService } from '../src/atom-system/adapters/legacy-engine-adapter.mjs';
import { inheritPreparedAccessWorld, prepareAccessWorld } from '../work-engine/atom-language/query-capability.mjs';
import { sealWorldFactsRevision } from '../src/atom-system/world-runtime/world-revision.mjs';

test('optional execution stage observations retain command identity without changing results', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-command-stage-proof-'));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, JSON.stringify([{ thing: '节点', situation: '', slot: [], strut: [] }]));
  const service = createLegacyWorldService({ publishLegacyProjection: false });
  const events = [];
  const request = { contextFile, projectionFile, humanAuthority: true,
    source: 'transform {"thing":"节点","situation.rep.正文"}', interaction: { id: 'stage-proof' } };
  const result = await service.executeLegacy({ ...request, onExecutionStage: event => events.push(event) });
  assert.equal(result.ok, true, JSON.stringify(result));
  for (const stage of ['sealWorldFactsRevision', 'postCommitEvent', 'inheritPreparedAccessWorld', 'validateRequestCandidate']) {
    assert.ok(events.some(event => event.stage === stage), stage);
  }
  assert.ok(events.every(event => event.interactionId === 'stage-proof' && event.durationMs >= 0));
  const cache = events.find(event => event.stage === 'inheritPreparedAccessWorld');
  assert.equal(typeof cache.previousExplore, 'boolean');
  assert.equal(typeof cache.previousSlotStructure, 'boolean');
  const validation = events.find(event => event.stage === 'validateRequestCandidate');
  assert.ok(Number.isFinite(validation.threadCpuMs));
  assert.equal(validation.surfaceInput.before.visitedMatches, 1);
  assert.equal(validation.surfaceInput.after.visitedMatches, 1);
  assert.ok(validation.surfaceInput.before.serializedBytes > 0);
  assert.equal(validation.ordinal, 1);
  assert.equal((await service.executeLegacy({ ...request, source: 'transform {"thing":"节点","situation.rep.后文"}',
    interaction: { id: 'stage-observer-fault' }, onExecutionStage() { throw new Error('observer fault'); } })).ok, true);
});

test('access-cache stage observation exposes only cache presence and size', () => {
  const previous = [{ thing: '节点', situation: '', slot: [], strut: [] }];
  sealWorldFactsRevision(previous);
  prepareAccessWorld(previous);
  const next = structuredClone(previous);
  next[0].situation = '后文';
  sealWorldFactsRevision(next);
  const events = [];
  assert.equal(inheritPreparedAccessWorld(previous, next, event => events.push(event)), true);
  assert.equal(events.length, 1);
  assert.equal(events[0].previousExplore, true);
  assert.equal(events[0].previousSlotStructure, true);
  assert.ok(events[0].exploreMatches >= 1);
  assert.ok(events[0].exploreSelectors >= 1);
  assert.equal(inheritPreparedAccessWorld(previous, next, () => { throw new Error('observer fault'); }), true);
  const unsealedEvents = [];
  assert.equal(inheritPreparedAccessWorld(previous, structuredClone(next), event => unsealedEvents.push(event)), false);
  assert.equal(unsealedEvents[0]?.previousExplore, true);
  assert.equal(unsealedEvents[0]?.previousSlotStructure, true);
  assert.equal(unsealedEvents[0]?.previousSealed, true);
  assert.equal(unsealedEvents[0]?.nextSealed, false);
});

test('one canonical command has one observable parser and validator pass', () => {
  const stages = [];
  const receiver = createAtomLanguageReceiver({ onStage: event => stages.push(event.stage) });
  assert.equal(receiver.receive('transform {"thing":"域/节点","situation.rep.正文"}').ok, true);
  assert.deepEqual(stages, ['parser', 'validator']);
  assert.equal(createAtomLanguageReceiver({ onStage() { throw new Error('observer fault'); } })
    .receive('transform {"thing":"域/节点","situation.rep.正文"}').ok, true);
});

test('12,500 unrelated projected Things are indexed only at import; warm compile p95 is at most 5ms', t => {
  const mapper = createBrowserCommandMapper();
  let reads = 0;
  const nodes = Array.from({ length: 12_500 }, (_, i) => ({
    id: `noise-${i}`, path: 'root', atomPath: `无关/节点${i}`
  }));
  nodes.push({ id: 'target', path: 'root', atomPath: '域/节点' });
  mapper.replaceKnowledge({ get nodes() { reads += 1; return nodes; } });
  const importReads = reads;
  const samples = [];
  for (let i = 0; i < 35; i += 1) {
    const start = performance.now();
    const compiled = mapper.compile({ kind: 'node-edit', node: { atomPath: '域/节点' },
      draft: { label: '节点', description: `正文${i}`, atomTypes: [] } });
    if (i >= 5) samples.push(performance.now() - start);
    assert.ok(compiled.source.includes(`正文${i}`));
  }
  assert.equal(reads, importReads, 'hot commands must not revisit the projection');
  const p95 = samples.sort((a, b) => a - b)[28];
  assert.ok(p95 <= 5, `compile p95 ${p95}ms exceeds 5ms`);
  t.diagnostic(JSON.stringify({ samples: samples.length, uiMapP95Ms: p95, importReads }));
});

const WORKLOAD = Object.freeze({
  entities: 10_000,
  visible: 2_000,
  indexBudgetMs: 1_000,
  interactionSnapshotBudgetMs: 500,
  heapBudgetBytes: 128 * 1024 * 1024
});

function entity(index) {
  return {
    id: `node:${index}`,
    atomRef: `atom:${index}`,
    kind: 'node',
    label: `Node ${index}`,
    detail: `Detail ${index}`,
    hierarchyAddress: ['root', `group-${Math.floor(index / 100)}`, `node-${index}`],
    detailMode: 'floating',
    capabilities: { read: true, write: true }
  };
}

test('declared 10k-world interaction workload stays inside the architecture budget', () => {
  const heapBefore = process.memoryUsage().heapUsed;
  const raw = Array.from({ length: WORKLOAD.entities }, (_, index) => entity(index));
  const indexStarted = performance.now();
  const index = createEntityIndex(raw);
  const indexMs = performance.now() - indexStarted;

  const visibleIds = raw.slice(0, WORKLOAD.visible).map(({ id }) => id);
  const snapshotStarted = performance.now();
  const snapshot = createSceneSnapshot({
    index,
    viewState: {
      mode: 'nested',
      visibleIds,
      selectedId: 'node:7',
      focusedId: 'node:8',
      middleFocusId: 'node:0',
      labelDepth: 3,
      detailDepth: 3,
      detailModeById: {}
    }
  });
  const snapshotMs = performance.now() - snapshotStarted;
  const heapGrowth = Math.max(0, process.memoryUsage().heapUsed - heapBefore);

  assert.equal(snapshot.entities.length, WORKLOAD.entities);
  assert.equal(snapshot.visibleCount, WORKLOAD.visible);
  assert.ok(indexMs < WORKLOAD.indexBudgetMs, `entity index ${indexMs.toFixed(1)}ms exceeded ${WORKLOAD.indexBudgetMs}ms`);
  assert.ok(
    snapshotMs < WORKLOAD.interactionSnapshotBudgetMs,
    `scene snapshot ${snapshotMs.toFixed(1)}ms exceeded ${WORKLOAD.interactionSnapshotBudgetMs}ms`
  );
  assert.ok(
    heapGrowth < WORKLOAD.heapBudgetBytes,
    `heap growth ${heapGrowth} exceeded ${WORKLOAD.heapBudgetBytes}`
  );
});
