const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'spatial-view-grammar.js'), 'utf8');
const context = { window: {} };
vm.runInNewContext(source, context, { filename: 'spatial-view-grammar.js' });
const grammar = context.window.SpatialViewGrammar;

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('snapshot normalization preserves unique bounded revealed ids', () => {
  const revealedIds = Array.from({ length: 70 }, (_, index) => `node-${index}`);
  revealedIds.splice(2, 0, 'node-1', null, 42);
  const snapshot = grammar.normalizeVisualSnapshot({ revealedIds });

  assert.ok(grammar.visualSnapshotKeys.includes('revealedIds'));
  assert.equal(snapshot.revealedIds.length, 64);
  assert.equal(new Set(snapshot.revealedIds).size, 64);
  assert.deepEqual(plain(snapshot.revealedIds.slice(0, 3)), ['node-0', 'node-1', 'node-2']);
});

test('view history round-trips exact revealed ids', () => {
  const history = grammar.createViewHistory(4);
  history.reset({ path: 'root', revealedIds: [] });
  history.push({ path: 'root', revealedIds: ['root:sphere-0', 'root:sphere-0:sat-0'] });

  assert.deepEqual(plain(history.back().revealedIds), []);
  assert.deepEqual(
    plain(history.forward().revealedIds),
    ['root:sphere-0', 'root:sphere-0:sat-0']
  );
});

test('view history round-trips multi-cluster mode and expanded branches', () => {
  const history = grammar.createViewHistory(4);
  history.reset({ path: 'root', clusterFieldOpen: true, expandedClusters: [] });
  history.push({
    path: 'root',
    clusterFieldOpen: true,
    expandedClusters: [{
      path: 'root/child',
      depth: 1,
      label: '子域',
      pathLabels: ['全域', '子域'],
      parentPath: 'root',
      parentNodeId: 'root:sphere-1'
    }]
  });

  assert.equal(history.back().clusterFieldOpen, true);
  const restored = history.forward();
  assert.equal(restored.clusterFieldOpen, true);
  assert.deepEqual(plain(restored.expandedClusters), [{
    path: 'root/child',
    depth: 1,
    label: '子域',
    pathLabels: ['全域', '子域'],
    parentPath: 'root',
    parentNodeId: 'root:sphere-1'
  }]);
});

test('visual metadata accepts only bounded final confirmation counts', () => {
  assert.deepEqual(
    plain(grammar.sanitizeVisualMeta('activate', { confirmationCount: 3, payload: { business: true } })),
    { confirmationCount: 3 }
  );
  assert.deepEqual(
    plain(grammar.sanitizeVisualMeta('focus', { confirmationCount: 1.8, arbitrary: 'drop-me' })),
    null
  );
  assert.deepEqual(
    plain(grammar.sanitizeVisualMeta('activate', { confirmationCount: 0 })),
    null
  );
  assert.deepEqual(
    plain(grammar.sanitizeVisualMeta('activate', { confirmationCount: 4 })),
    null
  );
});

test('dominant horizontal orbit drag suppresses incidental vertical jitter', () => {
  assert.deepEqual(
    plain(grammar.resolveOrbitDragDelta({
      dx: 8,
      dy: 0.7,
      totalDx: 18,
      totalDy: 1.4,
      axisLock: null
    })),
    { dx: 8, dy: 0, axisLock: 'horizontal' }
  );
});

test('diagonal orbit drag preserves free two-axis movement', () => {
  assert.deepEqual(
    plain(grammar.resolveOrbitDragDelta({
      dx: 5,
      dy: 4,
      totalDx: 12,
      totalDy: 10,
      axisLock: null
    })),
    { dx: 5, dy: 4, axisLock: null }
  );
});

test('view snapshots preserve one valid future mode and sanitize branch projections', () => {
  const nested = grammar.normalizeVisualSnapshot({
    viewMode: 'peripheral',
    expandedClusters: [{
      path: 'root/a',
      depth: 1,
      parentPath: 'root',
      parentNodeId: 'a',
      projectionMode: 'nested'
    }]
  });
  const invalid = grammar.normalizeVisualSnapshot({
    viewMode: 'delete-everything',
    expandedClusters: [{
      path: 'root/a',
      depth: 1,
      parentPath: 'root',
      parentNodeId: 'a',
      projectionMode: 'unknown'
    }]
  });

  assert.equal(nested.viewMode, 'peripheral');
  assert.equal(nested.expandedClusters[0].projectionMode, 'nested');
  assert.equal(invalid.viewMode, 'nested');
  assert.equal(invalid.expandedClusters[0].projectionMode, 'hierarchy');
});
