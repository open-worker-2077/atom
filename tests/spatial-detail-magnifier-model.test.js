const test = require('node:test');
const assert = require('node:assert/strict');

const magnifier = require('../spatial-detail-magnifier-model.js');

test('a pointed node keeps its local visual owner for exact highlighting', () => {
  const node = { id: 'shared-node', label: 'Shared', description: 'Detail' };
  const target = magnifier.targetAt({
    node,
    nodeOwnerPath: 'root/local-view',
    relations: [], boxes: [], regions: [], x: 20, y: 20
  });

  assert.equal(target.kind, 'node');
  assert.equal(target.node, node);
  assert.equal(target.ownerPath, 'root/local-view');
});

test('three CapsLock presses inside the gesture window toggle magnifier mode', () => {
  let state = magnifier.createState();
  state = magnifier.registerCapsLock(state, 100).state;
  state = magnifier.registerCapsLock(state, 420).state;
  const third = magnifier.registerCapsLock(state, 760);
  assert.equal(third.toggled, true);
  assert.equal(third.state.enabled, true);
  assert.deepEqual(third.state.presses, []);

  state = magnifier.registerCapsLock(third.state, 2000).state;
  state = magnifier.registerCapsLock(state, 2400).state;
  const disabled = magnifier.registerCapsLock(state, 2700);
  assert.equal(disabled.state.enabled, false);
});

test('a late CapsLock press starts a new triple instead of completing an old one', () => {
  let state = magnifier.createState();
  state = magnifier.registerCapsLock(state, 0).state;
  state = magnifier.registerCapsLock(state, 400).state;
  const late = magnifier.registerCapsLock(state, 2001);
  assert.equal(late.toggled, false);
  assert.deepEqual(late.state.presses, [2001]);
});

test('a deliberate human-paced triple press still toggles the magnifier', () => {
  let state = magnifier.createState();
  state = magnifier.registerCapsLock(state, 100).state;
  state = magnifier.registerCapsLock(state, 800).state;
  const third = magnifier.registerCapsLock(state, 1500);
  assert.equal(third.toggled, true);
  assert.equal(third.state.enabled, true);
});

test('pointer target prefers a sphere and otherwise resolves a floating detail box', () => {
  const sphere = { label: '目标', description: '# 完整目标' };
  const boxNode = { label: '调研', description: '**全文**' };
  assert.equal(magnifier.targetAt({ node: sphere, boxes: [], x: 10, y: 10 }).node, sphere);
  assert.equal(magnifier.targetAt({
    node: null,
    boxes: [{ left: 20, top: 30, right: 220, bottom: 130, node: boxNode }],
    x: 80,
    y: 90
  }).node, boxNode);
});

test('pointer target resolves the smallest nested group instead of retaining a previous node', () => {
  const outer = { label: '调研', description: '调研详情' };
  const conclusion = { label: '结论', description: '结论详情' };
  const target = magnifier.targetAt({
    node: null,
    boxes: [],
    regions: [
      { x: 100, y: 100, radius: 90, node: outer, detail: '调研详情' },
      { x: 120, y: 110, radius: 28, node: conclusion, detail: '结论详情' }
    ],
    x: 120,
    y: 110
  });
  assert.equal(target.node, conclusion);
  assert.equal(target.detail, '结论详情');
});

test('pointer target resolves a relation and exposes its directed detail', () => {
  const edge = { id: 'edge-a-b', label: '审批后进入执行', detail: 'A 审批通过后，B 才能开始。' };
  const target = magnifier.targetAt({
    node: null,
    relations: [{ x: 80, y: 60, radius: 18, edge, label: edge.label }],
    boxes: [], regions: [], x: 82, y: 61
  });

  assert.equal(target.kind, 'relationship');
  assert.equal(target.edge, edge);
  assert.equal(target.detail, '审批后进入执行\n\nA 审批通过后，B 才能开始。');
  assert.doesNotMatch(target.detail, /起点|终点|主语|谓语/);
});

test('full-text panel is three floating-box widths but clamped inside the viewport', () => {
  assert.deepEqual(magnifier.panelLayout({ x: 600, y: 300, viewportWidth: 1400, viewportHeight: 900 }), {
    left: 24,
    top: 24,
    width: 960,
    maxHeight: 852
  });
  assert.deepEqual(magnifier.panelLayout({ x: 100, y: 100, viewportWidth: 700, viewportHeight: 500 }), {
    left: 24,
    top: 24,
    width: 652,
    maxHeight: 452
  });
});
