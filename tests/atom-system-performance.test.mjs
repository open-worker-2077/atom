import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import test from 'node:test';

import { createEntityIndex } from '../src/atom-system/spatial-experience/entity-index.mjs';
import { createSceneSnapshot } from '../src/atom-system/spatial-experience/scene-snapshot.mjs';

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
