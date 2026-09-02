const test = require('node:test');
const assert = require('node:assert/strict');

const targetResolver = require('../spatial-middle-frame-target.js');

function nodeRegion(id, radius, options = {}) {
  return {
    x: options.x ?? 100,
    y: options.y ?? 100,
    radius,
    priority: options.priority ?? 50,
    item: {
      kind: 'node',
      node: { id },
      screen: { radius, depth: options.depth ?? 4 },
      clusterShellProxy: options.clusterShellProxy === true
    }
  };
}

function candidate(region, score) {
  return {
    region,
    score,
    normalizedDistance: 0
  };
}

test('middle framing chooses the smallest visible node under an overlapping pointer', () => {
  const shell = nodeRegion('outer-shell', 400, { clusterShellProxy: true, priority: 90 });
  const node = nodeRegion('specific-node', 20, { priority: 10 });

  assert.equal(
    targetResolver.chooseMostSpecificTarget([shell, node], 100, 100).item.node.id,
    'specific-node'
  );
});

test('middle framing falls back through nested shells from smallest to largest', () => {
  const outer = nodeRegion('outer-shell', 400, { clusterShellProxy: true });
  const inner = nodeRegion('inner-shell', 90, { clusterShellProxy: true });

  assert.equal(
    targetResolver.chooseMostSpecificTarget([outer, inner], 112, 106).item.node.id,
    'inner-shell'
  );
});

test('middle framing ignores targets outside their visible hit circle', () => {
  const node = nodeRegion('missed-node', 20);
  assert.equal(targetResolver.chooseMostSpecificTarget([node], 140, 100), null);
});

test('cluster pointer selection keeps the concrete small node instead of a higher-score outer node', () => {
  const outer = nodeRegion('outer-node', 180, { priority: 90 });
  const concrete = nodeRegion('concrete-node', 18, { priority: 20, x: 106, y: 103 });

  const selected = targetResolver.choosePointerTarget([
    candidate(outer, 90),
    candidate(concrete, 20)
  ], 106, 103, { clusterFieldOpen: true });

  assert.equal(selected.region.item.node.id, 'concrete-node');
});

test('cluster pointer selection preserves an explicit command hit above overlapping nodes', () => {
  const node = nodeRegion('node', 28);
  const command = {
    x: 100,
    y: 100,
    radius: 19,
    item: { kind: 'command', screen: { radius: 19, depth: 1 } }
  };

  const selected = targetResolver.choosePointerTarget([
    candidate(command, 120),
    candidate(node, 80)
  ], 100, 100, { clusterFieldOpen: true });

  assert.equal(selected.region.item.kind, 'command');
});
